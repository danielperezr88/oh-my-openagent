import type { Hooks } from "@opencode-ai/plugin"
import { log } from "../../../../shared/logger"
import { DEFAULT_CL_CONFIG } from "../types"
import { shouldConsolidate, prepareConsolidationData } from "./trigger"

type EventInput = { event: { type: string; properties?: unknown } }

let lastConsolidationTime = 0
const MIN_CONSOLIDATION_INTERVAL_MS = 5 * 60 * 1000

export function createConsolidationHook(): Hooks {
  return {
    event: async (input: EventInput) => {
      const eventType = input.event.type
      if (eventType !== "session.idle" && eventType !== "session.deleted") return

      const now = Date.now()
      if (now - lastConsolidationTime < MIN_CONSOLIDATION_INTERVAL_MS) {
        log("[consolidation] Skipping: rate limited")
        return
      }

      const trigger = eventType === "session.idle" ? "idle" : "session_end"
      const decision = shouldConsolidate(DEFAULT_CL_CONFIG, trigger)

      if (!decision.shouldTrigger) {
        log(`[consolidation] Not triggering: ${decision.reason}`)
        return
      }

      lastConsolidationTime = now

      const data = prepareConsolidationData(
        decision.projectHash,
        DEFAULT_CL_CONFIG.consolidation.maxAnalysisLines,
      )

      if (!data) {
        log("[consolidation] No observation data to consolidate")
        return
      }

      log(
        `[consolidation] Triggering LLM extraction for project ${decision.projectHash} ` +
        `(${decision.observationCount} observations)`,
      )

      try {
        const { writeFileSync, existsSync, mkdirSync } = await import("fs")
        const { join } = await import("path")
        const { homedir } = await import("os")

        const omoDir = process.env.OMO_DIR ?? join(homedir(), ".omo")
        const taskDir = join(omoDir, "observations", decision.projectHash)
        if (!existsSync(taskDir)) mkdirSync(taskDir, { recursive: true })

        const promptPath = join(taskDir, "pending-extraction.md")
        writeFileSync(promptPath, data.prompt, "utf-8")

        log(`[consolidation] Extraction prompt written to ${promptPath}. ` +
          "The main agent or a subagent should process it.")
      } catch (e) {
        log(`[consolidation] Failed to write extraction prompt: ${String(e)}`)
      }
    },
  }
}
