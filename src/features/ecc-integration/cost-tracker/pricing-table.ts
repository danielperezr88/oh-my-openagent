import type { ModelPricing } from "./types"

const PRICING_TABLE: Record<string, ModelPricing> = {
  "claude-sonnet-4-6": { inputPer1M: 3, outputPer1M: 15 },
  "claude-opus-4-6": { inputPer1M: 15, outputPer1M: 75 },
  "claude-3-5-sonnet": { inputPer1M: 3, outputPer1M: 15 },
  "gpt-5.4": { inputPer1M: 2.5, outputPer1M: 15 },
  "gpt-5.4-mini": { inputPer1M: 0.15, outputPer1M: 0.6 },
  "gpt-4o": { inputPer1M: 2.5, outputPer1M: 10 },
  "gpt-4o-mini": { inputPer1M: 0.15, outputPer1M: 0.6 },
  "gemini-3.1-pro": { inputPer1M: 1.25, outputPer1M: 5 },
  "gemini-3-flash": { inputPer1M: 0.075, outputPer1M: 0.3 },
  "kimi-k2.5": { inputPer1M: 0.6, outputPer1M: 2.5 },
  "glm-5": { inputPer1M: 0.5, outputPer1M: 2 },
  "deepseek-v4-pro": { inputPer1M: 1.1, outputPer1M: 3.3 },
  "deepseek-v4-flash": { inputPer1M: 0.14, outputPer1M: 0.28 },
  "minimax-m2.7": { inputPer1M: 0.3, outputPer1M: 1.2 },
}

const DEFAULT_PRICING: ModelPricing = { inputPer1M: 1, outputPer1M: 5 }

export function getPricing(modelId: string): ModelPricing {
  const normalized = modelId.toLowerCase()
  for (const [key, pricing] of Object.entries(PRICING_TABLE)) {
    if (normalized.includes(key)) return pricing
  }
  return DEFAULT_PRICING
}

export function calculateCost(
  modelId: string,
  inputTokens: number,
  outputTokens: number,
): number {
  const pricing = getPricing(modelId)
  const inputCost = (inputTokens / 1_000_000) * pricing.inputPer1M
  const outputCost = (outputTokens / 1_000_000) * pricing.outputPer1M
  return Math.round((inputCost + outputCost) * 1_000_000) / 1_000_000
}

export function listKnownModels(): string[] {
  return Object.keys(PRICING_TABLE).sort()
}
