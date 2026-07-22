import type { Observation } from "../types"

export function buildExtractionPrompt(observations: readonly Observation[]): string {
  const obsSummary = observations
    .slice(-200)
    .map((o) => `[${o.timestamp}] ${o.event} tool=${o.tool} session=${o.session}`)
    .join("\n")

  const toolCounts: Record<string, number> = {}
  for (const o of observations) {
    if (o.event === "tool_start") toolCounts[o.tool] = (toolCounts[o.tool] ?? 0) + 1
  }
  const toolStats = Object.entries(toolCounts)
    .sort((a, b) => b[1] - a[1])
    .map(([tool, count]) => `  ${tool}: ${count}`)
    .join("\n")

  return `You are a pattern extraction agent. Analyze the following tool usage observations from a coding session and extract NON-OBVIOUS patterns that would help future sessions.

## Observations (last ${Math.min(200, observations.length)} of ${observations.length} total)

${obsSummary}

## Tool Usage Statistics
${toolStats}

## Your Task

Extract patterns that are:
- User preferences (e.g., "prefers functional style", "always runs tests before commit")
- Workflow patterns (e.g., "reads files before editing", "greps before writing new code")
- Error resolutions that worked (e.g., "fixed type error by using proper generic")
- Project-specific conventions discovered

## CRITICAL: Non-Derivable Filter

Do NOT extract:
- File paths, code patterns, or architecture details (these are obtainable by reading code)
- Tool names by themselves (not actionable)
- Anything the agent could discover by reading the repo

ONLY extract insights that would NOT be obvious from reading the codebase.

## Output Format

For each pattern found, write a YAML file with this format:
\`\`\`yaml
---
id: <kebab-case-id>
trigger: "when <condition>"
confidence: <0.3-0.85>
domain: <code-style|testing|git|workflow|security|debugging|architecture>
source: session-observation
scope: project
created_at: "${new Date().toISOString()}"
last_confirmed: "${new Date().toISOString()}"
observation_count: <number>
---

# <Title>

## Action
<What the agent should do differently>

## Evidence
- <Supporting observation 1>
- <Supporting observation 2>
\`\`\`

Write each instinct file to .omo/instincts/<project-hash>/personal/<id>.yaml

If you find no non-obvious patterns, write nothing. Quality over quantity.`
}
