/**
 * Shared types for the Continuous Learning system.
 * Used across observation capture, statistical analysis, instinct store, consolidation, and injection.
 */

/** A single tool event captured during a session */
export interface Observation {
  readonly timestamp: string
  readonly event: "tool_start" | "tool_complete"
  readonly tool: string
  readonly session: string
  readonly projectHash: string
  readonly input?: string
  readonly output?: string
}

/** Statistical patterns derived from observation data */
export interface StatisticalPatterns {
  readonly toolFrequency: Record<string, number>
  readonly sequenceFrequency: Record<string, number>
  readonly coOccurrence: Record<string, Record<string, number>>
  readonly sessionCount: number
  readonly lastUpdated: string
}

/** An extracted instinct stored as YAML frontmatter + markdown body */
export interface Instinct {
  readonly id: string
  readonly trigger: string
  readonly confidence: number
  readonly domain: InstinctDomain
  readonly source: InstinctSource
  readonly scope: InstinctScope
  readonly projectHash?: string
  readonly createdAt: string
  readonly lastConfirmed: string
  readonly observationCount: number
  readonly content: string
}

export type InstinctDomain =
  | "code-style"
  | "testing"
  | "git"
  | "workflow"
  | "security"
  | "debugging"
  | "architecture"

export type InstinctSource =
  | "session-observation"
  | "inherited"
  | "statistical"
  | "manual"

export type InstinctScope = "project" | "global"

/** In-memory index for fast instinct lookup */
export interface InstinctIndex {
  readonly instincts: readonly Instinct[]
  readonly byDomain: Record<string, readonly Instinct[]>
  readonly byTriggerKeyword: Map<string, readonly Instinct[]>
  readonly totalProject: number
  readonly totalGlobal: number
}

/** Configuration for the continuous learning feature */
export interface ContinuousLearningConfig {
  readonly enabled: boolean
  readonly observation: {
    readonly maxFileSizeMb: number
    readonly retentionDays: number
    readonly truncateChars: number
  }
  readonly consolidation: {
    readonly minObservations: number
    readonly maxAnalysisLines: number
    readonly idleTriggerSeconds: number
  }
  readonly injection: {
    readonly maxInstinctsPerMessage: number
    readonly minConfidence: number
  }
}

export const DEFAULT_CL_CONFIG: ContinuousLearningConfig = {
  enabled: false,
  observation: {
    maxFileSizeMb: 10,
    retentionDays: 30,
    truncateChars: 2000,
  },
  consolidation: {
    minObservations: 20,
    maxAnalysisLines: 500,
    idleTriggerSeconds: 300,
  },
  injection: {
    maxInstinctsPerMessage: 5,
    minConfidence: 0.5,
  },
}
