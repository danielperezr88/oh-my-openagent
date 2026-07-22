import { describe, it, expect, beforeEach } from "bun:test"
import { createTodoNagHook } from "./hook"

type TextPart = { type: "text"; text: string }
type ToolResultPart = { type: "tool_result"; tool_use_id: string; content: string }
type Part = TextPart | ToolResultPart

interface MessageWithParts {
  info: { role: string; sessionID?: string }
  parts: Part[]
}

function makeUserMessage(sessionID: string, parts?: Part[]): MessageWithParts {
  return {
    info: { role: "user", sessionID },
    parts: parts ?? [{ type: "text", text: "do something" }],
  }
}

function makeAssistantMessage(sessionID: string): MessageWithParts {
  return {
    info: { role: "assistant", sessionID },
    parts: [],
  }
}

describe("createTodoNagHook", () => {
  let hook: ReturnType<typeof createTodoNagHook>

  beforeEach(() => {
    hook = createTodoNagHook({ nagThreshold: 3 })
  })

  const simulateToolCalls = async (
    hook: ReturnType<typeof createTodoNagHook>,
    sessionID: string,
    tools: string[]
  ) => {
    for (const tool of tools) {
      await hook["tool.execute.after"]!(
        { tool, sessionID, callID: `call-${tool}` },
        { title: "Result", output: "ok", metadata: {} }
      )
    }
  }

  describe("tool.execute.after counter", () => {
    it("should reset counter when task tool is used", async () => {
      await simulateToolCalls(hook, "sess-1", ["grep", "Read", "bash", "task_update"])

      const output = { messages: [makeUserMessage("sess-1")] }
      await hook["experimental.chat.messages.transform"]!({}, output)

      // Counter was reset by task_update, no nag
      expect(output.messages[0].parts.length).toBe(1)
    })

    it("should increment counter for non-task tools", async () => {
      await simulateToolCalls(hook, "sess-1", ["grep", "Read", "bash"])

      const output = { messages: [makeUserMessage("sess-1")] }
      await hook["experimental.chat.messages.transform"]!({}, output)

      // 3 rounds = threshold, should nag
      expect(output.messages[0].parts.length).toBe(2)
      const nagPart = output.messages[0].parts[0] as TextPart
      expect(nagPart.text).toContain("<reminder>")
    })

    it("should not nag before threshold", async () => {
      await simulateToolCalls(hook, "sess-1", ["grep", "Read"])

      const output = { messages: [makeUserMessage("sess-1")] }
      await hook["experimental.chat.messages.transform"]!({}, output)

      expect(output.messages[0].parts.length).toBe(1)
    })
  })

  describe("message injection", () => {
    it("should inject reminder at start of last user message", async () => {
      await simulateToolCalls(hook, "sess-1", ["grep", "Read", "bash"])

      const output = {
        messages: [
          makeUserMessage("sess-1"),
          makeAssistantMessage("sess-1"),
          makeUserMessage("sess-1", [{ type: "text", text: "next instruction" }]),
        ],
      }
      await hook["experimental.chat.messages.transform"]!({}, output)

      // Should inject into LAST user message (index 2), not first
      expect(output.messages[0].parts.length).toBe(1) // unchanged
      const lastUserMsg = output.messages[2]
      expect(lastUserMsg.parts.length).toBe(2)
      expect((lastUserMsg.parts[0] as TextPart).text).toContain("<reminder>")
      expect((lastUserMsg.parts[1] as TextPart).text).toBe("next instruction")
    })

    it("should not inject duplicate reminders", async () => {
      await simulateToolCalls(hook, "sess-1", ["grep", "Read", "bash"])

      const output = {
        messages: [
          makeUserMessage("sess-1", [
            { type: "text", text: "<reminder>already here</reminder>" },
            { type: "text", text: "instruction" },
          ]),
        ],
      }
      await hook["experimental.chat.messages.transform"]!({}, output)

      // Should not add another reminder
      expect(output.messages[0].parts.length).toBe(2)
    })
  })

  describe("session isolation", () => {
    it("should track counters independently per session", async () => {
      await simulateToolCalls(hook, "sess-1", ["grep", "Read", "bash"])
      await simulateToolCalls(hook, "sess-2", ["grep"])

      const output1 = { messages: [makeUserMessage("sess-1")] }
      const output2 = { messages: [makeUserMessage("sess-2")] }

      await hook["experimental.chat.messages.transform"]!({}, output1)
      await hook["experimental.chat.messages.transform"]!({}, output2)

      // sess-1 should be nagged (3 rounds)
      expect(output1.messages[0].parts.length).toBe(2)
      // sess-2 should not (1 round)
      expect(output2.messages[0].parts.length).toBe(1)
    })
  })

  describe("session cleanup", () => {
    it("should clean up state on session.deleted", async () => {
      await simulateToolCalls(hook, "sess-1", ["grep", "Read", "bash"])

      await hook.event!({ event: { type: "session.deleted", properties: { info: { id: "sess-1" } } } })

      // After deletion, a new session with same ID should start fresh
      const output = { messages: [makeUserMessage("sess-1")] }
      await hook["experimental.chat.messages.transform"]!({}, output)

      // No nag because state was cleared
      expect(output.messages[0].parts.length).toBe(1)
    })
  })

  describe("custom options", () => {
    it("should use custom nagMessage", async () => {
      const customHook = createTodoNagHook({ nagThreshold: 1, nagMessage: "CUSTOM_NAG" })
      await simulateToolCalls(customHook, "sess-1", ["grep"])

      const output = { messages: [makeUserMessage("sess-1")] }
      await customHook["experimental.chat.messages.transform"]!({}, output)

      expect((output.messages[0].parts[0] as TextPart).text).toBe("CUSTOM_NAG")
    })
  })
})
