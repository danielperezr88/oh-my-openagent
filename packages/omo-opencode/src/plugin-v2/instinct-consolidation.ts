import type { Plugin } from "@opencode/plugin"
import { mkdirSync, writeFileSync } from "fs"
import { join } from "path"
import { log } from "../shared/logger"
import {
  countObservations,
  getProjectObservationsDir,
  readObservationTail,
} from "../features/ecc-integration/continuous-learning/observation/storage"
import { saveInstinct } from "../features/ecc-integration/continuous-learning/instinct-store/storage"
import { parseInstinctFile } from "../features/ecc-integration/continuous-learning/instinct-store/instinct-parser"
import { runAnalysis } from "../features/ecc-integration/continuous-learning/pattern-engine/analyzer"
import { buildExtractionPrompt } from "../features/ecc-integration/continuous-learning/consolidation/extraction-prompt"
import type { Observation } from "../features/ecc-integration/continuous-learning/types"
import { buildStatisticalInstincts, shouldRunConsolidation } from "./statistical-instincts"

export interface LlmModelRef {
  readonly providerID: string
  readonly id: string
}

export interface InstinctConsolidationOptions {
  readonly minObservations?: number
  readonly minIntervalMs?: number
  readonly maxAnalysisLines?: number
  readonly llmModel?: LlmModelRef
}

const DEFAULT_MIN_OBSERVATIONS = 20
const DEFAULT_MIN_INTERVAL_MS = 5 * 60 * 1000
const DEFAULT_MAX_ANALYSIS_LINES = 500
const STATISTICAL_TAIL_LINES = 10000
const MIN_STATISTICAL_OBSERVATIONS = 10
const PENDING_EXTRACTION_FILE = "pending-extraction.md"

// Module-scoped because a serve process loads this plugin once per location plus
// once per prompt; sharing the rate limit collapses that fan-in to one run.
let lastConsolidationRunMs = 0
let consolidationRunning = false

/**
 * V2 port of the fork's instinct consolidation loop (spec: WIP consolidation-hook).
 * Watches turn completion on the plugin event stream, rate-limits, then turns
 * accumulated observations into instincts: statistical extraction always, LLM
 * extraction when a model is configured (otherwise the extraction prompt is
 * dropped to pending-extraction.md for external processing, matching V1 parity).
 *
 * Trigger mapping: V1 listened for session.idle/session.deleted. The V2 plugin
 * event bus does not forward session.idle, so the delivered turn-completion
 * family (session.execution.succeeded/failed/interrupted) acts as the idle
 * signal; session.deleted is kept for the session_end path when delivered.
 */
export function registerInstinctConsolidation(
  ctx: Plugin.Context,
  projectHash: string,
  options: InstinctConsolidationOptions = {},
): () => void {
  const minObservations = options.minObservations ?? DEFAULT_MIN_OBSERVATIONS
  const minIntervalMs = options.minIntervalMs ?? DEFAULT_MIN_INTERVAL_MS
  const maxAnalysisLines = options.maxAnalysisLines ?? DEFAULT_MAX_ANALYSIS_LINES

  async function consolidate(trigger: "idle" | "session_end"): Promise<void> {
    if (consolidationRunning) return
    const now = Date.now()
    if (now - lastConsolidationRunMs < minIntervalMs) {
      log("[consolidation] Skipping: rate limited")
      return
    }
    const observationCount = countObservations(projectHash)
    const decision = shouldRunConsolidation({ trigger, observationCount, minObservations })
    if (!decision.shouldTrigger) {
      log(`[consolidation] Not triggering: ${decision.reason}`)
      return
    }
    lastConsolidationRunMs = now
    consolidationRunning = true
    try {
      const observations = readObservationTail(projectHash, STATISTICAL_TAIL_LINES)
      if (observations.length === 0) return
      log(`[consolidation] Triggering (${trigger}, ${observationCount} observations)`)

      if (options.llmModel) {
        const saved = await extractInstinctsWithLlm(ctx, options.llmModel, observations.slice(-maxAnalysisLines), projectHash)
        log(`[consolidation] LLM extraction saved ${saved} instincts`)
      } else {
        writePendingExtractionPrompt(projectHash, observations.slice(-maxAnalysisLines))
      }

      if (observations.length < MIN_STATISTICAL_OBSERVATIONS) {
        log(`[consolidation] Statistical extraction skipped: ${observations.length} < ${MIN_STATISTICAL_OBSERVATIONS} observations`)
        return
      }
      const analysis = runAnalysis(projectHash, observations)
      const instincts = buildStatisticalInstincts(analysis, projectHash)
      let savedCount = 0
      for (const instinct of instincts) {
        try {
          saveInstinct(instinct, projectHash)
          savedCount++
        } catch (error) {
          log(`[consolidation] Failed to save instinct ${instinct.id}: ${String(error)}`)
        }
      }
      log(`[consolidation] Generated ${savedCount}/${instincts.length} instincts from statistical patterns`)
    } catch (error) {
      log(`[consolidation] Failed: ${String(error)}`)
    } finally {
      consolidationRunning = false
    }
  }

  const controller = new AbortController()
  void (async () => {
    try {
      for await (const event of ctx.event.subscribe({ signal: controller.signal })) {
        const candidate = event as { readonly type: string }
        if (
          candidate.type === "session.execution.succeeded" ||
          candidate.type === "session.execution.failed" ||
          candidate.type === "session.execution.interrupted"
        ) {
          void consolidate("idle")
        } else if (candidate.type === "session.deleted") {
          void consolidate("session_end")
        }
      }
    } catch {
      // stream aborted on plugin teardown
    }
  })()

  return () => controller.abort()
}

function writePendingExtractionPrompt(projectHash: string, observations: readonly Observation[]): void {
  const dir = getProjectObservationsDir(projectHash)
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, PENDING_EXTRACTION_FILE), buildExtractionPrompt(observations), "utf-8")
}

async function extractInstinctsWithLlm(
  ctx: Plugin.Context,
  model: LlmModelRef,
  observations: readonly Observation[],
  projectHash: string,
): Promise<number> {
  const generated = await ctx.generate.text({ model, prompt: buildExtractionPrompt(observations) })
  let saved = 0
  for (const block of extractInstinctBlocks(generated.text)) {
    const instinct = parseInstinctFile(block)
    if (!instinct) continue
    saveInstinct({ ...instinct, projectHash: instinct.projectHash ?? projectHash }, projectHash)
    saved++
  }
  return saved
}

/** Pulls instinct candidates out of LLM output: ```yaml fenced blocks first, bare frontmatter sections second. */
export function extractInstinctBlocks(text: string): string[] {
  const fenced = [...text.matchAll(/```(?:yaml|yml)?\s*\n([\s\S]*?)```/g)]
    .map((match) => match[1]!.trim())
    .filter(Boolean)
  const candidates = fenced.length > 0 ? fenced : splitBareFrontmatter(text)
  return candidates.map(normalizeBlock)
}

function splitBareFrontmatter(text: string): string[] {
  const parts = text.split(/^---\s*$/m)
  const blocks: string[] = []
  for (let i = 1; i + 1 < parts.length; i += 2) {
    blocks.push(`---\n${parts[i]!.trim()}\n---\n${parts[i + 1]!.trim()}`)
  }
  return blocks
}

function normalizeBlock(block: string): string {
  return block.startsWith("---") ? `${block}\n` : `---\n${block}\n---\n`
}
