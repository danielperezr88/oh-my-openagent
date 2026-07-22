import type { StatisticalPatterns } from "../types"
import type { CoOccurrenceMatrix } from "./co-occurrence"

export interface BehavioralBaseline {
  readonly avgToolsPerSession: number
  readonly topToolSequence: Array<{ sequence: string; count: number }>
  readonly coOccurrenceBaseline: CoOccurrenceMatrix
  readonly computedAt: string
}

export function computeBaseline(patterns: StatisticalPatterns): BehavioralBaseline {
  const avgTools = patterns.sessionCount > 0
    ? Object.values(patterns.toolFrequency).reduce((s, c) => s + c, 0) / patterns.sessionCount
    : 0

  const topSequences = Object.entries(patterns.sequenceFrequency)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([sequence, count]) => ({ sequence, count }))

  return {
    avgToolsPerSession: Math.round(avgTools * 10) / 10,
    topToolSequence: topSequences,
    coOccurrenceBaseline: patterns.coOccurrence,
    computedAt: new Date().toISOString(),
  }
}

export function isSessionAnomalous(
  sessionPatterns: StatisticalPatterns,
  baseline: BehavioralBaseline,
): { anomalous: boolean; reasons: string[] } {
  const reasons: string[] = []
  const sessionTools = Object.values(sessionPatterns.toolFrequency).reduce((s, c) => s + c, 0)

  if (baseline.avgToolsPerSession > 0 && sessionTools > baseline.avgToolsPerSession * 3) {
    reasons.push(`Tool count ${sessionTools} is 3x baseline ${baseline.avgToolsPerSession}`)
  }

  const sessionTopSeq = Object.entries(sessionPatterns.sequenceFrequency)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([seq]) => seq)

  const baselineSeqs = new Set(baseline.topToolSequence.map((s) => s.sequence))
  for (const seq of sessionTopSeq) {
    if (!baselineSeqs.has(seq)) {
      reasons.push(`Unseen sequence pattern: ${seq}`)
    }
  }

  return { anomalous: reasons.length > 0, reasons }
}
