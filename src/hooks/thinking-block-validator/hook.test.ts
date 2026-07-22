declare const describe: (name: string, fn: () => void) => void
declare const it: (name: string, fn: () => void | Promise<void>) => void
declare const expect: <T>(value: T) => {
  toBe(expected: T): void
  toEqual(expected: unknown): void
  toHaveLength(expected: number): void
}

import { createThinkingBlockValidatorHook } from "./hook"

type TestPart = {
  type: string
  text?: string
  thinking?: string
  signature?: string
  synthetic?: boolean
}

type TestMessage = {
  info: { role: "assistant" | "user" }
  parts: TestPart[]
}

async function runTransform(messages: TestMessage[]): Promise<void> {
  const hook = createThinkingBlockValidatorHook()
  const transform = hook["experimental.chat.messages.transform"]

  if (!transform) {
    throw new Error("missing thinking block validator transform")
  }

  await transform({}, { messages: messages as never })
}

describe("createThinkingBlockValidatorHook", () => {
  it("injects signed thinking history verbatim", async () => {
    //#given
    const signedThinkingPart: TestPart = {
      type: "thinking",
      thinking: "plan",
      signature: "signed-thinking",
    }
    const messages = [
      {
        info: { role: "assistant" },
        parts: [signedThinkingPart],
      },
      {
        info: { role: "assistant" },
        parts: [{ type: "text", text: "continue" }],
      },
    ] satisfies TestMessage[]

    //#when
    await runTransform(messages)

    //#then
    expect(messages[1]?.parts[0]).toBe(signedThinkingPart)
  })

  it("injects signed redacted_thinking history verbatim", async () => {
    //#given
    const signedRedactedThinkingPart: TestPart = {
      type: "redacted_thinking",
      signature: "signed-redacted-thinking",
    }
    const messages = [
      {
        info: { role: "assistant" },
        parts: [signedRedactedThinkingPart],
      },
      {
        info: { role: "assistant" },
        parts: [{ type: "tool_use" }],
      },
    ] satisfies TestMessage[]

    //#when
    await runTransform(messages)

    //#then
    expect(messages[1]?.parts[0]).toBe(signedRedactedThinkingPart)
  })

  it("skips hook when history contains reasoning only", async () => {
    //#given
    const reasoningPart: TestPart = {
      type: "reasoning",
      text: "internal reasoning",
    }
    const messages = [
      {
        info: { role: "assistant" },
        parts: [reasoningPart],
      },
      {
        info: { role: "assistant" },
        parts: [{ type: "text", text: "continue" }],
      },
    ] satisfies TestMessage[]

    //#when
    await runTransform(messages)

    //#then
    expect(messages[1]?.parts).toEqual([{ type: "text", text: "continue" }])
  })

  it("skips hook when no thinking blocks exist in history", async () => {
    //#given
    const messages = [
      {
        info: { role: "assistant" },
        parts: [{ type: "text", text: "response" }],
      },
      {
        info: { role: "assistant" },
        parts: [{ type: "text", text: "continue" }],
      },
    ] satisfies TestMessage[]

    //#when
    await runTransform(messages)

    //#then
    expect(messages[1]?.parts).toEqual([{ type: "text", text: "continue" }])
  })

  it("skips hook when history contains synthetic signed blocks only", async () => {
    //#given
    const syntheticSignedPart: TestPart = {
      type: "thinking",
      thinking: "synthetic",
      signature: "synthetic-signature",
      synthetic: true,
    }
    const messages = [
      {
        info: { role: "assistant" },
        parts: [syntheticSignedPart],
      },
      {
        info: { role: "assistant" },
        parts: [{ type: "text", text: "continue" }],
      },
    ] satisfies TestMessage[]

    //#when
    await runTransform(messages)

    //#then
    expect(messages[1]?.parts).toEqual([{ type: "text", text: "continue" }])
  })

  it("does not reinject when the message already starts with redacted_thinking", async () => {
    //#given
    const signedThinkingPart: TestPart = {
      type: "thinking",
      thinking: "plan",
      signature: "signed-thinking",
    }
    const leadingRedactedThinkingPart: TestPart = {
      type: "redacted_thinking",
      signature: "existing-redacted-thinking",
    }
    const messages = [
      {
        info: { role: "assistant" },
        parts: [signedThinkingPart],
      },
      {
        info: { role: "assistant" },
        parts: [leadingRedactedThinkingPart, { type: "text", text: "continue" }],
      },
    ] satisfies TestMessage[]

    //#when
    await runTransform(messages)

    //#then
    expect(messages[1]?.parts[0]).toBe(leadingRedactedThinkingPart)
    expect(messages[1]?.parts).toHaveLength(2)
  })

  // DeepSeek V4 Pro — unsigned thinking blocks (no signature)

  it("skips injection for unsigned DeepSeek-style thinking blocks (no signature)", async () => {
    // Unsigned thinking blocks lack the Anthropic signature required for API
    // validation.  Injecting them would cause a guaranteed API rejection, so the
    // hook deliberately skips them.
    //#given
    const unsignedThinkingPart: TestPart = {
      type: "thinking",
      thinking: "DeepSeek reasoning content",
      // No signature field — DeepSeek V4 Pro via Anthropic-compatible API
    }
    const messages = [
      {
        info: { role: "assistant" },
        parts: [unsignedThinkingPart],
      },
      {
        info: { role: "assistant" },
        parts: [{ type: "tool_use" }],
      },
    ] satisfies TestMessage[]

    //#when
    await runTransform(messages)

    //#then
    expect(messages[1]?.parts).toEqual([{ type: "tool_use" }])
  })

  it("skips injection when history has unsigned thinking only (no signature)", async () => {
    // Unsigned thinking blocks cannot pass Anthropic signature validation,
    // so the hook skips injection entirely rather than risk API rejection.
    //#given
    const unsignedThinkingPart: TestPart = {
      type: "thinking",
      thinking: "draft",
    }
    const messages = [
      {
        info: { role: "assistant" },
        parts: [unsignedThinkingPart],
      },
      {
        info: { role: "assistant" },
        parts: [{ type: "text", text: "continue" }],
      },
    ] satisfies TestMessage[]

    //#when
    await runTransform(messages)

    //#then
    expect(messages[1]?.parts).toEqual([{ type: "text", text: "continue" }])
  })

  it("skips injection when missing thinking block follows system directive (DeepSeek unsigned)", async () => {
    // Unsigned thinking blocks cannot pass Anthropic signature validation.
    // When the only available thinking block is unsigned (no signature), the
    // hook cannot safely inject it, even after a system directive injection.
    //#given
    const thinkingPart: TestPart = {
      type: "thinking",
      thinking: "reasoning about the code",
    }
    const messages = [
      {
        info: { role: "assistant" },
        parts: [thinkingPart, { type: "tool_use" }],
      },
      {
        info: { role: "user" },
        parts: [{ type: "text", text: "[SYSTEM DIRECTIVE: OH-MY-OPENCODE - TODO CONTINUATION] Check todos" }],
      },
      {
        info: { role: "assistant" },
        parts: [{ type: "tool_use" }], // Missing leading thinking block
      },
    ] satisfies TestMessage[]

    //#when
    await runTransform(messages)

    //#then
    expect(messages[2]?.parts).toEqual([{ type: "tool_use" }])
  })

  it("skips synthetic unsigned thinking blocks", async () => {
    //#given
    const syntheticUnsignedPart: TestPart = {
      type: "thinking",
      thinking: "synthetic draft",
      synthetic: true,
      // No signature — unsigned but synthetic
    }
    const messages = [
      {
        info: { role: "assistant" },
        parts: [syntheticUnsignedPart],
      },
      {
        info: { role: "assistant" },
        parts: [{ type: "text", text: "continue" }],
      },
    ] satisfies TestMessage[]

    //#when
    await runTransform(messages)

    //#then
    expect(messages[1]?.parts).toEqual([{ type: "text", text: "continue" }])
  })

  it("prefers signed thinking block over unsigned when both exist", async () => {
    // When history contains both signed and unsigned thinking blocks, only the
    // signed block can be safely injected (unsigned blocks fail Anthropic API
    // signature validation). The hook finds the most recent SIGNED block.
    //#given
    const signedThinkingPart: TestPart = {
      type: "thinking",
      thinking: "signed plan",
      signature: "valid-signature",
    }
    const unsignedThinkingPart: TestPart = {
      type: "thinking",
      thinking: "unsigned plan",
    }
    const messages = [
      {
        info: { role: "assistant" },
        parts: [signedThinkingPart],
      },
      {
        info: { role: "assistant" },
        parts: [unsignedThinkingPart],
      },
      {
        info: { role: "assistant" },
        parts: [{ type: "tool_use" }],
      },
    ] satisfies TestMessage[]

    //#when
    await runTransform(messages)

    //#then
    // The signed block from message 0 is the only one eligible for injection.
    // The unsigned block in message 1 is skipped (no valid signature).
    expect(messages[2]?.parts[0]).toBe(signedThinkingPart)
    expect(messages[2]?.parts).toHaveLength(2)
  })
})
