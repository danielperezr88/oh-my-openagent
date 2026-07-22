import type { ScopeDriftConfig } from "./types"

const STOP_WORDS = new Set([
  "the", "a", "an", "is", "are", "was", "were", "be", "been", "being",
  "have", "has", "had", "do", "does", "did", "will", "would", "could",
  "should", "may", "might", "must", "can", "shall", "to", "of", "in",
  "for", "on", "with", "as", "by", "at", "from", "this", "that", "it",
])

function tokenize(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((w) => w.length > 2 && !STOP_WORDS.has(w)),
  )
}

function jaccardSimilarity(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 1
  if (a.size === 0 || b.size === 0) return 0

  let intersection = 0
  for (const word of a) {
    if (b.has(word)) intersection++
  }
  const union = a.size + b.size - intersection
  return intersection / union
}

export function detectScopeDrift(
  originalTask: string,
  recentMessages: readonly string[],
  config: ScopeDriftConfig,
): { drifting: boolean; similarity: number } {
  if (recentMessages.length === 0) return { drifting: false, similarity: 1 }

  const originalTokens = tokenize(originalTask)
  if (originalTokens.size === 0) return { drifting: false, similarity: 1 }

  const recentText = recentMessages.slice(-config.maxMessagesTracked).join(" ")
  const recentTokens = tokenize(recentText)

  const similarity = jaccardSimilarity(originalTokens, recentTokens)
  return {
    drifting: similarity < config.driftThreshold,
    similarity,
  }
}
