import { describe, expect, test } from "bun:test"
import { isImageRequestPart, shouldStripRequestPart, stripMediaPartsFromMessages } from "./session-recovery-strip"

describe("isImageRequestPart", () => {
  describe("#given outgoing request parts in every shape the request layer can carry", () => {
    test("#then native image, lowered image_url, image files, and data URLs are detected", () => {
      // given
      const imageParts = [
        { type: "image" },
        { type: "image_url", image_url: { url: "data:image/png;base64,AAA" } },
        { type: "file", mime: "image/png" },
        { type: "file", mediaType: "image/jpeg" },
        { type: "file", mime: "IMAGE/PNG" },
        { type: "file", mimeType: "image/gif" },
        { type: "media", media: "data:image/png;base64,AAA" },
        { type: "media", mediaType: "image/webp" },
      ]

      // when / then
      for (const part of imageParts) {
        expect(isImageRequestPart(part)).toBe(true)
      }
    })

    test("#then text parts, non-image files, and non-image media are not image parts", () => {
      // given
      const otherParts = [
        { type: "text", text: "hello" },
        { type: "file", mime: "text/plain" },
        { type: "file", mime: "application/pdf" },
        { type: "file", mime: "text/plain", data: "plain text payload" },
        { type: "file" },
        { type: "media", media: "data:audio/wav;base64,AAA" },
        { type: "audio" },
        "image",
        null,
        undefined,
        {},
      ]

      // when / then
      for (const part of otherParts) {
        expect(isImageRequestPart(part)).toBe(false)
      }
    })
  })
})

describe("shouldStripRequestPart", () => {
  describe("#given a recovering session limited to text content", () => {
    test("#then every media carrier is stripped, image or not", () => {
      // given
      const parts = [
        { type: "media", media: "data:image/png;base64,AAA" },
        { type: "media", media: "raw-base64-without-mime" },
        { type: "image" },
        { type: "image_url", image_url: { url: "data:image/png;base64,AAA" } },
        { type: "file", mime: "image/png" },
      ]

      // when / then
      for (const part of parts) {
        expect(shouldStripRequestPart(part)).toBe(true)
      }
    })

    test("#then text and tool parts stay untouched", () => {
      // given
      const parts = [
        { type: "text", text: "hello" },
        { type: "tool-call", toolCallId: "call_1", toolName: "grep", args: {} },
        { type: "tool-result", toolCallId: "call_1", result: "match" },
        { type: "file", mime: "text/plain" },
        { type: "reasoning" },
      ]

      // when / then
      for (const part of parts) {
        expect(shouldStripRequestPart(part)).toBe(false)
      }
    })
  })
})

describe("stripMediaPartsFromMessages", () => {
  describe("#given a transcript carrying media parts in parts and content arrays", () => {
    test("#then media parts are replaced in place with placeholder text parts", () => {
      // given
      const imagePart = { type: "file", mime: "image/png", url: "data:image/png;base64,AAA" }
      const textPart = { type: "text", text: "describe this" }
      const partsMessage = { id: "msg_user_1", role: "user", parts: [textPart, imagePart] }
      const mediaPart = { type: "media", media: "data:image/png;base64,BBB" }
      const contentMessage = { role: "user", content: [{ type: "text", text: "and this" }, mediaPart] }
      const messages = [partsMessage, contentMessage]

      // when
      const stripped = stripMediaPartsFromMessages(messages)

      // then
      expect(stripped).toBe(2)
      expect(partsMessage.parts).toHaveLength(2)
      expect(partsMessage.parts[0]).toBe(textPart)
      expect(partsMessage.parts[1].type).toBe("text")
      expect(partsMessage.parts[1].text).toContain("[image attachment removed")
      expect(partsMessage.parts[1].text).toContain("msg_user_1")
      expect(contentMessage.content[0].text).toBe("and this")
      expect(contentMessage.content[1].type).toBe("text")
      expect(contentMessage.content[1].text).toContain("[image attachment removed")
    })

    test("#then undeterminable media parts get the generic media placeholder", () => {
      // given
      const audioLikePart = { type: "media", media: "raw-base64-without-mime" }
      const message = { id: "msg_user_2", role: "user", parts: [audioLikePart] }

      // when
      const stripped = stripMediaPartsFromMessages([message])

      // then
      expect(stripped).toBe(1)
      expect(message.parts[0].type).toBe("text")
      expect(message.parts[0].text).toContain("[media attachment removed")
      expect(message.parts[0].text).toContain("msg_user_2")
    })

    test("#then messages without segment arrays keep string content and junk entries untouched", () => {
      // given
      const messages: ReadonlyArray<unknown> = [
        { role: "user", content: "plain string content" },
        { role: "user" },
        null,
        "junk",
      ]

      // when
      const stripped = stripMediaPartsFromMessages(messages)

      // then
      expect(stripped).toBe(0)
      const first = messages[0] as { content: unknown }
      expect(first.content).toBe("plain string content")
    })

    test("#then transcripts without any media parts report zero and change nothing", () => {
      // given
      const messages = [
        {
          role: "assistant",
          parts: [
            { type: "text", text: "hi" },
            { type: "tool-call", toolCallId: "call_1", toolName: "grep", args: {} },
          ],
        },
      ]

      // when
      const stripped = stripMediaPartsFromMessages(messages)

      // then
      expect(stripped).toBe(0)
      expect(messages[0].parts[1].toolCallId).toBe("call_1")
    })
  })
})
