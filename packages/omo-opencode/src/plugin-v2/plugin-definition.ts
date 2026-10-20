import { Plugin } from "@opencode/plugin"
import { log } from "../shared/logger"
import { registerInstinctInjection } from "./instinct-injection"
import { registerInstinctTools } from "./instinct-tools"
import { registerObservationRecorder } from "./observation-recorder"
import { resolveProjectHashForDirectory } from "./project-hash"
import { registerRulesInjection } from "./rules-injection"

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

      await ctx.storage.set("loadedAt", new Date().toISOString())
      log(`[plugin-v2] oh-my-openagent v2 adapter loaded (project ${projectHash}) at ${ctx.location.directory}`)
    },
  })
}
