import { describe, it, expect, beforeEach } from "bun:test"
import { createBackgroundResultInjectionHook } from "./hook"

type TextPart = { type: "text"; text: string }

interface MessageWithParts {
  info: { role: string; sessionID?: string }
  parts: TextPart[]
}

function createMockBackgroundManager(tasks: Array<{ id: string; status: string; result?: string; description?: string }>) {
  let currentTasks = [...tasks]
  return {
    getPendingNotifications: (_sessionID: string) => currentTasks,
    clearNotifications: (_sessionID: string) => { currentTasks = [] },
  } as unknown as Parameters<typeof createBackgroundResultInjectionHook>[0]
}

describe("createBackgroundResultInjectionHook", () => {
  let mockManager: ReturnType<typeof createMockBackgroundManager>

  describe("given completed background tasks", () => {
    it("should inject structured <background-results> into last user message", async () => {
      mockManager = createMockBackgroundManager([
        { id: "bg-1", status: "completed", result: "Result from task 1", description: "Test task" },
      ])

      const hook = createBackgroundResultInjectionHook(mockManager)
      const output = {
        messages: [
          { info: { role: "user", sessionID: "sess-1" }, parts: [{ type: "text", text: "continue" }] },
        ] as MessageWithParts[],
      }

      await hook["experimental.chat.messages.transform"]!({}, output)

      expect(output.messages[0].parts.length).toBe(2)
      expect(output.messages[0].parts[0].text).toContain("<background-results>")
      expect(output.messages[0].parts[0].text).toContain("[bg:bg-1]")
      expect(output.messages[0].parts[0].text).toContain("Result from task 1")
    })

    it("should truncate long results with hint to use background_output", async () => {
      mockManager = createMockBackgroundManager([
        { id: "bg-2", status: "completed", result: "x".repeat(600), description: "Long task" },
      ])

      const hook = createBackgroundResultInjectionHook(mockManager, { maxInjectionLength: 100 })
      const output = {
        messages: [
          { info: { role: "user", sessionID: "sess-1" }, parts: [{ type: "text", text: "continue" }] },
        ] as MessageWithParts[],
      }

      await hook["experimental.chat.messages.transform"]!({}, output)

      const injected = output.messages[0].parts[0].text
      expect(injected).toContain("truncated")
      expect(injected).toContain("background_output")
    })

    it("should skip non-completed tasks", async () => {
      mockManager = createMockBackgroundManager([
        { id: "bg-3", status: "running", result: "still running" },
        { id: "bg-4", status: "completed", result: "done" },
      ])

      const hook = createBackgroundResultInjectionHook(mockManager)
      const output = {
        messages: [
          { info: { role: "user", sessionID: "sess-1" }, parts: [{ type: "text", text: "continue" }] },
        ] as MessageWithParts[],
      }

      await hook["experimental.chat.messages.transform"]!({}, output)

      const injected = output.messages[0].parts[0].text
      expect(injected).not.toContain("[bg:bg-3]")
      expect(injected).toContain("[bg:bg-4]")
    })
  })

  describe("given no completed tasks", () => {
    it("should not inject anything", async () => {
      mockManager = createMockBackgroundManager([])

      const hook = createBackgroundResultInjectionHook(mockManager)
      const output = {
        messages: [
          { info: { role: "user", sessionID: "sess-1" }, parts: [{ type: "text", text: "continue" }] },
        ] as MessageWithParts[],
      }

      await hook["experimental.chat.messages.transform"]!({}, output)

      expect(output.messages[0].parts.length).toBe(1)
    })
  })

  describe("given empty messages", () => {
    it("should handle gracefully", async () => {
      mockManager = createMockBackgroundManager([
        { id: "bg-5", status: "completed", result: "result" },
      ])

      const hook = createBackgroundResultInjectionHook(mockManager)
      const output = { messages: [] as MessageWithParts[] }

      await hook["experimental.chat.messages.transform"]!({}, output)
      // No error = pass
    })
  })

  describe("notification clearing", () => {
    it("should clear notifications after injection to prevent re-injection", async () => {
      mockManager = createMockBackgroundManager([
        { id: "bg-6", status: "completed", result: "Result from task" },
      ])

      const hook = createBackgroundResultInjectionHook(mockManager)
      const output1 = {
        messages: [
          { info: { role: "user", sessionID: "sess-1" }, parts: [{ type: "text" as const, text: "continue" }] },
        ] as MessageWithParts[],
      }

      // First call: injects and clears
      await hook["experimental.chat.messages.transform"]!({}, output1)
      expect(output1.messages[0].parts.length).toBe(2)
      expect(output1.messages[0].parts[0].text).toContain("[bg:bg-6]")

      // Second call on fresh messages: should NOT re-inject because cleared
      const output2 = {
        messages: [
          { info: { role: "user", sessionID: "sess-1" }, parts: [{ type: "text" as const, text: "next turn" }] },
        ] as MessageWithParts[],
      }

      await hook["experimental.chat.messages.transform"]!({}, output2)
      expect(output2.messages[0].parts.length).toBe(1)
    })
  })
})
