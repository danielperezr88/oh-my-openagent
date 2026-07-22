import { describe, it, expect } from "bun:test"
import { hasHookDep } from "./hook-deps"
import type { HookDeps } from "./hook-deps"

describe("hasHookDep", () => {
  it("returns true when dep is present", () => {
    const deps: HookDeps = { backgroundManager: {} as never }
    expect(hasHookDep(deps, "backgroundManager")).toBe(true)
  })

  it("returns false when dep is undefined", () => {
    const deps: HookDeps = { backgroundManager: undefined }
    expect(hasHookDep(deps, "backgroundManager")).toBe(false)
  })

  it("returns false when dep key is absent from object", () => {
    const deps: HookDeps = {}
    expect(hasHookDep(deps, "mcpDeferredRegistry")).toBe(false)
  })

  it("returns true for string deps with a value", () => {
    const deps: HookDeps = { mcpDeferredSemanticUrl: "http://example.com" }
    expect(hasHookDep(deps, "mcpDeferredSemanticUrl")).toBe(true)
  })

  it("returns false for string deps with empty string", () => {
    const deps: HookDeps = { mcpDeferredSemanticUrl: "" }
    expect(hasHookDep(deps, "mcpDeferredSemanticUrl")).toBe(false)
  })

  it("narrows type correctly when true", () => {
    const deps: HookDeps = { backgroundManager: {} as never }
    if (hasHookDep(deps, "backgroundManager")) {
      // TypeScript should know deps.backgroundManager is non-nullable here
      const _: object = deps.backgroundManager
      expect(_).toBeDefined()
    }
  })
})
