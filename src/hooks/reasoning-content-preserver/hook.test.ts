import { describe, expect, it, mock } from "bun:test"
import { createReasoningContentPreserverHook } from "./hook"

function makeMsg(id: string, role: string, parts: Array<{ id?: string; type?: string; [k: string]: unknown }>, sessionID = "ses_1") {
  return {
    info: { id, role, sessionID },
    parts,
  }
}

function makeSDKResponse(messages: ReturnType<typeof makeMsg>[]) {
  return { data: messages }
}

describe("reasoning-content-preserver", () => {
  it("skips when no reasoning parts in history", async () => {
    const client = { session: { messages: mock(async () => makeSDKResponse([])) } }
    const hook = createReasoningContentPreserverHook(client)
    const messages = [
      makeMsg("msg1", "assistant", [{ type: "text", text: "hello" }]),
      makeMsg("msg2", "user", [{ type: "text", text: "hi" }]),
    ]

    await hook["experimental.chat.messages.transform"]!({}, { messages })

    expect(client.session.messages).not.toHaveBeenCalled()
    expect(messages[0].parts).toHaveLength(1)
  })

  it("skips when all assistant messages have reasoning parts", async () => {
    const client = { session: { messages: mock(async () => makeSDKResponse([])) } }
    const hook = createReasoningContentPreserverHook(client)
    const messages = [
      makeMsg("msg1", "assistant", [
        { type: "reasoning", text: "thinking..." },
        { type: "text", text: "hello" },
      ]),
    ]

    await hook["experimental.chat.messages.transform"]!({}, { messages })

    expect(client.session.messages).not.toHaveBeenCalled()
    expect(messages[0].parts).toHaveLength(2)
  })

  it("injects missing reasoning parts from SDK", async () => {
    const client = {
      session: {
        messages: mock(async () =>
          makeSDKResponse([
            makeMsg("msg1", "assistant", [
              { id: "p_r1", type: "reasoning", text: "original reasoning 1" },
              { id: "p_t1", type: "text", text: "hello" },
            ]),
            makeMsg("msg2", "assistant", [
              { id: "p_r2", type: "reasoning", text: "original reasoning 2" },
              { id: "p_tu1", type: "tool_use", name: "bash" },
            ]),
          ]),
        ),
      },
    }
    const hook = createReasoningContentPreserverHook(client)

    // msg2 is missing its reasoning part in the transform output
    const messages = [
      makeMsg("msg1", "assistant", [
        { id: "p_r1", type: "reasoning", text: "original reasoning 1" },
        { id: "p_t1", type: "text", text: "hello" },
      ]),
      makeMsg("msg2", "assistant", [
        { id: "p_tu1", type: "tool_use", name: "bash" },
      ]),
    ]

    await hook["experimental.chat.messages.transform"]!({}, { messages })

    // msg2 should now have the reasoning part injected
    expect(messages[1].parts).toHaveLength(2)
    expect(messages[1].parts[0]).toEqual({ id: "p_r2", type: "reasoning", text: "original reasoning 2" })
    expect(messages[1].parts[1]).toEqual({ id: "p_tu1", type: "tool_use", name: "bash" })
  })

  it("uses fallback reasoning from previous message when SDK lacks it", async () => {
    const client = {
      session: {
        messages: mock(async () =>
          makeSDKResponse([
            makeMsg("msg1", "assistant", [
              { type: "reasoning", text: "thinking..." },
              { type: "text", text: "hello" },
            ]),
            makeMsg("msg2", "assistant", [
              { type: "text", text: "no reasoning here" },
            ]),
          ]),
        ),
      },
    }
    const hook = createReasoningContentPreserverHook(client)

    const messages = [
      makeMsg("msg1", "assistant", [
        { type: "reasoning", text: "thinking..." },
        { type: "text", text: "hello" },
      ]),
      makeMsg("msg2", "assistant", [
        { type: "tool_use", name: "bash" },
      ]),
    ]

    await hook["experimental.chat.messages.transform"]!({}, { messages })

    // msg2 should get the fallback reasoning from msg1
    expect(messages[1].parts).toHaveLength(2)
    expect(messages[1].parts[0]).toEqual({ type: "reasoning", text: "thinking..." })
    expect(messages[1].parts[1]).toEqual({ type: "tool_use", name: "bash" })
  })

  it("handles SDK call failure gracefully", async () => {
    const client = {
      session: {
        messages: mock(async () => {
          throw new Error("network error")
        }),
      },
    }
    const hook = createReasoningContentPreserverHook(client)

    const messages = [
      makeMsg("msg1", "assistant", [
        { type: "reasoning", text: "thinking..." },
        { type: "text", text: "hello" },
      ]),
      makeMsg("msg2", "assistant", [
        { type: "tool_use", name: "bash" },
      ]),
    ]

    // Should not throw
    await hook["experimental.chat.messages.transform"]!({}, { messages })

    // msg2 should remain unchanged (no crash, no injection)
    expect(messages[1].parts).toHaveLength(1)
  })

  it("skips when session ID is missing", async () => {
    const client = { session: { messages: mock(async () => makeSDKResponse([])) } }
    const hook = createReasoningContentPreserverHook(client)

    const messages = [
      {
        info: { id: "msg1", role: "assistant" },
        parts: [{ type: "reasoning", text: "thinking..." }],
      },
      {
        info: { id: "msg2", role: "assistant" },
        parts: [{ type: "tool_use", name: "bash" }],
      },
    ]

    await hook["experimental.chat.messages.transform"]!({}, { messages })

    expect(client.session.messages).not.toHaveBeenCalled()
  })

  it("skips on empty messages array", async () => {
    const client = { session: { messages: mock(async () => makeSDKResponse([])) } }
    const hook = createReasoningContentPreserverHook(client)

    await hook["experimental.chat.messages.transform"]!({}, { messages: [] })
    await hook["experimental.chat.messages.transform"]!({}, { messages: undefined as never })

    expect(client.session.messages).not.toHaveBeenCalled()
  })
})
