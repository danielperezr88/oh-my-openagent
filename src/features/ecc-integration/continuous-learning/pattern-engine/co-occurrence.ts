import type { Observation } from "../types"

export type CoOccurrenceMatrix = Record<string, Record<string, number>>

export function computeCoOccurrence(observations: readonly Observation[]): CoOccurrenceMatrix {
  const matrix: CoOccurrenceMatrix = {}
  const sessionLastTool = new Map<string, string>()

  for (const obs of observations) {
    if (obs.event !== "tool_start") continue

    const prevTool = sessionLastTool.get(obs.session)
    if (prevTool && prevTool !== obs.tool) {
      if (!matrix[prevTool]) matrix[prevTool] = {}
      matrix[prevTool][obs.tool] = (matrix[prevTool][obs.tool] ?? 0) + 1
    }

    sessionLastTool.set(obs.session, obs.tool)
  }

  return matrix
}

export function getTransitionProbability(matrix: CoOccurrenceMatrix, fromTool: string): Array<{ tool: string; probability: number }> {
  const transitions = matrix[fromTool]
  if (!transitions) return []

  const total = Object.values(transitions).reduce((sum, count) => sum + count, 0)
  if (total === 0) return []

  return Object.entries(transitions)
    .map(([tool, count]) => ({ tool, probability: count / total }))
    .sort((a, b) => b.probability - a.probability)
}

export function detectAnomalousTransitions(
  matrix: CoOccurrenceMatrix,
  baseline: CoOccurrenceMatrix,
  threshold: number,
): Array<{ from: string; to: string; observed: number; expected: number }> {
  const anomalies: Array<{ from: string; to: string; observed: number; expected: number }> = []

  for (const [fromTool, transitions] of Object.entries(matrix)) {
    const baselineTransitions = baseline[fromTool] ?? {}
    const baselineTotal = Object.values(baselineTransitions).reduce((s, c) => s + c, 0) || 1

    for (const [toTool, count] of Object.entries(transitions)) {
      const expectedProb = (baselineTransitions[toTool] ?? 0) / baselineTotal
      const observedProb = count / Object.values(transitions).reduce((s, c) => s + c, 0)
      if (observedProb - expectedProb > threshold) {
        anomalies.push({ from: fromTool, to: toTool, observed: count, expected: baselineTransitions[toTool] ?? 0 })
      }
    }
  }

  return anomalies
}
