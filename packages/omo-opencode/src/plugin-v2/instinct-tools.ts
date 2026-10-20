import type { Plugin } from "@opencode/plugin"
import {
  deleteInstinct,
  listAllInstincts,
  listInstincts,
  saveInstinct,
} from "../features/ecc-integration/continuous-learning/instinct-store/storage"
import { serializeInstinct } from "../features/ecc-integration/continuous-learning/instinct-store/instinct-parser"
import { applyDecay } from "../features/ecc-integration/continuous-learning/instinct-store/confidence"
import type { Instinct } from "../features/ecc-integration/continuous-learning/types"

interface ScopeArgs {
  readonly scope?: string
}

interface ListArgs extends ScopeArgs {
  readonly domain?: string
}

interface AddArgs {
  readonly id: string
  readonly trigger: string
  readonly action: string
  readonly domain?: string
  readonly scope?: string
  readonly confidence?: number
}

interface DeleteArgs extends ScopeArgs {
  readonly id: string
}

function formatConfidenceBar(confidence: number): string {
  const filled = Math.round(Math.min(Math.max(confidence, 0), 1) * 10)
  return `[${"=".repeat(filled)}${"-".repeat(10 - filled)}] ${confidence.toFixed(2)}`
}

function selectInstincts(args: ListArgs): Instinct[] {
  if (args.scope === "project") return listInstincts("project")
  if (args.scope === "global") return listInstincts("global")
  return listAllInstincts()
}

const objectSchema = {
  type: "object" as const,
  additionalProperties: false,
}

export function registerInstinctTools(ctx: Plugin.Context, projectHash: string): void {
  void ctx.tool.transform((editor) => {
    editor.add({
      name: "instinct_list",
      description:
        "List learned instincts (behavioral patterns extracted from past sessions or added manually). " +
        "Shows confidence, domain, trigger, and observation count. Use to review what has been learned.",
      input: {
        ...objectSchema,
        properties: {
          scope: { type: "string", enum: ["project", "global"], description: "Filter by scope; omit for all" },
          domain: {
            type: "string",
            description: "Filter by domain: code-style, testing, git, workflow, security, debugging, architecture",
          },
        },
      },
      async execute(raw) {
        const args = raw as ListArgs
        const now = new Date()
        const instincts = selectInstincts(args)
          .map((instinct) => ({ ...instinct, confidence: applyDecay(instinct.confidence, instinct.lastConfirmed, now) }))
          .filter((instinct) => !args.domain || instinct.domain === args.domain)

        if (instincts.length === 0) {
          return { content: "No instincts found. Create one with instinct_add or let observation accumulate." }
        }
        const entries = instincts.map((instinct) =>
          [
            `### ${instinct.id}`,
            `  Domain: ${instinct.domain}  Scope: ${instinct.scope}  Confidence: ${formatConfidenceBar(instinct.confidence)}`,
            `  Trigger: ${instinct.trigger}`,
            `  Observations: ${instinct.observationCount}  Source: ${instinct.source}`,
          ].join("\n"),
        )
        return { content: `## ${instincts.length} instincts\n\n${entries.join("\n\n")}` }
      },
    })

    editor.add({
      name: "instinct_add",
      description:
        "Manually create a learned instinct: a persistent preference or workflow pattern that will be " +
        "injected into future sessions when relevant.",
      input: {
        ...objectSchema,
        required: ["id", "trigger", "action"],
        properties: {
          id: { type: "string", description: "Unique kebab-case identifier, e.g. 'prefer-functional-style'" },
          trigger: { type: "string", description: "When this instinct applies, e.g. 'when writing new functions'" },
          action: { type: "string", description: "What to do, e.g. 'Use functional patterns over classes'" },
          domain: { type: "string", description: "code-style, testing, git, workflow, security, debugging, architecture (default: workflow)" },
          scope: { type: "string", enum: ["project", "global"], description: "default: project" },
          confidence: { type: "number", description: "0.1-0.9 (default: 0.7)" },
        },
      },
      async execute(raw) {
        const args = raw as AddArgs
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
          content: `# ${args.id}\n\n## Action\n${args.action}\n\n## Evidence\n- Manually created instinct`,
        }
        saveInstinct(instinct, projectHash)
        return {
          content: `Instinct '${args.id}' saved.\nTrigger: ${args.trigger}\nDomain: ${instinct.domain}\nScope: ${instinct.scope}\nConfidence: ${instinct.confidence}`,
        }
      },
    })

    editor.add({
      name: "instinct_export",
      description: "Export instincts as YAML text for backup, sharing, or migration.",
      input: {
        ...objectSchema,
        properties: {
          scope: { type: "string", enum: ["project", "global"], description: "Export only this scope; omit for all" },
        },
      },
      async execute(raw) {
        const args = raw as ScopeArgs
        const instincts =
          args.scope === "project"
            ? listInstincts("project", projectHash)
            : args.scope === "global"
              ? listInstincts("global")
              : listAllInstincts(projectHash)
        if (instincts.length === 0) return { content: "No instincts to export." }
        return { content: instincts.map((instinct) => serializeInstinct(instinct)).join("\n\n---\n\n") }
      },
    })

    editor.add({
      name: "instinct_delete",
      description: "Delete a learned instinct by ID. Use to remove incorrect or outdated patterns.",
      input: {
        ...objectSchema,
        required: ["id"],
        properties: {
          id: { type: "string", description: "The instinct ID to delete" },
          scope: { type: "string", enum: ["project", "global"], description: "default: project" },
        },
      },
      async execute(raw) {
        const args = raw as DeleteArgs
        const scope = (args.scope ?? "project") as "project" | "global"
        const deleted = deleteInstinct(args.id, scope, projectHash)
        return {
          content: deleted
            ? `Instinct '${args.id}' deleted from ${scope} scope.`
            : `Instinct '${args.id}' not found in ${scope} scope.`,
        }
      },
    })
  })
}
