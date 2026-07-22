import { describe, it, expect, mock } from "bun:test"
import { createTranscriptArchivalCompactionHandler } from "./hook"

describe("createTranscriptArchivalCompactionHandler", () => {
  it("calls saveTranscript with fetched messages", async () => {
    const savedCalls: Array<{ directory: string; sessionID: string; messages: unknown[] }> = []
    const archival = {
      saveTranscript: mock(async (directory: string, sessionID: string, messages: unknown[]) => {
        savedCalls.push({ directory, sessionID, messages })
      }),
    }

    const handler = createTranscriptArchivalCompactionHandler(archival)

    const ctx = {
      directory: "/test/dir",
      client: {
        session: {
          messages: mock(async () => ({
            data: [
              { role: "user", content: "hello" },
              { role: "assistant", content: "world" },
            ],
          })),
        },
      },
    }

    await handler(ctx, { sessionID: "sess-123" })

    expect(savedCalls).toHaveLength(1)
    expect(savedCalls[0].directory).toBe("/test/dir")
    expect(savedCalls[0].sessionID).toBe("sess-123")
    expect(savedCalls[0].messages).toHaveLength(2)
  })

  it("handles fetch errors gracefully without throwing", async () => {
    const archival = {
      saveTranscript: mock(async () => {}),
    }

    const handler = createTranscriptArchivalCompactionHandler(archival)

    const ctx = {
      directory: "/test/dir",
      client: {
        session: {
          messages: mock(async () => {
            throw new Error("network error")
          }),
        },
      },
    }

    // Should not throw
    await expect(handler(ctx, { sessionID: "sess-123" })).resolves.toBeUndefined()
    // saveTranscript should not be called when fetch fails
    expect(archival.saveTranscript).not.toHaveBeenCalled()
  })

  it("passes empty messages array to saveTranscript", async () => {
    const savedCalls: Array<{ messages: unknown[] }> = []
    const archival = {
      saveTranscript: mock(async (_dir: string, _id: string, messages: unknown[]) => {
        savedCalls.push({ messages })
      }),
    }

    const handler = createTranscriptArchivalCompactionHandler(archival)

    const ctx = {
      directory: "/test/dir",
      client: {
        session: {
          messages: mock(async () => ({ data: [] })),
        },
      },
    }

    await handler(ctx, { sessionID: "sess-123" })

    // saveTranscript is called with the empty array (the hook's saveTranscript handles the early return)
    expect(archival.saveTranscript).toHaveBeenCalledTimes(1)
    expect(savedCalls[0].messages).toHaveLength(0)
  })

  it("calls saveTranscript with empty array when response has no data field", async () => {
    const savedCalls: Array<{ messages: unknown[] }> = []
    const archival = {
      saveTranscript: mock(async (_dir: string, _id: string, messages: unknown[]) => {
        savedCalls.push({ messages })
      }),
    }

    const handler = createTranscriptArchivalCompactionHandler(archival)

    const ctx = {
      directory: "/test/dir",
      client: {
        session: {
          messages: mock(async () => ({})),
        },
      },
    }

    await handler(ctx, { sessionID: "sess-123" })

    // The handler defaults to [] when data is missing, and forwards to saveTranscript
    expect(archival.saveTranscript).toHaveBeenCalledTimes(1)
    expect(savedCalls[0].messages).toHaveLength(0)
  })
})
