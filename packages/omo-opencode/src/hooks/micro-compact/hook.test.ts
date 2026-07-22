import { describe, it, expect } from "bun:test"
import { createMicroCompactHook } from "./hook"

type ToolUsePart = {
  type: "tool_use"
  id: string
  name: string
}

type ToolResultPart = {
  type: "tool_result"
  tool_use_id: string
  content: string
}

type TextPart = {
  type: "text"
  text: string
}

type Part = ToolUsePart | ToolResultPart | TextPart

type MessageWithParts = {
  info: { role: string; sessionID?: string }
  parts: Part[]
}

function makeToolUse(id: string, name: string): ToolUsePart {
  return { type: "tool_use", id, name }
}

function makeToolResult(toolUseID: string, content: string): ToolResultPart {
  return { type: "tool_result", tool_use_id: toolUseID, content }
}

function makeText(text: string): TextPart {
  return { type: "text", text }
}

function createMessages(pairs: Array<{ toolName: string; resultContent: string }>): MessageWithParts[] {
  const messages: MessageWithParts[] = []

  for (const pair of pairs) {
    const id = `call_${pair.toolName}_${messages.length}`
    // Assistant message with tool_use
    messages.push({
      info: { role: "assistant" },
      parts: [makeToolUse(id, pair.toolName)],
    })
    // User message with tool_result
    messages.push({
      info: { role: "user" },
      parts: [makeToolResult(id, pair.resultContent)],
    })
  }

  return messages
}

describe("createMicroCompactHook", () => {
  const hook = createMicroCompactHook()
  const transform = hook["experimental.chat.messages.transform"]!

  describe("given fewer tool results than keepRecent", () => {
    it("should not decay any results", async () => {
      const messages = createMessages([
        { toolName: "grep", resultContent: "x".repeat(300) },
        { toolName: "Read", resultContent: "y".repeat(300) },
      ])

      await transform({}, { messages })

      expect((messages[1].parts[0] as ToolResultPart).content).toBe("x".repeat(300))
      expect((messages[3].parts[0] as ToolResultPart).content).toBe("y".repeat(300))
    })
  })

  describe("given more tool results than keepRecent", () => {
    it("should decay old large results and keep recent ones", async () => {
      const messages = createMessages([
        { toolName: "grep", resultContent: "a".repeat(500) },    // idx 0 - should decay
        { toolName: "Read", resultContent: "b".repeat(500) },    // idx 1 - should decay
        { toolName: "bash", resultContent: "c".repeat(300) },    // idx 2 - should decay
        { toolName: "Grep", resultContent: "d".repeat(300) },    // idx 3 - kept (recent 5 start)
        { toolName: "Read", resultContent: "e".repeat(300) },    // idx 4 - kept
        { toolName: "glob", resultContent: "f".repeat(300) },    // idx 5 - kept
        { toolName: "grep", resultContent: "g".repeat(300) },    // idx 6 - kept
        { toolName: "bash", resultContent: "h".repeat(300) },    // idx 7 - kept
      ])

      await transform({}, { messages })

      // First 3 should be decayed
      expect((messages[1].parts[0] as ToolResultPart).content).toBe("[Previous: used grep]")
      expect((messages[3].parts[0] as ToolResultPart).content).toBe("[Previous: used Read]")
      expect((messages[5].parts[0] as ToolResultPart).content).toBe("[Previous: used bash]")
      // Last 5 should remain intact
      expect((messages[7].parts[0] as ToolResultPart).content).toBe("d".repeat(300))
      expect((messages[9].parts[0] as ToolResultPart).content).toBe("e".repeat(300))
      expect((messages[11].parts[0] as ToolResultPart).content).toBe("f".repeat(300))
      expect((messages[13].parts[0] as ToolResultPart).content).toBe("g".repeat(300))
      expect((messages[15].parts[0] as ToolResultPart).content).toBe("h".repeat(300))
    })
  })

  describe("given small content below minContentSize", () => {
    it("should not decay small results even if old", async () => {
      const messages = createMessages([
        { toolName: "grep", resultContent: "small" },             // 5 chars, below 200 threshold
        { toolName: "bash", resultContent: "b".repeat(300) },    // should decay
        { toolName: "Read", resultContent: "c".repeat(300) },    // kept (recent)
        { toolName: "Grep", resultContent: "d".repeat(300) },    // kept (recent)
        { toolName: "Read", resultContent: "e".repeat(300) },    // kept (recent)
        { toolName: "glob", resultContent: "f".repeat(300) },    // kept (recent)
        { toolName: "grep", resultContent: "g".repeat(300) },    // kept (recent)
      ])

      await transform({}, { messages })

      // Small content preserved even though old
      expect((messages[1].parts[0] as ToolResultPart).content).toBe("small")
      // Large old content decayed
      expect((messages[3].parts[0] as ToolResultPart).content).toBe("[Previous: used bash]")
    })
  })

  describe("given custom options", () => {
    it("should respect custom keepRecent and minContentSize", async () => {
      const customHook = createMicroCompactHook({ keepRecent: 2, minContentSize: 50 })
      const customTransform = customHook["experimental.chat.messages.transform"]!

      const messages = createMessages([
        { toolName: "grep", resultContent: "a".repeat(100) },    // should decay (old, large)
        { toolName: "Read", resultContent: "short" },             // should NOT decay (small < 50)
        { toolName: "bash", resultContent: "c".repeat(100) },    // kept (recent 2)
        { toolName: "Grep", resultContent: "d".repeat(100) },    // kept (recent 1)
      ])

      await customTransform({}, { messages })

      expect((messages[1].parts[0] as ToolResultPart).content).toBe("[Previous: used grep]")
      expect((messages[3].parts[0] as ToolResultPart).content).toBe("short")
      expect((messages[5].parts[0] as ToolResultPart).content).toBe("c".repeat(100))
      expect((messages[7].parts[0] as ToolResultPart).content).toBe("d".repeat(100))
    })
  })

  describe("given empty messages array", () => {
    it("should handle gracefully", async () => {
      const messages: MessageWithParts[] = []
      await transform({}, { messages })
      // No error thrown = pass
    })
  })

  describe("given messages with no tool results", () => {
    it("should handle gracefully", async () => {
      const messages: MessageWithParts[] = [
        { info: { role: "user" }, parts: [makeText("Hello")] },
        { info: { role: "assistant" }, parts: [makeText("Hi there")] },
      ]

      await transform({}, { messages })

      expect((messages[0].parts[0] as TextPart).text).toBe("Hello")
      expect((messages[1].parts[0] as TextPart).text).toBe("Hi there")
    })
  })

  describe("given tool results where placeholder would be longer", () => {
    it("should not replace content if placeholder is not shorter", async () => {
      // "[Previous: used a_very_long_tool_name_that_exceeds_content]" is longer than "hi"
      const customHook = createMicroCompactHook({ keepRecent: 1, minContentSize: 1 })
      const customTransform = customHook["experimental.chat.messages.transform"]!

      const messages = createMessages([
        { toolName: "a_very_long_tool_name_that_exceeds_content", resultContent: "hi" },
        { toolName: "grep", resultContent: "result" },
      ])

      await customTransform({}, { messages })

      // Content "hi" is 2 chars, placeholder would be ~60 chars - so should NOT replace
      expect((messages[1].parts[0] as ToolResultPart).content).toBe("hi")
    })
  })
})
