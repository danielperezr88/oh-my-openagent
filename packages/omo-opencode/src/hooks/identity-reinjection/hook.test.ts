import { describe, it, expect, beforeEach } from "bun:test"
import { createIdentityReinjectionHook } from "./hook"
import { subagentSessions, _resetForTesting, setSessionAgent } from "../../features/claude-code-session-state/state"

type TextPart = { type: "text"; text: string }

interface MessageWithParts {
  info: { role: string; sessionID?: string }
  parts: TextPart[]
}

describe("createIdentityReinjectionHook", () => {
  let hook: ReturnType<typeof createIdentityReinjectionHook>

  beforeEach(() => {
    _resetForTesting()
    hook = createIdentityReinjectionHook()
  })

  const markCompacted = async (sessionID: string) => {
    subagentSessions.add(sessionID)
    await hook.event!({ event: { type: "session.compacted", properties: { sessionID } } })
  }

  describe("given a compacted subagent session", () => {
    it("should inject identity anchor into last user message", async () => {
      setSessionAgent("sub-1", "oracle")
      await markCompacted("sub-1")

      const output = {
        messages: [
          { info: { role: "user", sessionID: "sub-1" }, parts: [{ type: "text", text: "continue" }] },
        ] as MessageWithParts[],
      }

      await hook["experimental.chat.messages.transform"]!({}, output)

      expect(output.messages[0].parts.length).toBe(2)
      expect(output.messages[0].parts[0].text).toContain("<identity>")
      expect(output.messages[0].parts[0].text).toContain("oracle")
    })

    it("should not inject for non-subagent sessions", async () => {
      await hook.event!({ event: { type: "session.compacted", properties: { sessionID: "main-1" } } })

      const output = {
        messages: [
          { info: { role: "user", sessionID: "main-1" }, parts: [{ type: "text", text: "continue" }] },
        ] as MessageWithParts[],
      }

      await hook["experimental.chat.messages.transform"]!({}, output)

      expect(output.messages[0].parts.length).toBe(1)
    })

    it("should not inject when session has grown past 5 messages", async () => {
      setSessionAgent("sub-2", "momus")
      await markCompacted("sub-2")

      const output = {
        messages: Array.from({ length: 6 }, (_, i) => ({
          info: { role: i % 2 === 0 ? "user" : "assistant", sessionID: "sub-2" },
          parts: [{ type: "text", text: `msg ${i}` }],
        })) as MessageWithParts[],
      }

      await hook["experimental.chat.messages.transform"]!({}, output)

      // No identity injected because session has grown
      for (const msg of output.messages) {
        for (const part of msg.parts) {
          expect(part.text).not.toContain("<identity>")
        }
      }
    })

    it("should not inject when no agent name is set", async () => {
      // Add as subagent but don't set agent name
      subagentSessions.add("sub-3")
      await hook.event!({ event: { type: "session.compacted", properties: { sessionID: "sub-3" } } })

      const output = {
        messages: [
          { info: { role: "user", sessionID: "sub-3" }, parts: [{ type: "text", text: "continue" }] },
        ] as MessageWithParts[],
      }

      await hook["experimental.chat.messages.transform"]!({}, output)
      expect(output.messages[0].parts.length).toBe(1)
    })
  })

  describe("session cleanup", () => {
    it("should clean up on session.deleted", async () => {
      setSessionAgent("sub-4", "atlas")
      await markCompacted("sub-4")

      await hook.event!({ event: { type: "session.deleted", properties: { info: { id: "sub-4" } } } })

      const output = {
        messages: [
          { info: { role: "user", sessionID: "sub-4" }, parts: [{ type: "text", text: "continue" }] },
        ] as MessageWithParts[],
      }

      await hook["experimental.chat.messages.transform"]!({}, output)
      expect(output.messages[0].parts.length).toBe(1)
    })
  })

  describe("duplicate injection prevention", () => {
    it("should inject identity only once even with multiple user messages from same session", async () => {
      setSessionAgent("sub-5", "sisyphus")
      await markCompacted("sub-5")

      const output = {
        messages: [
          { info: { role: "user", sessionID: "sub-5" }, parts: [{ type: "text", text: "first" }] },
          { info: { role: "assistant", sessionID: "sub-5" }, parts: [{ type: "text", text: "response" }] },
          { info: { role: "user", sessionID: "sub-5" }, parts: [{ type: "text", text: "second" }] },
        ] as MessageWithParts[],
      }

      await hook["experimental.chat.messages.transform"]!({}, output)

      // Count total identity injections across all messages
      let identityCount = 0
      for (const msg of output.messages) {
        for (const part of msg.parts) {
          if (part.text.includes("<identity>")) identityCount++
        }
      }
      expect(identityCount).toBe(1)
      // Should be in the last user message (index 2)
      expect(output.messages[2].parts[0].text).toContain("<identity>")
      // First user message should be untouched
      expect(output.messages[0].parts.length).toBe(1)
    })
  })
})
