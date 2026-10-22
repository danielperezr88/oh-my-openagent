import { describe, expect, test } from "bun:test"
import {
  buildSyntheticToolResultPart,
  injectMissingToolResults,
  isToolCallRequestPart,
  isToolResultRequestPart,
  summarizeToolPairs,
  UNAVAILABLE_TOOL_RESULT_TEXT,
} from "./session-recovery-tool-results"

describe("isToolCallRequestPart", () => {
  describe("#given outgoing request parts in v2 and legacy wire shapes", () => {
    test("#then tool-call and tool_use parts with id and name are detected", () => {
      // given
      const callParts = [
        { type: "tool-call", id: "call_1", name: "bash", input: {} },
        { type: "tool_use", id: "toolu_1", name: "grep", input: {} },
        { type: "tool-call", id: "call_2", name: "read", namespace: "lsp", input: {} },
      ]

      // when / then
      for (const part of callParts) {
        expect(isToolCallRequestPart(part)).toBe(true)
      }
    })

    test("#then tool results, unnamed calls, and junk are not tool calls", () => {
      // given
      const otherParts = [
        { type: "tool-result", id: "call_1", name: "bash", result: {} },
        { type: "tool-call", name: "bash", input: {} },
        { type: "tool-call", id: "call_1", input: {} },
        { type: "text", text: "hi" },
        "tool-call",
        null,
        {},
      ]

      // when / then
      for (const part of otherParts) {
        expect(isToolCallRequestPart(part)).toBe(false)
      }
    })
  })
})

describe("isToolResultRequestPart", () => {
  describe("#given outgoing request result parts in v2 and legacy wire shapes", () => {
    test("#then tool-result and tool_result parts with an id are detected, junk is not", () => {
      // given
      const resultParts = [
        { type: "tool-result", id: "call_1", name: "bash", result: { type: "error", value: "boom" } },
        { type: "tool_result", id: "toolu_1", toolUseId: "toolu_1", content: [] },
      ]
      const otherParts = [
        { type: "tool-call", id: "call_1", name: "bash" },
        { type: "tool-result", name: "bash" },
        "tool-result",
        null,
      ]

      // when / then
      for (const part of resultParts) {
        expect(isToolResultRequestPart(part)).toBe(true)
      }
      for (const part of otherParts) {
        expect(isToolResultRequestPart(part)).toBe(false)
      }
    })
  })
})

describe("buildSyntheticToolResultPart", () => {
  describe("#given an orphaned tool call", () => {
    test("#then a v2 tool-result part carrying an error result value is built, namespace preserved", () => {
      // given
      const call = { id: "call_9", name: "bash", namespace: "lsp" }

      // when
      const part = buildSyntheticToolResultPart(call, UNAVAILABLE_TOOL_RESULT_TEXT)

      // then
      expect(part.type).toBe("tool-result")
      expect(part.id).toBe("call_9")
      expect(part.name).toBe("bash")
      expect(part.namespace).toBe("lsp")
      expect(part.result).toEqual({ type: "error", value: UNAVAILABLE_TOOL_RESULT_TEXT })
    })

    test("#then calls without a namespace omit the namespace field", () => {
      // given
      const call = { id: "call_9", name: "bash" }

      // when
      const part = buildSyntheticToolResultPart(call, UNAVAILABLE_TOOL_RESULT_TEXT)

      // then
      expect("namespace" in part).toBe(false)
    })
  })
})

describe("summarizeToolPairs", () => {
  describe("#given a transcript with calls and results", () => {
    test("#then ids, names, and result counts are summarized", () => {
      // given
      const messages = [
        {
          role: "assistant",
          content: [
            { type: "tool-call", id: "call_1", name: "bash", input: {} },
            { type: "tool-call", id: "call_2", name: "grep", input: {} },
          ],
        },
        { role: "tool", content: [{ type: "tool-result", id: "call_1", name: "bash", result: {} }] },
      ]

      // when
      const summary = summarizeToolPairs(messages)

      // then
      expect(summary).toContain("toolCalls=2")
      expect(summary).toContain("call_1:bash")
      expect(summary).toContain("call_2:grep")
      expect(summary).toContain("toolResults=1")
    })
  })
})

describe("injectMissingToolResults", () => {
  describe("#given a transcript with an orphaned tool call", () => {
    test("#then a role tool message with the synthetic result is inserted right after the assistant", () => {
      // given
      const messages = [
        { role: "user", content: [{ type: "text", text: "run it" }] },
        {
          role: "assistant",
          content: [
            { type: "text", text: "calling" },
            { type: "tool-call", id: "call_1", name: "bash", input: { command: "echo hi" } },
          ],
        },
        { role: "user", content: [{ type: "text", text: "continue" }] },
      ]

      // when
      const injected = injectMissingToolResults(messages, "Operation cancelled by user (ESC pressed)")

      // then
      expect(injected).toBe(1)
      expect(messages).toHaveLength(4)
      expect(messages[2].role).toBe("tool")
      const resultPart = (messages[2] as { content: Record<string, unknown>[] }).content[0]
      expect(resultPart.type).toBe("tool-result")
      expect(resultPart.id).toBe("call_1")
      expect(resultPart.name).toBe("bash")
      expect(resultPart.result).toEqual({ type: "error", value: "Operation cancelled by user (ESC pressed)" })
    })

    test("#then the tool message is appended when the orphan ends the transcript", () => {
      // given
      const messages = [
        { role: "user", content: [{ type: "text", text: "run it" }] },
        { role: "assistant", content: [{ type: "tool-call", id: "call_2", name: "glob", input: {} }] },
      ]

      // when
      const injected = injectMissingToolResults(messages, "cancelled")

      // then
      expect(injected).toBe(1)
      expect(messages).toHaveLength(3)
      expect(messages[2].role).toBe("tool")
    })

    test("#then missing results are appended to an existing following tool message instead of inserting a new one", () => {
      // given
      const existingResult = { type: "tool-result", id: "call_1", name: "bash", result: { type: "text", value: "ok" } }
      const messages = [
        {
          role: "assistant",
          content: [
            { type: "tool-call", id: "call_1", name: "bash", input: {} },
            { type: "tool-call", id: "call_2", name: "grep", input: {} },
          ],
        },
        { role: "tool", content: [existingResult] },
        { role: "user", content: [{ type: "text", text: "go on" }] },
      ]

      // when
      const injected = injectMissingToolResults(messages, "cancelled")

      // then
      expect(injected).toBe(1)
      expect(messages).toHaveLength(3)
      const toolMessageContent = (messages[1] as { content: unknown[] }).content
      expect(toolMessageContent).toHaveLength(2)
      expect(toolMessageContent[0]).toBe(existingResult)
      expect((toolMessageContent[1] as { id: string }).id).toBe("call_2")
    })

    test("#then orphans in several assistant messages each get a tool message after their assistant", () => {
      // given
      const messages = [
        { role: "assistant", content: [{ type: "tool-call", id: "call_a", name: "bash", input: {} }] },
        { role: "user", content: [{ type: "text", text: "more" }] },
        { role: "assistant", content: [{ type: "tool-call", id: "call_b", name: "grep", input: {} }] },
      ]

      // when
      const injected = injectMissingToolResults(messages, "cancelled")

      // then
      expect(injected).toBe(2)
      expect(messages).toHaveLength(5)
      expect(messages[1].role).toBe("tool")
      expect(messages[4].role).toBe("tool")
      expect((messages[1] as { content: { id: string }[] }).content[0].id).toBe("call_a")
      expect((messages[4] as { content: { id: string }[] }).content[0].id).toBe("call_b")
    })

    test("#then parts-array messages and legacy tool_use wire shapes are handled too", () => {
      // given
      const messages = [
        {
          role: "assistant",
          parts: [
            { type: "text", text: "calling" },
            { type: "tool_use", id: "toolu_7", name: "webfetch", input: {} },
          ],
        },
      ]

      // when
      const injected = injectMissingToolResults(messages, "cancelled")

      // then
      expect(injected).toBe(1)
      expect(messages).toHaveLength(2)
      expect(messages[1].role).toBe("tool")
      const resultPart = (messages[1] as { content: Record<string, unknown>[] }).content[0]
      expect(resultPart.id).toBe("toolu_7")
      expect(resultPart.name).toBe("webfetch")
    })
  })

  describe("#given a transcript with every tool call paired", () => {
    test("#then nothing is injected and the transcript is untouched", () => {
      // given
      const messages = [
        {
          role: "assistant",
          content: [
            { type: "tool-call", id: "call_1", name: "bash", input: {} },
            { type: "tool-call", id: "call_2", name: "grep", input: {} },
          ],
        },
        {
          role: "tool",
          content: [{ type: "tool-result", id: "call_1", name: "bash", result: {} }],
        },
        {
          role: "user",
          content: [
            { type: "tool-result", id: "call_2", name: "grep", result: {} },
            { type: "text", text: "done" },
          ],
        },
      ]

      // when
      const injected = injectMissingToolResults(messages, "cancelled")

      // then
      expect(injected).toBe(0)
      expect(messages).toHaveLength(3)
    })
  })

  describe("#given junk and unsegmentable messages", () => {
    test("#then nothing is injected and no error escapes", () => {
      // given
      const messages: ReadonlyArray<unknown> = [
        { role: "user", content: "plain string content" },
        { role: "assistant" },
        null,
        "junk",
        { role: "assistant", content: [{ type: "text", text: "no calls here" }] },
      ]

      // when
      const injected = injectMissingToolResults(messages, "cancelled")

      // then
      expect(injected).toBe(0)
      expect(messages[0]).toEqual({ role: "user", content: "plain string content" })
    })
  })
})
