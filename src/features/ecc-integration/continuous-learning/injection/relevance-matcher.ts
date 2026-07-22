import type { Instinct } from "../types"
import { extractKeywords } from "../instinct-store/storage"

export interface RelevanceScore {
  readonly instinct: Instinct
  readonly score: number
  readonly matchedKeywords: string[]
}

export function scoreRelevance(instinct: Instinct, taskKeywords: string[]): RelevanceScore {
  const triggerKeywords = extractKeywords(instinct.trigger)
  const contentKeywords = extractKeywords(instinct.content)

  const allInstinctKeywords = new Set([...triggerKeywords, ...contentKeywords])
  const matchedKeywords = taskKeywords.filter((k) => allInstinctKeywords.has(k))

  const keywordScore = matchedKeywords.length / Math.max(allInstinctKeywords.size, 1)
  const confidenceScore = instinct.confidence
  const combinedScore = keywordScore * 0.6 + confidenceScore * 0.4

  return {
    instinct,
    score: combinedScore,
    matchedKeywords,
  }
}

export function selectTopInstincts(
  instincts: readonly Instinct[],
  taskText: string,
  maxResults: number,
  minConfidence: number,
): RelevanceScore[] {
  const taskKeywords = extractKeywords(taskText)
  if (taskKeywords.length === 0) return []

  const eligible = instincts.filter((i) => i.confidence >= minConfidence)
  const scored = eligible.map((i) => scoreRelevance(i, taskKeywords))

  return scored
    .filter((s) => s.matchedKeywords.length > 0 || s.score >= 0.3)
    .sort((a, b) => b.score - a.score)
    .slice(0, maxResults)
}
