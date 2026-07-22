import type { HookName, OhMyOpenCodeConfig } from "../../config"
import type { BackgroundManager } from "../../features/background-agent"
import type { MonitorManager } from "../../features/monitor"
import type { ModelFallbackControllerAccessor } from "../../hooks/model-fallback"
import type { McpDeferredRegistry } from "../../hooks/mcp-deferred-loader"
import type { PluginContext } from "../types"
import type { ModelCacheState } from "../../plugin-state"

import { createSessionHooks } from "./create-session-hooks"
import { createToolGuardHooks } from "./create-tool-guard-hooks"
import { createTransformHooks } from "./create-transform-hooks"

export function createCoreHooks(args: {
  ctx: PluginContext
  pluginConfig: OhMyOpenCodeConfig
  modelCacheState: ModelCacheState
  backgroundManager: BackgroundManager
  modelFallbackControllerAccessor?: ModelFallbackControllerAccessor
  monitorManager?: MonitorManager
  isHookEnabled: (hookName: HookName) => boolean
  safeHookEnabled: boolean
  mcpDeferredRegistry?: McpDeferredRegistry
  client?: PluginContext["client"]
}) {
  const { ctx, pluginConfig, modelCacheState, backgroundManager, modelFallbackControllerAccessor, monitorManager, isHookEnabled, safeHookEnabled, mcpDeferredRegistry, client } = args

  const session = createSessionHooks({
    ctx,
    pluginConfig,
    modelCacheState,
    backgroundManager,
    modelFallbackControllerAccessor,
    isHookEnabled,
    safeHookEnabled,
  })

  const tool = createToolGuardHooks({
    ctx,
    pluginConfig,
    modelCacheState,
    isHookEnabled,
    safeHookEnabled,
  })

  const transform = createTransformHooks({
    ctx,
    pluginConfig,
    isHookEnabled: (name) => isHookEnabled(name as HookName),
    safeHookEnabled,
    mcpDeferredRegistry,
    client,
    backgroundManager,
    monitorManager,
  })

  return {
    ...session,
    ...tool,
    ...transform,
  }
}
