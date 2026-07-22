import type { BackgroundManager } from "../../features/background-agent"
import type { McpDeferredRegistry } from "../../hooks/mcp-deferred-loader"

export interface HookDeps {
  backgroundManager?: BackgroundManager
  mcpDeferredRegistry?: McpDeferredRegistry
  mcpDeferredSemanticUrl?: string
  mcpDeferredStubDescription?: string
}

export function hasHookDep<K extends keyof HookDeps>(
  deps: HookDeps,
  key: K,
): deps is HookDeps & { [P in K]-?: NonNullable<HookDeps[P]> } {
  const value = deps[key]
  if (typeof value === "string") return value !== ""
  return value != null
}
