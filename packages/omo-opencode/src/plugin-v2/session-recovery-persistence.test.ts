import { describe, expect, test } from "bun:test"
import type { Plugin } from "@opencode/plugin"
import {
  armedRecoveryStorageKey,
  loadPersistedRecoveryArming,
  resolveStorageDomain,
} from "./session-recovery-persistence"
import { registerSessionRecovery } from "./session-recovery"
import type { ArmedRecovery } from "./session-recovery-strategies"
import { CANCELLED_TOOL_RESULT_TEXT } from "./session-recovery-tool-results"

const ZAI_IMAGE_ERROR = {
  type: "provider.invalid-request",
  message: "messages.content.type is invalid, allowed values: ['text']",
  status: 400,
}

const TOOL_RESULT_MISSING_ERROR = {
  type: "provider.invalid-request",
  message: "messages.1: tool_use ids were found without tool_result blocks immediately after: toolu_123",
  status: 400,
}

type StorageEntry = { key: string; value: unknown }

function createFakeStorage(entries: StorageEntry[] = [], setImpl?: (key: string, value: unknown) => Promise<void>) {
  const setCalls: StorageEntry[] = []
  const storage = {
    get: async (key: string) => entries.find((entry) => entry.key === key)?.value,
    set: setImpl ?? (async (key: string, value: unknown) => {
      setCalls.push({ key, value })
    }),
    remove: async () => {},
    scan: async (options: { prefix: string; after?: string }) => {
      const matching = entries.filter((entry) => entry.key.startsWith(options.prefix))
      const start = options.after !== undefined ? matching.findIndex((entry) => entry.key > options.after!) + 1 : 0
      return { entries: matching.slice(start) }
    },
  }
  return { storage, setCalls }
}

function createPagedStorage(pages: StorageEntry[][]) {
  let page = 0
  return {
    get: async () => undefined,
    set: async () => {},
    remove: async () => {},
    scan: async () => {
      const current = pages[Math.min(page, pages.length - 1)]
      page += 1
      return { entries: current, next: page < pages.length ? `cursor-${page}` : undefined }
    },
  }
}

type HookHandler = (event: unknown) => void

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

function createCtx(stream: (options?: { signal?: AbortSignal }) => AsyncIterable<unknown>, storage?: unknown) {
  const hookHandlers = new Map<string, HookHandler>()
  const syntheticCalls: Array<{ sessionID: string; text: string }> = []
  const ctx = {
    event: { subscribe: stream },
    storage,
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

function makeImageProbe(sessionID: string) {
  return {
    sessionID,
    messages: [{ role: "user", parts: [{ type: "file", mime: "image/png" }] }],
  }
}

describe("resolveStorageDomain", () => {
  test("#given a ctx with a full storage domain #then it is returned", () => {
    const { storage } = createFakeStorage()
    const ctx = { storage } as unknown as Plugin.Context
    expect(resolveStorageDomain(ctx)).not.toBeNull()
  })

  test("#given a missing or partial storage domain #then null is returned", () => {
    expect(resolveStorageDomain({} as Plugin.Context)).toBeNull()
    expect(resolveStorageDomain({ storage: {} } as unknown as Plugin.Context)).toBeNull()
    expect(
      resolveStorageDomain({ storage: { get: async () => undefined } } as unknown as Plugin.Context),
    ).toBeNull()
  })
})

describe("loadPersistedRecoveryArming", () => {
  test("#given valid persisted entries #then each session is restored with stripMedia", async () => {
    const { storage } = createFakeStorage([
      { key: armedRecoveryStorageKey("ses_a"), value: { sessionID: "ses_a", stripMedia: true } },
      { key: "unrelated/key", value: { sessionID: "ses_skip", stripMedia: true } },
    ])
    const recovering = new Map<string, ArmedRecovery>()
    await loadPersistedRecoveryArming(storage as unknown as Plugin.Context["storage"], recovering)
    expect(recovering.size).toBe(1)
    expect(recovering.get("ses_a")).toEqual({ stripMedia: true, toolResultText: null })
  })

  test("#given entries split across scan pages #then the next cursor is followed", async () => {
    const storage = createPagedStorage([
      [{ key: armedRecoveryStorageKey("ses_a"), value: { sessionID: "ses_a", stripMedia: true } }],
      [{ key: armedRecoveryStorageKey("ses_b"), value: { sessionID: "ses_b", stripMedia: true } }],
    ])
    const recovering = new Map<string, ArmedRecovery>()
    await loadPersistedRecoveryArming(storage as unknown as Plugin.Context["storage"], recovering)
    expect(recovering.has("ses_a")).toBe(true)
    expect(recovering.has("ses_b")).toBe(true)
  })

  test("#given malformed persisted values #then they are ignored", async () => {
    const { storage } = createFakeStorage([
      { key: armedRecoveryStorageKey("ses_1"), value: null },
      { key: armedRecoveryStorageKey("ses_2"), value: "junk" },
      { key: armedRecoveryStorageKey("ses_3"), value: {} },
      { key: armedRecoveryStorageKey("ses_4"), value: { stripMedia: true } },
      { key: armedRecoveryStorageKey("ses_5"), value: { sessionID: 7, stripMedia: true } },
      { key: armedRecoveryStorageKey("ses_6"), value: { sessionID: "", stripMedia: true } },
    ])
    const recovering = new Map<string, ArmedRecovery>()
    await loadPersistedRecoveryArming(storage as unknown as Plugin.Context["storage"], recovering)
    expect(recovering.size).toBe(0)
  })

  test("#given an in-memory arming already present #then the merge keeps toolResultText", async () => {
    const { storage } = createFakeStorage([
      { key: armedRecoveryStorageKey("ses_mix"), value: { sessionID: "ses_mix", stripMedia: true } },
    ])
    const recovering = new Map([["ses_mix", { stripMedia: false, toolResultText: CANCELLED_TOOL_RESULT_TEXT }]])
    await loadPersistedRecoveryArming(storage as unknown as Plugin.Context["storage"], recovering)
    expect(recovering.get("ses_mix")).toEqual({ stripMedia: true, toolResultText: CANCELLED_TOOL_RESULT_TEXT })
  })

  test("#given a failing scan #then the load resolves without throwing and restores nothing", async () => {
    const { storage } = createFakeStorage()
    const failing = {
      ...storage,
      scan: async () => {
        throw new Error("storage unavailable")
      },
    }
    const recovering = new Map<string, ArmedRecovery>()
    await expect(
      loadPersistedRecoveryArming(failing as unknown as Plugin.Context["storage"], recovering),
    ).resolves.toBeUndefined()
    expect(recovering.size).toBe(0)
  })
})

describe("registerSessionRecovery persistence", () => {
  test("#given storage seeded from a previous lifetime #then the first request is stripped with no failure and no synthetic", async () => {
    // given
    const queue = createEventQueue()
    const { storage, setCalls } = createFakeStorage([
      { key: armedRecoveryStorageKey("ses_restart"), value: { sessionID: "ses_restart", stripMedia: true } },
    ])
    const { ctx, hookHandlers, syntheticCalls } = createCtx(queue.stream, storage)

    // when
    const dispose = registerSessionRecovery(ctx, { autoResume: true })
    await waitFor(() => {
      const probe = makeImageProbe("ses_restart")
      hookHandlers.get("context")?.(probe)
      const part = (probe.messages[0].parts[0] as { type: string }).type
      return part === "text"
    })

    // then
    expect(syntheticCalls).toHaveLength(0)
    expect(setCalls).toHaveLength(0)
    const untouched = makeImageProbe("ses_other")
    hookHandlers.get("context")?.(untouched)
    expect((untouched.messages[0].parts[0] as { type: string }).type).toBe("file")
    dispose()
  })

  test("#given an image failure #then the strip-media arming is persisted under the session key", async () => {
    // given
    const queue = createEventQueue()
    const { storage, setCalls } = createFakeStorage()
    const { ctx, syntheticCalls } = createCtx(queue.stream, storage)

    // when
    const dispose = registerSessionRecovery(ctx, { autoResume: true })
    queue.push({ type: "session.execution.failed", data: { sessionID: "ses_img", error: ZAI_IMAGE_ERROR } })
    await waitFor(() => setCalls.length === 1)

    // then
    expect(setCalls[0].key).toBe(armedRecoveryStorageKey("ses_img"))
    expect(setCalls[0].value).toEqual({ sessionID: "ses_img", stripMedia: true })
    expect(syntheticCalls).toHaveLength(1)
    dispose()
  })

  test("#given a tool result missing failure #then nothing is persisted (strip-media only)", async () => {
    // given
    const queue = createEventQueue()
    const { storage, setCalls } = createFakeStorage()
    const { ctx, syntheticCalls } = createCtx(queue.stream, storage)

    // when
    const dispose = registerSessionRecovery(ctx, { autoResume: true })
    queue.push({ type: "session.execution.failed", data: { sessionID: "ses_trm", error: TOOL_RESULT_MISSING_ERROR } })
    await waitFor(() => syntheticCalls.length === 1)

    // then
    expect(setCalls).toHaveLength(0)
    dispose()
  })

  test("#given a rejecting storage backend #then in-memory arming and resume still work", async () => {
    // given
    const queue = createEventQueue()
    const { storage } = createFakeStorage([], async () => {
      throw new Error("disk full")
    })
    const { ctx, hookHandlers, syntheticCalls } = createCtx(queue.stream, storage)

    // when
    const dispose = registerSessionRecovery(ctx, { autoResume: true })
    queue.push({ type: "session.execution.failed", data: { sessionID: "ses_img", error: ZAI_IMAGE_ERROR } })
    await waitFor(() => syntheticCalls.length === 1)
    const probe = makeImageProbe("ses_img")
    hookHandlers.get("context")?.(probe)

    // then
    expect((probe.messages[0].parts[0] as { type: string }).type).toBe("text")
    dispose()
  })

  test("#given a persisted arming whose failure recurs after restart #then the resume is emitted once and a new error type still resumes", async () => {
    // given
    const queue = createEventQueue()
    const { storage } = createFakeStorage([
      { key: armedRecoveryStorageKey("ses_dup"), value: { sessionID: "ses_dup", stripMedia: true } },
    ])
    const { ctx, hookHandlers, syntheticCalls } = createCtx(queue.stream, storage)

    // when
    const dispose = registerSessionRecovery(ctx, { autoResume: true })
    await waitFor(() => {
      const probe = makeImageProbe("ses_dup")
      hookHandlers.get("context")?.(probe)
      return (probe.messages[0].parts[0] as { type: string }).type === "text"
    })
    queue.push({ type: "session.step.failed", data: { sessionID: "ses_dup", error: ZAI_IMAGE_ERROR } })
    queue.push({ type: "session.execution.failed", data: { sessionID: "ses_dup", error: ZAI_IMAGE_ERROR } })
    await waitFor(() => syntheticCalls.length >= 1)
    queue.push({ type: "session.execution.failed", data: { sessionID: "ses_dup", error: TOOL_RESULT_MISSING_ERROR } })
    await waitFor(() => syntheticCalls.length === 2)

    // then
    expect(syntheticCalls).toHaveLength(2)
    expect(syntheticCalls[0].text).toContain("text content")
    expect(syntheticCalls[1].text).toContain("no matching tool result")
    dispose()
  })

  test("#given a ctx without a storage domain #then registration degrades to the in-memory flow", async () => {
    // given
    const queue = createEventQueue()
    const { ctx, hookHandlers, syntheticCalls } = createCtx(queue.stream, undefined)

    // when
    const dispose = registerSessionRecovery(ctx, { autoResume: true })
    queue.push({ type: "session.execution.failed", data: { sessionID: "ses_img", error: ZAI_IMAGE_ERROR } })
    await waitFor(() => syntheticCalls.length === 1)
    const probe = makeImageProbe("ses_img")
    hookHandlers.get("context")?.(probe)

    // then
    expect((probe.messages[0].parts[0] as { type: string }).type).toBe("text")
    dispose()
  })
})
