import type { Hooks } from "@opencode-ai/plugin"
import { recordTokenUsage } from "./tracker"

export function createCostTrackerHook(): Hooks {
  return {
    "chat.params": async (input, output) => {
      const sessionID = (input as { sessionID?: string }).sessionID
      if (!sessionID) return

      const model = (input as { model?: { modelID?: string } }).model
      const modelId = model?.modelID ?? "unknown"

      const usage = (output as { usage?: { input_tokens?: number; output_tokens?: number } }).usage
      if (!usage) return

      const inputTokens = usage.input_tokens ?? 0
      const outputTokens = usage.output_tokens ?? 0
      if (inputTokens === 0 && outputTokens === 0) return

      recordTokenUsage(sessionID, modelId, inputTokens, outputTokens)
    },
  }
}
