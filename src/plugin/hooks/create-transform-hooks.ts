import type { OhMyOpenCodeConfig } from "../../config"
import type { BackgroundManager } from "../../features/background-agent"
import type { PluginContext } from "../types"
import type { RalphLoopHook } from "../../hooks/ralph-loop"
import type { McpDeferredRegistry } from "../../hooks/mcp-deferred-loader"

import {
  createClaudeCodeHooksHook,
  createKeywordDetectorHook,
  createTeamMailboxInjector,
  createTeamModeStatusInjector,
  createThinkingBlockValidatorHook,
  createToolPairValidatorHook,
} from "../../hooks"
import { createBackgroundResultInjectionHook } from "../../hooks/background-result-injection"
import { createMcpDeferredLoaderHook } from "../../hooks/mcp-deferred-loader"
import { createIdentityReinjectionHook } from "../../hooks/identity-reinjection"
import { createMicroCompactHook } from "../../hooks/micro-compact"
import { createPlatformErrorFilterHook } from "../../hooks/platform-error-filter/hook"
import { createReasoningContentPreserverHook } from "../../hooks/reasoning-content-preserver/hook"
import {
  contextCollector,
  createContextInjectorMessagesTransformHook,
} from "../../features/context-injector"
import { createContextMonitorHook } from "../../features/ecc-integration/context-monitor"
import { createCostTrackerHook } from "../../features/ecc-integration/cost-tracker"
import { createInstinctInjectorHook } from "../../features/ecc-integration/continuous-learning/injection/instinct-injector"
import { safeCreateHook } from "../../shared/safe-create-hook"

export type TransformHooks = {
  claudeCodeHooks: ReturnType<typeof createClaudeCodeHooksHook> | null
  keywordDetector: ReturnType<typeof createKeywordDetectorHook> | null
  contextInjectorMessagesTransform: ReturnType<typeof createContextInjectorMessagesTransformHook>
  teamModeStatusInjector: ReturnType<typeof createTeamModeStatusInjector> | null
  teamMailboxInjector: ReturnType<typeof createTeamMailboxInjector> | null
  thinkingBlockValidator: ReturnType<typeof createThinkingBlockValidatorHook> | null
  toolPairValidator: ReturnType<typeof createToolPairValidatorHook> | null
  // Custom transform hooks
  backgroundResultInjection: ReturnType<typeof createBackgroundResultInjectionHook> | null
  mcpDeferredLoader: ReturnType<typeof createMcpDeferredLoaderHook> | null
  microCompact: ReturnType<typeof createMicroCompactHook> | null
  identityReinjection: ReturnType<typeof createIdentityReinjectionHook> | null
  reasoningContentPreserver: ReturnType<typeof createReasoningContentPreserverHook> | null
  platformErrorFilter: ReturnType<typeof createPlatformErrorFilterHook> | null
  contextMonitor: ReturnType<typeof createContextMonitorHook> | null
  costTracker: ReturnType<typeof createCostTrackerHook> | null
  continuousLearningInject: ReturnType<typeof createInstinctInjectorHook> | null
}

export function createTransformHooks(args: {
  ctx: PluginContext
  pluginConfig: OhMyOpenCodeConfig
  isHookEnabled: (hookName: string) => boolean
  safeHookEnabled?: boolean
  ralphLoop?: RalphLoopHook | null
  mcpDeferredRegistry?: McpDeferredRegistry
  client?: PluginContext["client"]
  backgroundManager?: BackgroundManager
}): TransformHooks {
  const { ctx, pluginConfig, isHookEnabled, ralphLoop, mcpDeferredRegistry, client, backgroundManager } = args
  const safeHookEnabled = args.safeHookEnabled ?? true

  const claudeCodeHooks = isHookEnabled("claude-code-hooks")
    ? safeCreateHook(
        "claude-code-hooks",
        () =>
          createClaudeCodeHooksHook(
            ctx,
            {
              disabledHooks: (pluginConfig.claude_code?.hooks ?? true) ? undefined : true,
              keywordDetectorDisabled: !isHookEnabled("keyword-detector"),
            },
            contextCollector,
          ),
        { enabled: safeHookEnabled },
      )
    : null

  const keywordDetector = isHookEnabled("keyword-detector")
    ? safeCreateHook(
        "keyword-detector",
        () =>
          createKeywordDetectorHook(
            ctx,
            contextCollector,
            ralphLoop ?? undefined,
            pluginConfig.keyword_detector,
            pluginConfig.default_mode,
          ),
        { enabled: safeHookEnabled },
      )
    : null

  const contextInjectorMessagesTransform =
    createContextInjectorMessagesTransformHook(contextCollector)

  const teamModeConfig = pluginConfig.team_mode

  const teamModeStatusInjector = teamModeConfig?.enabled
    ? safeCreateHook(
        "team-mode-status-injector",
        () => createTeamModeStatusInjector(teamModeConfig, pluginConfig.keyword_detector),
        { enabled: safeHookEnabled },
      )
    : null

  const teamMailboxInjector = teamModeConfig?.enabled
    ? safeCreateHook(
        "team-mailbox-injector",
        () => createTeamMailboxInjector(ctx, teamModeConfig),
        { enabled: safeHookEnabled },
      )
    : null

  const thinkingBlockValidator = isHookEnabled("thinking-block-validator")
    ? safeCreateHook(
        "thinking-block-validator",
        () => createThinkingBlockValidatorHook(),
        { enabled: safeHookEnabled },
      )
    : null

  const toolPairValidator = isHookEnabled("tool-pair-validator")
    ? safeCreateHook(
        "tool-pair-validator",
        () => createToolPairValidatorHook(),
        { enabled: safeHookEnabled },
      )
    : null

  // Custom transform hooks
  const backgroundResultInjection = isHookEnabled("background-result-injection") && backgroundManager
    ? safeCreateHook(
        "background-result-injection",
        () => createBackgroundResultInjectionHook(backgroundManager),
        { enabled: safeHookEnabled },
      )
    : null

  const mcpDeferredLoaderHook = mcpDeferredRegistry
    ? safeCreateHook(
        "mcp-deferred-loader",
        () => createMcpDeferredLoaderHook(mcpDeferredRegistry),
        { enabled: safeHookEnabled },
      )
    : null

  const microCompact = isHookEnabled("micro-compact")
    ? safeCreateHook(
        "micro-compact",
        () => createMicroCompactHook(),
        { enabled: safeHookEnabled },
      )
    : null

  const identityReinjection = isHookEnabled("identity-reinjection")
    ? safeCreateHook(
        "identity-reinjection",
        () => createIdentityReinjectionHook(),
        { enabled: safeHookEnabled },
      )
    : null

  const reasoningContentPreserver = client
    ? safeCreateHook(
        "reasoning-content-preserver",
        () => createReasoningContentPreserverHook(client),
        { enabled: safeHookEnabled },
      )
    : null

  const platformErrorFilter = isHookEnabled("platform-error-filter")
    ? safeCreateHook(
        "platform-error-filter",
        () => createPlatformErrorFilterHook(),
        { enabled: safeHookEnabled },
      )
    : null

  const contextMonitor = isHookEnabled("context-monitor")
    ? safeCreateHook("context-monitor", () => createContextMonitorHook(), { enabled: safeHookEnabled })
    : null

  const costTracker = isHookEnabled("cost-tracker")
    ? safeCreateHook("cost-tracker", () => createCostTrackerHook(), { enabled: safeHookEnabled })
    : null

  const continuousLearningInject = isHookEnabled("continuous-learning-inject")
    ? safeCreateHook("continuous-learning-inject", () => createInstinctInjectorHook(), { enabled: safeHookEnabled })
    : null

  return {
    claudeCodeHooks,
    keywordDetector,
    contextInjectorMessagesTransform,
    teamModeStatusInjector,
    teamMailboxInjector,
    thinkingBlockValidator,
    toolPairValidator,
    backgroundResultInjection,
    mcpDeferredLoader: mcpDeferredLoaderHook,
    microCompact,
    identityReinjection,
    reasoningContentPreserver,
    platformErrorFilter,
    contextMonitor,
    costTracker,
    continuousLearningInject,
  }
}
