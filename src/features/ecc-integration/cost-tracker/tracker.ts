import type { AccumulatedCost, SessionCost } from "./types"
import { calculateCost } from "./pricing-table"

const sessionCosts = new Map<string, SessionCost[]>()

export function recordTokenUsage(
  sessionID: string,
  model: string,
  inputTokens: number,
  outputTokens: number,
): SessionCost {
  const cost = calculateCost(model, inputTokens, outputTokens)
  const entry: SessionCost = {
    model,
    inputTokens,
    outputTokens,
    estimatedCost: cost,
    timestamp: Date.now(),
  }

  const existing = sessionCosts.get(sessionID) ?? []
  existing.push(entry)
  sessionCosts.set(sessionID, existing)

  return entry
}

export function getSessionCosts(sessionID: string): SessionCost[] {
  return sessionCosts.get(sessionID) ?? []
}

export function getSessionTotal(sessionID: string): {
  inputTokens: number
  outputTokens: number
  estimatedCost: number
} {
  const entries = getSessionCosts(sessionID)
  return entries.reduce(
    (acc, e) => ({
      inputTokens: acc.inputTokens + e.inputTokens,
      outputTokens: acc.outputTokens + e.outputTokens,
      estimatedCost: Math.round((acc.estimatedCost + e.estimatedCost) * 1_000_000) / 1_000_000,
    }),
    { inputTokens: 0, outputTokens: 0, estimatedCost: 0 },
  )
}

export function clearSession(sessionID: string): void {
  sessionCosts.delete(sessionID)
}

export function getAccumulatedCost(): AccumulatedCost {
  let totalInput = 0
  let totalOutput = 0
  let totalCost = 0
  let sessions = 0
  const byModel: Record<string, { input: number; output: number; cost: number }> = {}

  for (const [, entries] of sessionCosts) {
    if (entries.length > 0) sessions++
    for (const e of entries) {
      totalInput += e.inputTokens
      totalOutput += e.outputTokens
      totalCost += e.estimatedCost
      if (!byModel[e.model]) {
        byModel[e.model] = { input: 0, output: 0, cost: 0 }
      }
      byModel[e.model].input += e.inputTokens
      byModel[e.model].output += e.outputTokens
      byModel[e.model].cost += e.estimatedCost
    }
  }

  return {
    totalInputTokens: totalInput,
    totalOutputTokens: totalOutput,
    totalEstimatedCost: Math.round(totalCost * 1_000_000) / 1_000_000,
    sessions,
    byModel,
  }
}
