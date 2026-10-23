import { Plugin } from "@opencode/plugin"
import { existsSync } from "fs"
import { log } from "../shared/logger"
import { registerInstinctConsolidation } from "./instinct-consolidation"
import { registerInstinctInjection } from "./instinct-injection"
import { registerInstinctTools } from "./instinct-tools"
import { registerObservationRecorder } from "./observation-recorder"
import { resolveProjectHashForDirectory } from "./project-hash"
import { registerRulesInjection } from "./rules-injection"
import { registerKnowledgeTool } from "./knowledge-tool"
import { registerDocStoreTools } from "./doc-store-tools"
import { DEFAULT_DOC_STORE_CLI } from "./doc-store-cli"
import { registerFactForceGate } from "./fact-force-gate"
import { registerEditWarnings } from "./edit-warnings"
import { registerDiscoverToolsTool } from "./discover-tools"
import { registerTelemetryBridge } from "./telemetry-bridge"
import { registerSessionRecovery } from "./session-recovery"
import { registerRepetitionGuard } from "./repetition-guard"

export interface V2PluginOptions {
  readonly rules?: { readonly enabled?: boolean }
  readonly continuous_learning?: {
    readonly enabled?: boolean
    readonly observation?: { readonly enabled?: boolean }
    readonly injection?: {
      readonly enabled?: boolean
      readonly maxInstinctsPerMessage?: number
      readonly minConfidence?: number
    }
    readonly consolidation?: {
      readonly enabled?: boolean
      readonly minObservations?: number
      readonly minIntervalMs?: number
      readonly maxAnalysisLines?: number
      readonly llm_model?: { readonly providerID: string; readonly id: string }
    }
  }
  readonly knowledge?: { readonly enabled?: boolean }
  readonly doc_store?: { readonly enabled?: boolean; readonly cli_path?: string }
  readonly discover_tools?: { readonly enabled?: boolean; readonly topK?: number; readonly threshold?: number }
  readonly session_recovery?: {
    readonly enabled?: boolean
    readonly auto_resume?: boolean
  }
  readonly quality?: {
    readonly enabled?: boolean
    readonly fact_force_gate?: { readonly enabled?: boolean }
    readonly edit_warnings?: { readonly enabled?: boolean }
    readonly repetition_guard?: {
      readonly enabled?: boolean
      readonly min_calls?: number
      readonly max_distinct_inputs?: number
      readonly rapid_interval_ms?: number
    }
  }
  readonly telemetry?: { readonly enabled?: boolean; readonly endpoint?: string; readonly project?: string }
}

const DEFAULT_MAX_INSTINCTS = 5
const DEFAULT_MIN_CONFIDENCE = 0.5

export function createV2PluginDefinition(): Plugin.Plugin {
  return Plugin.define({
    id: "oh-my-openagent",
    async setup(ctx) {
      if (process.env.OMO_V2_DISABLE === "1") return

      const options = (ctx.options ?? {}) as V2PluginOptions
      const projectHash = resolveProjectHashForDirectory(ctx.location.directory)
      const learning = options.continuous_learning ?? {}
      const learningEnabled = learning.enabled ?? true
      const injection = learning.injection ?? {}

      if (options.rules?.enabled !== false) {
        registerRulesInjection(ctx)
      }
      if (learningEnabled && learning.observation?.enabled !== false) {
        registerObservationRecorder(ctx, projectHash)
      }
      if (learningEnabled && learning.injection?.enabled !== false) {
        registerInstinctInjection(ctx, {
          projectHash,
          maxInstincts: injection.maxInstinctsPerMessage ?? DEFAULT_MAX_INSTINCTS,
          minConfidence: injection.minConfidence ?? DEFAULT_MIN_CONFIDENCE,
        })
      }
      if (learningEnabled) {
        registerInstinctTools(ctx, projectHash)
      }
      let consolidationCleanup: (() => void) | null = null
      if (learningEnabled && learning.consolidation?.enabled !== false) {
        consolidationCleanup = registerInstinctConsolidation(ctx, projectHash, {
          minObservations: learning.consolidation?.minObservations,
          minIntervalMs: learning.consolidation?.minIntervalMs,
          maxAnalysisLines: learning.consolidation?.maxAnalysisLines,
          llmModel: learning.consolidation?.llm_model,
        })
      }

      if (options.knowledge?.enabled !== false) {
        registerKnowledgeTool(ctx)
      }

      const docStoreCli = options.doc_store?.cli_path ?? DEFAULT_DOC_STORE_CLI
      if (options.doc_store?.enabled === true || (options.doc_store?.enabled !== false && existsSync(docStoreCli))) {
        registerDocStoreTools(ctx)
      }

      const quality = options.quality ?? {}
      if (quality.enabled !== false && quality.fact_force_gate?.enabled !== false) {
        registerFactForceGate(ctx)
      }
      if (quality.enabled !== false && quality.edit_warnings?.enabled !== false) {
        registerEditWarnings(ctx)
      }
      const repetitionGuard = quality.repetition_guard ?? {}
      if (quality.enabled !== false && repetitionGuard.enabled !== false) {
        registerRepetitionGuard(ctx, {
          minCalls: repetitionGuard.min_calls,
          maxDistinctInputs: repetitionGuard.max_distinct_inputs,
          rapidIntervalMs: repetitionGuard.rapid_interval_ms,
        })
      }

      if (options.discover_tools?.enabled !== false) {
        registerDiscoverToolsTool(ctx, {
          topK: options.discover_tools?.topK,
          threshold: options.discover_tools?.threshold,
        })
      }

      let sessionRecoveryCleanup: (() => void) | null = null
      if (options.session_recovery?.enabled !== false) {
        sessionRecoveryCleanup = registerSessionRecovery(ctx, {
          autoResume: options.session_recovery?.auto_resume !== false,
        })
      }

      const telemetryWanted =
        options.telemetry?.enabled === true ||
        options.telemetry?.endpoint !== undefined ||
        process.env.PHOENIX_ENDPOINT !== undefined
      let telemetryCleanup: (() => void) | null = null
      if (telemetryWanted) {
        telemetryCleanup = registerTelemetryBridge(ctx, {
          endpoint: options.telemetry?.endpoint,
          project: options.telemetry?.project,
        })
      }

      await ctx.storage.set("loadedAt", new Date().toISOString())
      log(`[plugin-v2] oh-my-openagent v2 adapter loaded (project ${projectHash}) at ${ctx.location.directory}`)

      return () => {
        telemetryCleanup?.()
        consolidationCleanup?.()
        sessionRecoveryCleanup?.()
      }
    },
  })
}
