import type { Observation, StatisticalPatterns } from "../types"
import { computeCoOccurrence } from "./co-occurrence"

const SEQUENCE_WINDOW = 3

export function computeToolFrequency(observations: readonly Observation[]): Record<string, number> {
  const freq: Record<string, number> = {}
  for (const obs of observations) {
    if (obs.event !== "tool_start") continue
    freq[obs.tool] = (freq[obs.tool] ?? 0) + 1
  }
  return freq
}

export function computeSequenceFrequency(observations: readonly Observation[]): Record<string, number> {
  const starts = observations.filter((o) => o.event === "tool_start")
  const freq: Record<string, number> = {}

  for (let i = 0; i <= starts.length - SEQUENCE_WINDOW; i++) {
    const seq = starts.slice(i, i + SEQUENCE_WINDOW).map((o) => o.tool).join("->")
    freq[seq] = (freq[seq] ?? 0) + 1
  }
  return freq
}

export function getTopSequences(freq: Record<string, number>, minCount: number, topN: number): Array<{ sequence: string; count: number }> {
  return Object.entries(freq)
    .filter(([, count]) => count >= minCount)
    .sort((a, b) => b[1] - a[1])
    .slice(0, topN)
    .map(([sequence, count]) => ({ sequence, count }))
}

export function buildStatisticalPatterns(observations: readonly Observation[]): StatisticalPatterns {
  const toolFrequency = computeToolFrequency(observations)
  const sequenceFrequency = computeSequenceFrequency(observations)
  const coOccurrence = computeCoOccurrence(observations)
  const sessions = new Set(observations.map((o) => o.session))

  return {
    toolFrequency,
    sequenceFrequency,
    coOccurrence,
    sessionCount: sessions.size,
    lastUpdated: new Date().toISOString(),
  }
}
