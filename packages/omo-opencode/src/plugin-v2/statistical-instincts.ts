import type {
  Instinct,
  InstinctDomain,
  InstinctScope,
  InstinctSource,
} from "../features/ecc-integration/continuous-learning/types"

/** Confidence banding from observation counts. Spec: fork WIP consolidation-hook. */
export function confidenceFromCount(count: number): number {
  if (count <= 0) return 0
  if (count <= 2) return 0.3
  if (count <= 5) return 0.5
  if (count <= 10) return 0.7
  return 0.85
}

export function makeInstinct(
  id: string,
  trigger: string,
  domain: InstinctDomain,
  count: number,
  projectHash: string,
  content: string,
  scope: InstinctScope = "project",
  source: InstinctSource = "statistical",
): Instinct {
  const now = new Date().toISOString()
  return {
    id,
    trigger,
    confidence: confidenceFromCount(count),
    domain,
    source,
    scope,
    projectHash,
    createdAt: now,
    lastConfirmed: now,
    observationCount: count,
    content: content.trim(),
  }
}

export interface StatisticalAnalysis {
  readonly patterns: {
    readonly toolFrequency: Record<string, number>
    readonly sequenceFrequency: Record<string, number>
    readonly coOccurrence: Record<string, Record<string, number>>
  }
  readonly topSequences: ReadonlyArray<{ readonly sequence: string; readonly count: number }>
  readonly anomalyCheck: { readonly anomalous: boolean; readonly reasons: readonly string[] }
}

/**
 * Turns pattern-engine analysis into instincts. Rules from the fork WIP:
 * - top 5 frequent tool sequences -> workflow instincts
 * - most-used tool with >30% share -> prefer instinct
 * - transitions with >=3 occurrences and >50% of a tool's outgoing flow -> after-X instincts
 * - anomalous session flag -> debugging instinct
 */
export function buildStatisticalInstincts(analysis: StatisticalAnalysis, projectHash: string): Instinct[] {
  const instincts: Instinct[] = []
  const { topSequences, patterns, anomalyCheck } = analysis
  const { toolFrequency, coOccurrence } = patterns

  for (const seq of topSequences.slice(0, 5)) {
    const safeId = seq.sequence.toLowerCase().replace(/[^a-z0-9->]/g, "-").replace(/->+/g, "-to-").slice(0, 80)
    instincts.push(
      makeInstinct(
        `seq-${safeId}`,
        "when working on tasks in this project",
        "workflow",
        seq.count,
        projectHash,
        `# Common Workflow: ${seq.sequence}\n\n## Action\nThis tool sequence appears frequently. Follow this order when working on similar tasks.\n\n## Evidence\n- Observed ${seq.count} times`,
      ),
    )
  }

  const total = Object.values(toolFrequency).reduce((sum, count) => sum + count, 0)
  const sorted = Object.entries(toolFrequency).sort((a, b) => b[1] - a[1])

  if (sorted[0] && total > 0 && sorted[0][1] / total > 0.3) {
    const [tool, count] = sorted[0]
    const safeId = `prefer-${tool.toLowerCase().replace(/[^a-z0-9-]/g, "-")}`
    instincts.push(
      makeInstinct(
        safeId,
        `when choosing tools for ${tool.toLowerCase()}`,
        "workflow",
        count,
        projectHash,
        `# Most Used Tool: ${tool}\n\n## Action\n${tool} is the most-used tool (${count} calls, ${Math.round((count / total) * 100)}% of all calls). Prefer it for its intended purpose.\n\n## Evidence\n- Used ${count} times out of ${total} total tool calls`,
      ),
    )
  }

  for (const [fromTool, transitions] of Object.entries(coOccurrence)) {
    const transitionTotal = Object.values(transitions).reduce((sum, count) => sum + count, 0)
    for (const [toTool, count] of Object.entries(transitions)) {
      if (count >= 3 && count / transitionTotal > 0.5) {
        const safeFrom = fromTool.toLowerCase().replace(/[^a-z0-9-]/g, "-")
        const safeTo = toTool.toLowerCase().replace(/[^a-z0-9-]/g, "-")
        instincts.push(
          makeInstinct(
            `after-${safeFrom}-then-${safeTo}`,
            `after using ${fromTool}`,
            "workflow",
            count,
            projectHash,
            `# After ${fromTool}, Usually ${toTool}\n\n## Action\nAfter using ${fromTool}, the next step is usually ${toTool} (${Math.round((count / transitionTotal) * 100)}% of the time).\n\n## Evidence\n- ${count} out of ${transitionTotal} transitions from ${fromTool} go to ${toTool}`,
          ),
        )
      }
    }
  }

  if (anomalyCheck.anomalous) {
    instincts.push(
      makeInstinct(
        "anomalous-session-detected",
        "when session behavior looks unusual",
        "debugging",
        topSequences.length,
        projectHash,
        `# Anomalous Session Detected\n\n## Action\nThis session's tool usage deviates from the baseline. Review for potential issues.\n\n## Evidence\n${anomalyCheck.reasons.map((reason) => `- ${reason}`).join("\n")}`,
        "project",
        "session-observation",
      ),
    )
  }

  return instincts
}

export interface ConsolidationDecisionInput {
  readonly trigger: "idle" | "session_end"
  readonly observationCount: number
  readonly minObservations: number
}

/** Threshold gate only; rate limiting is stateful and lives in the runtime module. */
export function shouldRunConsolidation(input: ConsolidationDecisionInput): { readonly shouldTrigger: boolean; readonly reason: string } {
  if (input.trigger === "session_end") {
    return input.observationCount > 0
      ? { shouldTrigger: true, reason: "Session ending" }
      : { shouldTrigger: false, reason: "No observations" }
  }
  return input.observationCount >= input.minObservations
    ? { shouldTrigger: true, reason: `Idle with ${input.observationCount} observations` }
    : { shouldTrigger: false, reason: `Not enough observations (${input.observationCount} < ${input.minObservations})` }
}
