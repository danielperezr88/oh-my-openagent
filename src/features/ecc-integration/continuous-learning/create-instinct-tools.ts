import { tool, type ToolDefinition } from "@opencode-ai/plugin"
import { listAllInstincts, listInstincts, saveInstinct, deleteInstinct } from "./instinct-store/storage"
import { serializeInstinct } from "./instinct-store/instinct-parser"
import { applyDecay } from "./instinct-store/confidence"
import type { Instinct } from "./types"

function formatConfidenceBar(confidence: number): string {
  const filled = Math.round(confidence * 10)
  return `[${"=".repeat(filled)}${"-".repeat(10 - filled)}] ${confidence.toFixed(2)}`
}

export function createInstinctListTool(): ToolDefinition {
  return tool({
    description:
      "List all learned instincts (behavioral patterns extracted from past sessions). " +
      "Shows confidence scores, domains, and triggers. Use to review what the agent has learned.",
    args: {
      scope: tool.schema.string().optional().describe("Filter by scope: 'project', 'global', or omit for all"),
      domain: tool.schema.string().optional().describe("Filter by domain (code-style, testing, git, workflow, security, debugging, architecture)"),
    },
    async execute(args: { scope?: string; domain?: string }) {
      let instincts: Instinct[]
      if (args.scope === "project") {
        instincts = listInstincts("project")
      } else if (args.scope === "global") {
        instincts = listInstincts("global")
      } else {
        instincts = listAllInstincts()
      }

      const now = new Date()
      const decayed = instincts.map((i) => ({
        ...i,
        confidence: applyDecay(i.confidence, i.lastConfirmed, now),
      }))

      const filtered = args.domain
        ? decayed.filter((i) => i.domain === args.domain)
        : decayed

      if (filtered.length === 0) {
        return "No instincts found. Instincts are created automatically by the continuous learning system after enough observations are gathered."
      }

      const lines = filtered.map((i) => {
        return [
          `### ${i.id}`,
          `  Domain: ${i.domain}  Scope: ${i.scope}  Confidence: ${formatConfidenceBar(i.confidence)}`,
          `  Trigger: ${i.trigger}`,
          `  Observations: ${i.observationCount}  Source: ${i.source}`,
          `  Last confirmed: ${i.lastConfirmed}`,
        ].join("\n")
      })

      return `## ${filtered.length} Instincts\n\n${lines.join("\n\n")}`
    },
  })
}

export function createInstinctAddTool(): ToolDefinition {
  return tool({
    description:
      "Manually create or update a learned instinct. Use to teach the agent a persistent " +
      "preference or workflow pattern that should apply in future sessions.",
    args: {
      id: tool.schema.string().describe("Unique kebab-case identifier (e.g., 'prefer-functional-style')"),
      trigger: tool.schema.string().describe("When this instinct should apply (e.g., 'when writing new functions')"),
      action: tool.schema.string().describe("What the agent should do (e.g., 'Use functional patterns over classes')"),
      domain: tool.schema.string().optional().describe("Domain: code-style, testing, git, workflow, security, debugging, architecture (default: workflow)"),
      scope: tool.schema.string().optional().describe("Scope: 'project' or 'global' (default: project)"),
      confidence: tool.schema.number().optional().describe("Confidence 0.1-0.9 (default: 0.7)"),
    },
    async execute(args: {
      id: string
      trigger: string
      action: string
      domain?: string
      scope?: string
      confidence?: number
    }) {
      const now = new Date().toISOString()
      const instinct: Instinct = {
        id: args.id,
        trigger: args.trigger,
        confidence: args.confidence ?? 0.7,
        domain: (args.domain ?? "workflow") as Instinct["domain"],
        source: "manual",
        scope: (args.scope ?? "project") as Instinct["scope"],
        createdAt: now,
        lastConfirmed: now,
        observationCount: 1,
        content: `# ${args.id.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())}\n\n## Action\n${args.action}\n\n## Evidence\n- Manually created instinct`,
      }

      saveInstinct(instinct)
      return `Instinct '${args.id}' saved successfully.\nTrigger: ${args.trigger}\nDomain: ${instinct.domain}\nScope: ${instinct.scope}\nConfidence: ${instinct.confidence}`
    },
  })
}

export function createInstinctExportTool(): ToolDefinition {
  return tool({
    description:
      "Export all instincts as YAML text for backup, sharing, or migration. " +
      "Returns the full instinct store in a portable format.",
    args: {
      scope: tool.schema.string().optional().describe("Export only 'project' or 'global' scope. Omit for all."),
    },
    async execute(args: { scope?: string }) {
      const instincts = args.scope === "project"
        ? listInstincts("project")
        : args.scope === "global"
          ? listInstincts("global")
          : listAllInstincts()

      if (instincts.length === 0) {
        return "No instincts to export."
      }

      const yamlDocs = instincts.map((i) => serializeInstinct(i))
      return yamlDocs.join("\n\n---\n\n")
    },
  })
}

export function createInstinctDeleteTool(): ToolDefinition {
  return tool({
    description:
      "Delete a learned instinct by ID. Use to remove incorrect or outdated patterns.",
    args: {
      id: tool.schema.string().describe("The instinct ID to delete"),
      scope: tool.schema.string().optional().describe("Scope to delete from: 'project' or 'global' (default: project)"),
    },
    async execute(args: { id: string; scope?: string }) {
      const scope = (args.scope ?? "project") as "project" | "global"
      const deleted = deleteInstinct(args.id, scope)
      if (deleted) {
        return `Instinct '${args.id}' deleted from ${scope} scope.`
      }
      return `Instinct '${args.id}' not found in ${scope} scope.`
    },
  })
}
