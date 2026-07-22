import type { Observation, ContinuousLearningConfig } from "../types"
import { countObservations, readObservationTail } from "../observation/storage"
import { resolveProjectHash } from "../instinct-store/project-resolver"
import { buildExtractionPrompt } from "./extraction-prompt"

const DEFAULT_MIN_OBSERVATIONS = 20

export interface ConsolidationDecision {
  readonly shouldTrigger: boolean
  readonly reason: string
  readonly projectHash: string
  readonly observationCount: number
}

export function shouldConsolidate(
  config: ContinuousLearningConfig,
  trigger: "idle" | "session_end" | "threshold",
): ConsolidationDecision {
  const projectHash = resolveProjectHash()
  const observationCount = countObservations(projectHash)

  if (trigger === "session_end") {
    return {
      shouldTrigger: observationCount > 0,
      reason: "Session ending",
      projectHash,
      observationCount,
    }
  }

  if (trigger === "idle") {
    if (observationCount < DEFAULT_MIN_OBSERVATIONS) {
      return {
        shouldTrigger: false,
        reason: `Not enough observations (${observationCount} < ${DEFAULT_MIN_OBSERVATIONS})`,
        projectHash,
        observationCount,
      }
    }
    return {
      shouldTrigger: true,
      reason: `Idle with ${observationCount} observations`,
      projectHash,
      observationCount,
    }
  }

  if (trigger === "threshold") {
    const threshold = config.consolidation.minObservations
    if (observationCount < threshold) {
      return {
        shouldTrigger: false,
        reason: `Below threshold (${observationCount} < ${threshold})`,
        projectHash,
        observationCount,
      }
    }
    return {
      shouldTrigger: true,
      reason: `Threshold reached (${observationCount} >= ${threshold})`,
      projectHash,
      observationCount,
    }
  }

  return { shouldTrigger: false, reason: "Unknown trigger", projectHash, observationCount }
}

export function prepareConsolidationData(
  projectHash: string,
  maxLines: number,
): { observations: Observation[]; prompt: string } | null {
  const observations: Observation[] = readObservationTail(projectHash, maxLines)
  if (observations.length === 0) return null

  const prompt: string = buildExtractionPrompt(observations)
  return { observations, prompt }
}
