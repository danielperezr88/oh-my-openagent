import { KNOWLEDGE_FRAGMENTS } from "./fragments"
import type { KnowledgeFragment, KnowledgeQuery, KnowledgeResult } from "./types"

const MAX_FRAGMENTS = 8

function normalize(text: string): string {
  return text.toLowerCase().trim()
}

function matchesTriggers(query: string, triggers: readonly string[]): boolean {
  const q = normalize(query)
  return triggers.some((t) => q.includes(normalize(t)))
}

function matchesExactTopic(query: string, fragment: KnowledgeFragment): boolean {
  return normalize(query) === normalize(fragment.topic)
}

function matchesLanguage(
  query: KnowledgeQuery,
  fragment: KnowledgeFragment,
): boolean {
  if (!fragment.language) return true
  if (!query.language) return true
  return normalize(query.language) === normalize(fragment.language)
}

function matchesFramework(
  query: KnowledgeQuery,
  fragment: KnowledgeFragment,
): boolean {
  if (!fragment.framework) return true
  if (!query.framework) return true
  return normalize(query.framework) === normalize(fragment.framework)
}

function scoreFragment(query: KnowledgeQuery, fragment: KnowledgeFragment): number {
  let score = 0
  if (matchesExactTopic(query.topic, fragment)) score += 100
  if (matchesTriggers(query.topic, fragment.triggers)) score += 50
  if (query.taskType && matchesTriggers(query.taskType, fragment.triggers)) score += 25
  if (query.language && fragment.language && matchesLanguage(query, fragment)) score += 10
  if (query.framework && fragment.framework && matchesFramework(query, fragment)) score += 10
  return score
}

export function matchFragments(query: KnowledgeQuery): KnowledgeResult {
  const scored = KNOWLEDGE_FRAGMENTS
    .map((fragment) => ({ fragment, score: scoreFragment(query, fragment) }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, MAX_FRAGMENTS)

  return {
    fragments: scored.map((entry) => entry.fragment),
    totalAvailable: scored.length,
    query,
  }
}

export function listTopics(): string[] {
  const topics = new Set<string>()
  for (const fragment of KNOWLEDGE_FRAGMENTS) {
    topics.add(fragment.topic)
  }
  return [...topics].sort()
}
