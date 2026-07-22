import { existsSync, writeFileSync, readFileSync, mkdirSync } from "fs"
import { dirname } from "path"
import type { Observation, StatisticalPatterns } from "../types"
import { buildStatisticalPatterns } from "./frequency-counter"
import { computeBaseline, isSessionAnomalous, type BehavioralBaseline } from "./baseline"
import { getPatternsPath, getProjectObservationsDir } from "../observation/storage"

export interface AnalysisResult {
  readonly patterns: StatisticalPatterns
  readonly baseline: BehavioralBaseline
  readonly topSequences: Array<{ sequence: string; count: number }>
  readonly anomalyCheck: { anomalous: boolean; reasons: string[] }
}

export function analyzeObservations(
  projectHash: string,
  observations: readonly Observation[],
): AnalysisResult {
  const patterns = buildStatisticalPatterns(observations)
  const baseline = computeBaseline(patterns)
  const topSequences = Object.entries(patterns.sequenceFrequency)
    .filter(([, count]) => count >= 3)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([sequence, count]) => ({ sequence, count }))
  const anomalyCheck = isSessionAnomalous(patterns, baseline)

  return { patterns, baseline, topSequences, anomalyCheck }
}

export function persistPatterns(projectHash: string, patterns: StatisticalPatterns): void {
  const path = getPatternsPath(projectHash)
  const dir = dirname(path)
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
  }
  writeFileSync(path, JSON.stringify(patterns, null, 2), "utf-8")
}

export function loadPatterns(projectHash: string): StatisticalPatterns | null {
  const path = getPatternsPath(projectHash)
  if (!existsSync(path)) return null
  try {
    return JSON.parse(readFileSync(path, "utf-8")) as StatisticalPatterns
  } catch {
    return null
  }
}

export function runAnalysis(projectHash: string, observations: readonly Observation[]): AnalysisResult {
  const result = analyzeObservations(projectHash, observations)
  persistPatterns(projectHash, result.patterns)
  return result
}
