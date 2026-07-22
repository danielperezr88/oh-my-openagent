export interface ModelPricing {
  readonly inputPer1M: number
  readonly outputPer1M: number
}

export interface SessionCost {
  readonly model: string
  readonly inputTokens: number
  readonly outputTokens: number
  readonly estimatedCost: number
  readonly timestamp: number
}

export interface AccumulatedCost {
  readonly totalInputTokens: number
  readonly totalOutputTokens: number
  readonly totalEstimatedCost: number
  readonly sessions: number
  readonly byModel: Record<string, { input: number; output: number; cost: number }>
}
