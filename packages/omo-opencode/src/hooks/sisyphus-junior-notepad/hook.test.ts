declare const require: (name: string) => any
const { afterEach, beforeEach, describe, expect, mock, test } = require("bun:test")

import { SYSTEM_DIRECTIVE_PREFIX } from "../../shared/system-directive"

const mockIsCallerOrchestrator = mock<(sessionId: string, client?: any) => Promise<boolean>>(
  async () => false,
)

mock.module("../../shared/session-utils", () => ({
  isCallerOrchestrator: mockIsCallerOrchestrator,
}))

mock.module("../../shared/logger", () => ({
  log: mock(() => {}),
}))

afterEach(() => {
  mock.restore()
})

const { createSisyphusJuniorNotepadHook } = await import("./hook")
const { HOOK_NAME, NOTEPAD_DIRECTIVE } = await import("./constants")

function createMockCtx() {
  return { client: {} } as any
}

function createInput(overrides: Partial<{ tool: string; sessionID: string; callID: string }> = {}) {
  return {
    tool: overrides.tool ?? "task",
    sessionID: overrides.sessionID ?? "session-123",
    callID: overrides.callID ?? "call-123",
  }
}

function createOutput(overrides: Partial<{ prompt?: string; [key: string]: unknown }> = {}) {
  return {
    args: {
      prompt: overrides.prompt ?? "Do some work",
      ...overrides,
    },
  }
}

describe("sisyphus-junior-notepad constants", () => {
  test("HOOK_NAME is 'sisyphus-junior-notepad'", () => {
    expect(HOOK_NAME).toBe("sisyphus-junior-notepad")
  })

  test("NOTEPAD_DIRECTIVE contains expected header", () => {
    expect(NOTEPAD_DIRECTIVE).toContain("<Work_Context>")
  })

  test("NOTEPAD_DIRECTIVE contains notepad path", () => {
    expect(NOTEPAD_DIRECTIVE).toContain("NOTEPAD PATH: .omo/notepads/{plan-name}/")
  })

  test("NOTEPAD_DIRECTIVE contains plan location section", () => {
    expect(NOTEPAD_DIRECTIVE).toContain("## Plan Location (subagent: READ ONLY)")
  })

  test("NOTEPAD_DIRECTIVE contains append instruction", () => {
    expect(NOTEPAD_DIRECTIVE).toContain("Always APPEND to notepad files")
  })

  test("NOTEPAD_DIRECTIVE contains read-only rule for plan file", () => {
    expect(NOTEPAD_DIRECTIVE).toContain("You MUST NOT edit the plan file")
  })
})

describe("createSisyphusJuniorNotepadHook", () => {
  let ctx: ReturnType<typeof createMockCtx>

  beforeEach(() => {
    ctx = createMockCtx()
    mockIsCallerOrchestrator.mockReset()
  })

  test("ignores non-task tools", async () => {
    mockIsCallerOrchestrator.mockResolvedValue(true)
    const hook = createSisyphusJuniorNotepadHook(ctx)
    const output = createOutput()

    await hook["tool.execute.before"](createInput({ tool: "read" }), output)

    expect(output.args.prompt).toBe("Do some work")
    expect(mockIsCallerOrchestrator).not.toHaveBeenCalled()
  })

  test("ignores when caller is not orchestrator", async () => {
    mockIsCallerOrchestrator.mockResolvedValue(false)
    const hook = createSisyphusJuniorNotepadHook(ctx)
    const output = createOutput()

    await hook["tool.execute.before"](createInput(), output)

    expect(output.args.prompt).toBe("Do some work")
  })

  test("ignores when prompt is undefined", async () => {
    mockIsCallerOrchestrator.mockResolvedValue(true)
    const hook = createSisyphusJuniorNotepadHook(ctx)
    const output = { args: {} }

    await hook["tool.execute.before"](createInput(), output)

    expect(output.args.prompt).toBeUndefined()
  })

  test("ignores when prompt is empty string", async () => {
    mockIsCallerOrchestrator.mockResolvedValue(true)
    const hook = createSisyphusJuniorNotepadHook(ctx)
    const output = createOutput({ prompt: "" })

    await hook["tool.execute.before"](createInput(), output)

    expect(output.args.prompt).toBe("")
  })

  test("ignores double injection when prompt contains SYSTEM_DIRECTIVE_PREFIX", async () => {
    mockIsCallerOrchestrator.mockResolvedValue(true)
    const hook = createSisyphusJuniorNotepadHook(ctx)
    const alreadyInjected = `${SYSTEM_DIRECTIVE_PREFIX} - SOME_TYPE] some content`
    const output = createOutput({ prompt: alreadyInjected })

    await hook["tool.execute.before"](createInput(), output)

    expect(output.args.prompt).toBe(alreadyInjected)
  })

  test("prepends NOTEPAD_DIRECTIVE to prompt", async () => {
    mockIsCallerOrchestrator.mockResolvedValue(true)
    const hook = createSisyphusJuniorNotepadHook(ctx)
    const originalPrompt = "Please implement the feature"
    const output = createOutput({ prompt: originalPrompt })

    await hook["tool.execute.before"](createInput(), output)

    expect(output.args.prompt).toBe(NOTEPAD_DIRECTIVE + originalPrompt)
    expect(output.args.prompt).toStartWith(NOTEPAD_DIRECTIVE)
    expect(output.args.prompt).toEndWith(originalPrompt)
  })

  test("calls isCallerOrchestrator with correct sessionID and client", async () => {
    mockIsCallerOrchestrator.mockResolvedValue(true)
    const hook = createSisyphusJuniorNotepadHook(ctx)
    const input = createInput({ sessionID: "session-abc" })

    await hook["tool.execute.before"](input, createOutput())

    expect(mockIsCallerOrchestrator).toHaveBeenCalledTimes(1)
    expect(mockIsCallerOrchestrator).toHaveBeenCalledWith("session-abc", ctx.client)
  })

  test("does not prepend directive for non-task tool even when orchestrator", async () => {
    mockIsCallerOrchestrator.mockResolvedValue(true)
    const hook = createSisyphusJuniorNotepadHook(ctx)
    const output = createOutput()

    await hook["tool.execute.before"](createInput({ tool: "write" }), output)

    expect(output.args.prompt).toBe("Do some work")
  })

  test("handles multiple sequential calls correctly", async () => {
    mockIsCallerOrchestrator.mockResolvedValue(true)
    const hook = createSisyphusJuniorNotepadHook(ctx)

    const output1 = createOutput({ prompt: "First task" })
    await hook["tool.execute.before"](createInput(), output1)
    expect(output1.args.prompt).toBe(NOTEPAD_DIRECTIVE + "First task")

    const output2 = createOutput({ prompt: "Second task" })
    await hook["tool.execute.before"](createInput(), output2)
    expect(output2.args.prompt).toBe(NOTEPAD_DIRECTIVE + "Second task")
  })
})
