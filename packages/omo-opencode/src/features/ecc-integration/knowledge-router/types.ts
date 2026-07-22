export type KnowledgeCategory = "security" | "coding-style" | "testing" | "performance" | "patterns"

export interface KnowledgeFragment {
  readonly id: string
  readonly topic: string
  readonly category: KnowledgeCategory
  readonly language?: string
  readonly framework?: string
  readonly content: string
  readonly triggers: readonly string[]
}

export interface KnowledgeQuery {
  readonly topic: string
  readonly language?: string
  readonly framework?: string
  readonly taskType?: string
}

export interface KnowledgeResult {
  readonly fragments: readonly KnowledgeFragment[]
  readonly totalAvailable: number
  readonly query: KnowledgeQuery
}
