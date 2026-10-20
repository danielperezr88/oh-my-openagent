import { describe, expect, test } from "bun:test"
import { extractLastUserText } from "./instinct-injection"

describe("extractLastUserText", () => {
  describe("#given V2 messages using the content field", () => {
    test("#then the latest user text is extracted", () => {
      // given
      const messages = [
        { role: "user", content: [{ type: "text", text: "first question about tests" }] },
        { role: "assistant", content: [{ type: "text", text: "an answer" }] },
        { role: "user", content: [{ type: "text", text: "what about pineapples on sandwiches" }] },
      ]

      // when
      const text = extractLastUserText(messages)

      // then
      expect(text).toBe("what about pineapples on sandwiches")
    })
  })

  describe("#given messages using the legacy parts field", () => {
    test("#then the latest user text is still extracted", () => {
      // given
      const messages = [
        { role: "user", parts: [{ type: "text", text: "legacy shaped message" }] },
      ]

      // when
      const text = extractLastUserText(messages)

      // then
      expect(text).toBe("legacy shaped message")
    })
  })

  describe("#given no user messages", () => {
    test("#then the result is empty", () => {
      // given
      const messages = [{ role: "assistant", content: [{ type: "text", text: "only assistant" }] }]

      // when
      const text = extractLastUserText(messages)

      // then
      expect(text).toBe("")
    })
  })
})
