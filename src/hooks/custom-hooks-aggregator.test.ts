import { describe, it, expect, mock } from "bun:test"
import { createCustomHooks } from "./custom-hooks-aggregator"
import type { HookDeps } from "../plugin/hooks/hook-deps"

// Mock the hook factories to avoid needing real dependencies
// We mock the modules that createCustomHooks imports
const mockBackgroundHook = { "experimental.chat.messages.transform": mock(() => {}) }
const mockMcpHook = {
  "tool.definition": mock(() => {}),
  "experimental.chat.messages.transform": mock(() => {}),
}

// Since bun:test mock.module is async, we use a simpler approach:
// test the wiring logic by verifying null returns and non-null returns

describe("createCustomHooks", () => {
  const alwaysEnabled = () => true
  const safeHookEnabled = true

  it("returns null for backgroundResultInjection when backgroundManager is absent", () => {
    const deps: HookDeps = {}
    const result = createCustomHooks({ deps, isHookEnabled: alwaysEnabled, safeHookEnabled })
    expect(result.backgroundResultInjection).toBeNull()
  })

  it("returns null for mcpDeferredLoader when mcpDeferredRegistry is absent", () => {
    const deps: HookDeps = {}
    const result = createCustomHooks({ deps, isHookEnabled: alwaysEnabled, safeHookEnabled })
    expect(result.mcpDeferredLoader).toBeNull()
  })

  it("returns null for a hook when isHookEnabled returns false", () => {
    const deps: HookDeps = {
      backgroundManager: {} as never,
      mcpDeferredRegistry: {} as never,
    }
    const neverEnabled = () => false
    const result = createCustomHooks({ deps, isHookEnabled: neverEnabled, safeHookEnabled })
    expect(result.backgroundResultInjection).toBeNull()
    expect(result.mcpDeferredLoader).toBeNull()
  })

  it("returns non-null hooks when deps are provided and enabled", () => {
    // Create a minimal McpDeferredRegistry-like object
    const fakeRegistry = {
      isMcpTool: () => false,
      setAllMcpToolIDs: () => {},
      setToolDescriptions: () => {},
      getDiscoveredToolIDs: () => new Set<string>(),
      getUndiscoveredToolIDs: () => [] as string[],
      discover: () => {},
      isDiscovered: () => true,
      markDiscovered: () => {},
    } as never

    const deps: HookDeps = {
      backgroundManager: {
        getPendingNotifications: () => [],
        clearNotifications: () => {},
      } as never,
      mcpDeferredRegistry: fakeRegistry,
      mcpDeferredSemanticUrl: "http://example.com",
      mcpDeferredStubDescription: "stub",
    }

    const result = createCustomHooks({ deps, isHookEnabled: alwaysEnabled, safeHookEnabled })
    expect(result.backgroundResultInjection).not.toBeNull()
    expect(result.mcpDeferredLoader).not.toBeNull()
  })

  it("returns backgroundResultInjection when only backgroundManager is provided", () => {
    const deps: HookDeps = {
      backgroundManager: {
        getPendingNotifications: () => [],
        clearNotifications: () => {},
      } as never,
    }

    const result = createCustomHooks({ deps, isHookEnabled: alwaysEnabled, safeHookEnabled })
    expect(result.backgroundResultInjection).not.toBeNull()
    expect(result.mcpDeferredLoader).toBeNull()
  })

  it("returns mcpDeferredLoader when only mcpDeferredRegistry is provided", () => {
    const fakeRegistry = {
      isMcpTool: () => false,
      setAllMcpToolIDs: () => {},
      setToolDescriptions: () => {},
      getDiscoveredToolIDs: () => new Set<string>(),
      getUndiscoveredToolIDs: () => [] as string[],
      discover: () => {},
      isDiscovered: () => true,
      markDiscovered: () => {},
    } as never

    const deps: HookDeps = {
      mcpDeferredRegistry: fakeRegistry,
    }

    const result = createCustomHooks({ deps, isHookEnabled: alwaysEnabled, safeHookEnabled })
    expect(result.backgroundResultInjection).toBeNull()
    expect(result.mcpDeferredLoader).not.toBeNull()
  })
})
