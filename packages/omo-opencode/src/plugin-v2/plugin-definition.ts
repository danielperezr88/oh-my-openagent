import { Plugin } from "@opencode/plugin"
import { existsSync } from "fs"
import { log } from "../shared/logger"
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
import { registerTelemetryBridge } from "./telemetry-bridge"

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
  }
  readonly knowledge?: { readonly enabled?: boolean }
  readonly doc_store?: { readonly enabled?: boolean; readonly cli_path?: string }
  readonly quality?: {
    readonly enabled?: boolean
    readonly fact_force_gate?: { readonly enabled?: boolean }
    readonly edit_warnings?: { readonly enabled?: boolean }
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
      }
    },
  })
}
