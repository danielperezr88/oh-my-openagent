import type { HookDeps } from "../plugin/hooks/hook-deps"
import { hasHookDep } from "../plugin/hooks/hook-deps"
import { createBackgroundResultInjectionHook } from "./background-result-injection"
import { createMcpDeferredLoaderHook } from "./mcp-deferred-loader"
import { safeCreateHook } from "../shared/safe-create-hook"

export type CustomHooks = {
  backgroundResultInjection: ReturnType<typeof createBackgroundResultInjectionHook> | null
  mcpDeferredLoader: ReturnType<typeof createMcpDeferredLoaderHook> | null
}

export function createCustomHooks(args: {
  deps: HookDeps
  isHookEnabled: (hookName: string) => boolean
  safeHookEnabled: boolean
}): CustomHooks {
  const { deps, isHookEnabled, safeHookEnabled } = args

  const backgroundResultInjection =
    isHookEnabled("background-result-injection") && hasHookDep(deps, "backgroundManager")
      ? safeCreateHook(
          "background-result-injection",
          () => createBackgroundResultInjectionHook(deps.backgroundManager),
          { enabled: safeHookEnabled },
        )
      : null

  const mcpDeferredLoader =
    isHookEnabled("mcp-deferred-loader") && hasHookDep(deps, "mcpDeferredRegistry")
      ? safeCreateHook(
          "mcp-deferred-loader",
          () =>
            createMcpDeferredLoaderHook(deps.mcpDeferredRegistry, {
              enabled: true,
              semanticUrl: deps.mcpDeferredSemanticUrl,
              stubDescription: deps.mcpDeferredStubDescription,
            }),
          { enabled: safeHookEnabled },
        )
      : null

  return {
    backgroundResultInjection,
    mcpDeferredLoader,
  }
}
