declare const require: (name: string) => any
const { describe, expect, test } = require("bun:test")
const { createPlatformErrorFilterHook } = await import("./hook")

describe("platform-error-filter", () => {
  const hook = createPlatformErrorFilterHook()
  const transform = hook["experimental.chat.messages.transform"]!

  test("removes assistant messages with z.ai platform error codes", async () => {
    //#given
    const messages = [
      { info: { role: "user", text: "hello" }, parts: [{ type: "text", text: "hello" }] },
      { info: { role: "assistant", error: { name: "APIError", data: { responseBody: '{"error":{"code":"1305","message":"overloaded"}}' } } }, parts: [] },
      { info: { role: "user", text: "retry" }, parts: [{ type: "text", text: "retry" }] },
    ]

    //#when
    await transform({}, { messages })

    //#then
    expect(messages.length).toBe(2)
    expect(messages[0].info.role).toBe("user")
    expect(messages[1].info.role).toBe("user")
  })

  test("removes assistant messages with error code 1308 (usage limit)", async () => {
    //#given
    const messages = [
      { info: { role: "user", text: "do something" }, parts: [{ type: "text", text: "do something" }] },
      { info: { role: "assistant", id: "msg_abc", error: { name: "APIError", data: { message: 'Type validation failed: Value: {"error":{"code":"1308","message":"Usage limit reached"}}' } } }, parts: [] },
    ]

    //#when
    await transform({}, { messages })

    //#then
    expect(messages.length).toBe(1)
    expect(messages[0].info.role).toBe("user")
  })

  test("removes assistant messages with error code 1234 (network error)", async () => {
    //#given
    const messages = [
      { info: { role: "assistant", error: { name: "APIError", data: { responseBody: '{"error":{"code":"1234","message":"Network error"}}' } } }, parts: [] },
    ]

    //#when
    await transform({}, { messages })

    //#then
    expect(messages.length).toBe(0)
  })

  test("keeps assistant messages without errors", async () => {
    //#given
    const messages = [
      { info: { role: "user", text: "hello" }, parts: [{ type: "text", text: "hello" }] },
      { info: { role: "assistant" }, parts: [{ type: "text", text: "Hi there!" }] },
    ]

    //#when
    await transform({}, { messages })

    //#then
    expect(messages.length).toBe(2)
  })

  test("keeps assistant messages with non-platform errors", async () => {
    //#given
    const messages = [
      { info: { role: "assistant", error: { name: "QuotaExceededError", message: "quota exceeded" } }, parts: [] },
    ]

    //#when
    await transform({}, { messages })

    //#then
    expect(messages.length).toBe(1)
  })

  test("handles empty messages array", async () => {
    //#given
    const messages: any[] = []

    //#when
    await transform({}, { messages })

    //#then
    expect(messages.length).toBe(0)
  })
})

export {}
