import { describe, expect, test } from "bun:test"
import type { Plugin } from "@opencode/plugin"
import { extractFailedSessionEvent, registerSessionRecovery } from "./session-recovery"

const ZAI_IMAGE_ERROR = {
  type: "provider.invalid-request",
  message: "messages.content.type is invalid, allowed values: ['text']",
  status: 400,
  response: {
    body: JSON.stringify({
      error: {
        message: "messages.content.type is invalid, allowed values: ['text']",
        type: "invalid_request_error",
        code: 400,
      },
    }),
  },
}

const THINKING_DISABLED_ERROR = {
  type: "provider.invalid-request",
  message: "thinking is disabled and cannot contain blocks",
}

const TOOL_RESULT_MISSING_ERROR = {
  type: "provider.invalid-request",
  message: "messages.1: tool_use ids were found without tool_result blocks immediately after: toolu_123",
  status: 400,
}

const UNAVAILABLE_TOOL_ERROR = {
  type: "provider.invalid-request",
  message: "Model tried to call unavailable tool 'invalid'. Available tools: bash, read, glob, grep, webfetch.",
  status: 400,
}

function createEventQueue() {
  const events: unknown[] = []
  let wake: (() => void) | undefined
  const push = (event: unknown): void => {
    events.push(event)
    const pending = wake
    wake = undefined
    pending?.()
  }
  const stream = async function* streamEvents(options?: { signal?: AbortSignal }) {
    let index = 0
    while (true) {
      if (options?.signal?.aborted) return
      if (index >= events.length) {
        await new Promise<void>((resolve) => {
          wake = resolve
        })
        continue
      }
      yield events[index]
      index += 1
    }
  }
  return { push, stream }
}

type HookHandler = (event: unknown) => void

function createFakeCtx(stream: (options?: { signal?: AbortSignal }) => AsyncIterable<unknown>) {
  const hookHandlers = new Map<string, HookHandler>()
  const syntheticCalls: Array<{ sessionID: string; text: string }> = []
  const ctx = {
    event: { subscribe: stream },
    session: {
      hook: async (kind: string, handler: HookHandler) => {
        hookHandlers.set(kind, handler)
        return { dispose(): void {} }
      },
      synthetic: async (input: { sessionID: string; text: string }) => {
        syntheticCalls.push(input)
      },
    },
  } as unknown as Plugin.Context
  return { ctx, hookHandlers, syntheticCalls }
}

async function waitFor(condition: () => boolean, timeoutMs = 3000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (!condition()) {
    if (Date.now() > deadline) {
      throw new Error(`waitFor timed out after ${timeoutMs}ms`)
    }
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
}

async function settle(ms = 200): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms))
}

function buildToolProbeRequest(sessionID: string) {
  return {
    sessionID,
    messages: [
      { role: "user", content: [{ type: "text", text: "run the check" }] },
      {
        role: "assistant",
        content: [
          { type: "text", text: "calling" },
          { type: "tool-call", id: "call_1", name: "bash", input: { command: "echo hi" } },
        ],
      },
      { role: "user", content: [{ type: "text", text: "continue" }] },
    ],
  }
}

describe("extractFailedSessionEvent", () => {
  describe("#given v2 bus failure events", () => {
    test("#then execution and step failures yield the sessionID and error", () => {
      // given
      const executionFailed = {
        type: "session.execution.failed",
        data: { sessionID: "ses_1", error: ZAI_IMAGE_ERROR },
      }
      const stepFailed = {
        type: "session.step.failed",
        data: { sessionID: "ses_2", assistantMessageID: "msg_1", error: ZAI_IMAGE_ERROR },
      }

      // when / then
      expect(extractFailedSessionEvent(executionFailed)).toEqual({ sessionID: "ses_1", error: ZAI_IMAGE_ERROR })
      expect(extractFailedSessionEvent(stepFailed)?.sessionID).toBe("ses_2")
    })

    test("#then unrelated, malformed, and v1-named events yield null", () => {
      // given
      const events: ReadonlyArray<unknown> = [
        { type: "session.idle", data: { sessionID: "ses_1" } },
        { type: "session.execution.failed", data: {} },
        { type: "session.execution.failed" },
        { type: "session.error", data: { sessionID: "ses_1", error: ZAI_IMAGE_ERROR } },
        { type: "session.step.failed", data: { sessionID: "", error: ZAI_IMAGE_ERROR } },
        null,
        "junk",
      ]

      // when / then
      for (const event of events) {
        expect(extractFailedSessionEvent(event)).toBeNull()
      }
    })
  })
})

describe("registerSessionRecovery", () => {
  describe("#given a v2 context whose bus reports the image failure twice", () => {
    test("#then one synthetic resume is dispatched and stripping arms for that session", async () => {
      // given
      const queue = createEventQueue()
      const { ctx, hookHandlers, syntheticCalls } = createFakeCtx(queue.stream)

      // when
      const dispose = registerSessionRecovery(ctx, { autoResume: true })
      expect([...hookHandlers.keys()].sort()).toEqual(["compaction", "context", "generate", "title"])
      queue.push({
        type: "session.step.failed",
        data: { sessionID: "ses_img", assistantMessageID: "msg_a", error: ZAI_IMAGE_ERROR },
      })
      queue.push({
        type: "session.execution.failed",
        data: { sessionID: "ses_img", error: ZAI_IMAGE_ERROR },
      })
      await waitFor(() => syntheticCalls.length === 1)
      await settle()

      // then
      expect(syntheticCalls).toHaveLength(1)
      expect(syntheticCalls[0].sessionID).toBe("ses_img")
      expect(syntheticCalls[0].text).toContain("[session recovery]")

      const imagePart = { type: "file", mime: "image/png" }
      const recoveredRequest = {
        sessionID: "ses_img",
        messages: [{ role: "user", parts: [{ type: "text", text: "hi" }, imagePart] }],
      }
      hookHandlers.get("context")?.(recoveredRequest)
      expect(recoveredRequest.messages[0].parts[1].type).toBe("text")
      expect(recoveredRequest.messages[0].parts[1].text).toContain("[image attachment removed")

      const untouchedRequest = {
        sessionID: "ses_other",
        messages: [{ role: "user", parts: [{ type: "file", mime: "image/png" }] }],
      }
      hookHandlers.get("context")?.(untouchedRequest)
      expect(untouchedRequest.messages[0].parts[0].type).toBe("file")

      dispose()
    })
  })

  describe("#given auto resume disabled", () => {
    test("#then no synthetic is dispatched but stripping still arms", async () => {
      // given
      const queue = createEventQueue()
      const { ctx, hookHandlers, syntheticCalls } = createFakeCtx(queue.stream)

      // when
      const dispose = registerSessionRecovery(ctx, { autoResume: false })
      queue.push({
        type: "session.execution.failed",
        data: { sessionID: "ses_img", error: ZAI_IMAGE_ERROR },
      })
      await settle()
      const recoveredRequest = {
        sessionID: "ses_img",
        messages: [{ role: "user", parts: [{ type: "file", mime: "image/png" }] }],
      }
      hookHandlers.get("context")?.(recoveredRequest)

      // then
      expect(syntheticCalls).toHaveLength(0)
      expect(recoveredRequest.messages[0].parts[0].type).toBe("text")

      dispose()
    })
  })

  describe("#given a recoverable error with no V2 strategy", () => {
    test("#then no synthetic is dispatched and neither strip nor tool injection arms", async () => {
      // given
      const queue = createEventQueue()
      const { ctx, hookHandlers, syntheticCalls } = createFakeCtx(queue.stream)

      // when
      const dispose = registerSessionRecovery(ctx, { autoResume: true })
      queue.push({
        type: "session.execution.failed",
        data: { sessionID: "ses_think", error: THINKING_DISABLED_ERROR },
      })
      await settle()
      const probe = {
        sessionID: "ses_think",
        messages: [
          { role: "user", parts: [{ type: "file", mime: "image/png" }] },
          {
            role: "assistant",
            content: [{ type: "tool-call", id: "call_1", name: "bash", input: {} }],
          },
        ],
      }
      hookHandlers.get("context")?.(probe)

      // then
      expect(syntheticCalls).toHaveLength(0)
      expect(probe.messages[0].parts[0].type).toBe("file")
      expect(probe.messages).toHaveLength(2)

      dispose()
    })
  })

  describe("#given a v2 context whose bus reports the missing tool result failure twice", () => {
    test("#then one synthetic resume is dispatched and cancelled tool results are injected", async () => {
      // given
      const queue = createEventQueue()
      const { ctx, hookHandlers, syntheticCalls } = createFakeCtx(queue.stream)

      // when
      const dispose = registerSessionRecovery(ctx, { autoResume: true })
      queue.push({
        type: "session.step.failed",
        data: { sessionID: "ses_trm", assistantMessageID: "msg_1", error: TOOL_RESULT_MISSING_ERROR },
      })
      queue.push({
        type: "session.execution.failed",
        data: { sessionID: "ses_trm", error: TOOL_RESULT_MISSING_ERROR },
      })
      await waitFor(() => syntheticCalls.length === 1)
      await settle()

      const request = buildToolProbeRequest("ses_trm")
      hookHandlers.get("context")?.(request)
      const untouched = buildToolProbeRequest("ses_other")
      hookHandlers.get("context")?.(untouched)

      // then
      expect(syntheticCalls).toHaveLength(1)
      expect(syntheticCalls[0].sessionID).toBe("ses_trm")
      expect(syntheticCalls[0].text).toContain("no matching tool result")
      expect(request.messages).toHaveLength(4)
      expect(request.messages[2].role).toBe("tool")
      const resultPart = (request.messages[2] as { content: Record<string, unknown>[] }).content[0]
      expect(resultPart.type).toBe("tool-result")
      expect(resultPart.id).toBe("call_1")
      expect(resultPart.name).toBe("bash")
      expect(resultPart.result).toEqual({ type: "error", value: "Operation cancelled by user (ESC pressed)" })
      expect(untouched.messages).toHaveLength(3)

      dispose()
    })
  })

  describe("#given a v2 context whose bus reports the unavailable tool failure twice", () => {
    test("#then one synthetic resume is dispatched and unavailable tool results are injected", async () => {
      // given
      const queue = createEventQueue()
      const { ctx, hookHandlers, syntheticCalls } = createFakeCtx(queue.stream)

      // when
      const dispose = registerSessionRecovery(ctx, { autoResume: true })
      queue.push({
        type: "session.step.failed",
        data: { sessionID: "ses_utl", error: UNAVAILABLE_TOOL_ERROR },
      })
      queue.push({
        type: "session.execution.failed",
        data: { sessionID: "ses_utl", error: UNAVAILABLE_TOOL_ERROR },
      })
      await waitFor(() => syntheticCalls.length === 1)
      await settle()

      const request = buildToolProbeRequest("ses_utl")
      hookHandlers.get("context")?.(request)

      // then
      expect(syntheticCalls).toHaveLength(1)
      expect(syntheticCalls[0].sessionID).toBe("ses_utl")
      expect(syntheticCalls[0].text).toContain("not available")
      expect(request.messages).toHaveLength(4)
      expect(request.messages[2].role).toBe("tool")
      const resultPart = (request.messages[2] as { content: Record<string, unknown>[] }).content[0]
      expect(resultPart.result).toEqual({
        type: "error",
        value: "Tool not available. Please continue without this tool.",
      })

      dispose()
    })
  })

  describe("#given one session failing first with images then with missing tool results", () => {
    test("#then both transforms arm and a single outgoing request gets both fixes", async () => {
      // given
      const queue = createEventQueue()
      const { ctx, hookHandlers, syntheticCalls } = createFakeCtx(queue.stream)

      // when
      const dispose = registerSessionRecovery(ctx, { autoResume: true })
      queue.push({
        type: "session.execution.failed",
        data: { sessionID: "ses_mix", error: ZAI_IMAGE_ERROR },
      })
      await waitFor(() => syntheticCalls.length === 1)
      queue.push({
        type: "session.execution.failed",
        data: { sessionID: "ses_mix", error: TOOL_RESULT_MISSING_ERROR },
      })
      await waitFor(() => syntheticCalls.length === 2)
      await settle()

      const request = {
        sessionID: "ses_mix",
        messages: [
          { role: "user", content: [{ type: "text", text: "describe" }, { type: "media", media: "data:image/png;base64,AAA" }] },
          { role: "assistant", content: [{ type: "tool-call", id: "call_1", name: "bash", input: {} }] },
        ],
      }
      hookHandlers.get("context")?.(request)

      // then
      expect(syntheticCalls).toHaveLength(2)
      expect(syntheticCalls.map((call) => call.sessionID)).toEqual(["ses_mix", "ses_mix"])
      const userContent = (request.messages[0] as { content: Record<string, unknown>[] }).content
      expect(userContent[1].type).toBe("text")
      expect(userContent[1].text).toContain("[image attachment removed")
      expect(request.messages).toHaveLength(3)
      expect(request.messages[2].role).toBe("tool")

      dispose()
    })
  })

  describe("#given auto resume disabled with a missing tool result failure", () => {
    test("#then no synthetic is dispatched but tool result injection still arms", async () => {
      // given
      const queue = createEventQueue()
      const { ctx, hookHandlers, syntheticCalls } = createFakeCtx(queue.stream)

      // when
      const dispose = registerSessionRecovery(ctx, { autoResume: false })
      queue.push({
        type: "session.execution.failed",
        data: { sessionID: "ses_trm_off", error: TOOL_RESULT_MISSING_ERROR },
      })
      await settle()
      const request = buildToolProbeRequest("ses_trm_off")
      hookHandlers.get("context")?.(request)

      // then
      expect(syntheticCalls).toHaveLength(0)
      expect(request.messages).toHaveLength(4)
      expect(request.messages[2].role).toBe("tool")

      dispose()
    })
  })

  describe("#given a disposed registration", () => {
    test("#then later bus events are ignored", async () => {
      // given
      const queue = createEventQueue()
      const { ctx, syntheticCalls } = createFakeCtx(queue.stream)

      // when
      const dispose = registerSessionRecovery(ctx, { autoResume: true })
      queue.push({
        type: "session.execution.failed",
        data: { sessionID: "ses_one", error: ZAI_IMAGE_ERROR },
      })
      await waitFor(() => syntheticCalls.length === 1)
      dispose()
      queue.push({
        type: "session.execution.failed",
        data: { sessionID: "ses_two", error: ZAI_IMAGE_ERROR },
      })
      await settle()

      // then
      expect(syntheticCalls).toHaveLength(1)
    })
  })
})
