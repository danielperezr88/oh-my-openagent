import type { Hooks } from "@opencode-ai/plugin"
import type { Instinct, InstinctDomain, InstinctSource, InstinctScope } from "../types"
import { log } from "../../../../shared/logger"
import { DEFAULT_CL_CONFIG } from "../types"
import { shouldConsolidate, prepareConsolidationData } from "./trigger"

type EventInput = { event: { type: string; properties?: unknown } }

let lastConsolidationTime = 0
const MIN_CONSOLIDATION_INTERVAL_MS = 5 * 60 * 1000

function confidenceFromCount(count: number): number {
  if (count <= 0) return 0
  if (count <= 2) return 0.3
  if (count <= 5) return 0.5
  if (count <= 10) return 0.7
  return 0.85
}

function makeInstinct(
  id: string,
  trigger: string,
  domain: InstinctDomain,
  count: number,
  projectHash: string,
  content: string,
  scope: InstinctScope = "project",
  source: InstinctSource = "statistical",
): Instinct {
  const now = new Date().toISOString()
  return {
    id,
    trigger,
    confidence: confidenceFromCount(count),
    domain,
    source,
    scope,
    projectHash,
    createdAt: now,
    lastConfirmed: now,
    observationCount: count,
    content: content.trim(),
  }
}

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
        `[consolidation] Triggering extraction for project ${decision.projectHash} ` +
        `(${decision.observationCount} observations)`,
      )

      const { projectHash } = decision

      try {
        const { writeFileSync, existsSync, mkdirSync } = await import("fs")
        const { join } = await import("path")
        const { homedir } = await import("os")

        const omoDir = process.env.OMO_DIR ?? join(homedir(), ".omo")
        const taskDir = join(omoDir, "observations", projectHash)
        if (!existsSync(taskDir)) mkdirSync(taskDir, { recursive: true })

        const promptPath = join(taskDir, "pending-extraction.md")
        writeFileSync(promptPath, data.prompt, "utf-8")

        log(`[consolidation] Extraction prompt written to ${promptPath}`)
      } catch (e) {
        log(`[consolidation] Failed to write extraction prompt: ${String(e)}`)
      }

      try {
        const { runAnalysis } = await import("../pattern-engine/analyzer")
        const { readObservationTail } = await import("../observation/storage")
        const { saveInstinct } = await import("../instinct-store/storage")

        const allObs = readObservationTail(projectHash, 10000)
        if (allObs.length < 10) {
          log(`[consolidation] Too few observations (${allObs.length}) for statistical extraction`)
          return
        }

        const analysis = runAnalysis(projectHash, allObs)
        const instincts = buildStatisticalInstincts(analysis, projectHash)

        let saved = 0
        for (const inst of instincts) {
          try {
            saveInstinct(inst)
            saved++
          } catch (e) {
            log(`[consolidation] Failed to save instinct ${inst.id}: ${String(e)}`)
          }
        }

        log(`[consolidation] Generated ${saved}/${instincts.length} instincts from statistical patterns`)
      } catch (e) {
        log(`[consolidation] Statistical extraction failed: ${String(e)}`)
      }
    },
  }
}

function buildStatisticalInstincts(
  analysis: {
    patterns: { toolFrequency: Record<string, number>; sequenceFrequency: Record<string, number>; coOccurrence: Record<string, Record<string, number>> }
    baseline: { avgToolsPerSession: number; topToolSequence: Array<{ sequence: string; count: number }> }
    topSequences: Array<{ sequence: string; count: number }>
    anomalyCheck: { anomalous: boolean; reasons: string[] }
  },
  projectHash: string,
): Instinct[] {
  const instincts: Instinct[] = []
  const { topSequences, patterns, anomalyCheck } = analysis
  const { toolFrequency, coOccurrence } = patterns

  for (const seq of topSequences.slice(0, 5)) {
    const safeId = seq.sequence.toLowerCase().replace(/[^a-z0-9->]/g, "-").replace(/->+/g, "-to-").slice(0, 80)
    instincts.push(makeInstinct(
      `seq-${safeId}`,
      "when working on tasks in this project",
      "workflow",
      seq.count,
      projectHash,
      `# Common Workflow: ${seq.sequence}\n\n## Action\nThis tool sequence appears frequently. Follow this order when working on similar tasks.\n\n## Evidence\n- Observed ${seq.count} times`,
    ))
  }
  const total = Object.values(toolFrequency).reduce((s, c) => s + c, 0)
  const sorted = Object.entries(toolFrequency).sort((a, b) => b[1] - a[1])

  if (sorted[0] && total > 0 && sorted[0][1] / total > 0.3) {
    const [tool, count] = sorted[0]
    const safeId = `prefer-${tool.toLowerCase().replace(/[^a-z0-9-]/g, "-")}`
    instincts.push(makeInstinct(
      safeId,
      `when choosing tools for ${tool.toLowerCase()}`,
      "workflow",
      count,
      projectHash,
      `# Most Used Tool: ${tool}\n\n## Action\n${tool} is the most-used tool (${count} calls, ${Math.round(count / total * 100)}% of all calls). Prefer it for its intended purpose.\n\n## Evidence\n- Used ${count} times out of ${total} total tool calls`,
    ))
  }

  for (const [fromTool, transitions] of Object.entries(coOccurrence)) {
    const transitionTotal = Object.values(transitions).reduce((s, c) => s + c, 0)
    for (const [toTool, count] of Object.entries(transitions)) {
      if (count >= 3 && count / transitionTotal > 0.5) {
        const safeFrom = fromTool.toLowerCase().replace(/[^a-z0-9-]/g, "-")
        const safeTo = toTool.toLowerCase().replace(/[^a-z0-9-]/g, "-")
        instincts.push(makeInstinct(
          `after-${safeFrom}-then-${safeTo}`,
          `after using ${fromTool}`,
          "workflow",
          count,
          projectHash,
          `# After ${fromTool}, Usually ${toTool}\n\n## Action\nAfter using ${fromTool}, the next step is usually ${toTool} (${Math.round(count / transitionTotal * 100)}% of the time).\n\n## Evidence\n- ${count} out of ${transitionTotal} transitions from ${fromTool} go to ${toTool}`,
        ))
      }
    }
  }

  if (anomalyCheck.anomalous) {
    instincts.push(makeInstinct(
      "anomalous-session-detected",
      "when session behavior looks unusual",
      "debugging",
      topSequences.length,
      projectHash,
      `# Anomalous Session Detected\n\n## Action\nThis session's tool usage deviates from the baseline. Review for potential issues.\n\n## Evidence\n${anomalyCheck.reasons.map((r) => `- ${r}`).join("\n")}`,
      "project",
      "session-observation",
    ))
  }

  return instincts
}
