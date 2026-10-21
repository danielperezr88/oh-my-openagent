import type { Plugin } from "@opencode/plugin"
import { listTopics, matchFragments } from "../features/ecc-integration/knowledge-router/matcher"

function formatResult(fragments: readonly { id: string; topic: string; content: string }[]): string {
  if (fragments.length === 0) {
    const topics = listTopics()
    return `No knowledge fragments matched your query.\n\nAvailable topics: ${topics.join(", ")}`
  }
  const sections = fragments.map((f) => `---\nTopic: ${f.topic} (${f.id})\n${f.content}`)
  return `${sections.join("\n\n")}\n---\n${fragments.length} fragment(s) returned.`
}

interface KnowledgeArgs {
  readonly topic?: string
  readonly language?: string
  readonly framework?: string
  readonly task_type?: string
}

const objectSchema = {
  type: "object" as const,
  additionalProperties: false,
}

export function registerKnowledgeTool(ctx: Plugin.Context): void {
  void ctx.tool.transform((editor) => {
    editor.add({
      name: "knowledge",
      description:
        "Retrieve contextually relevant coding standards, security checklists, and framework patterns. " +
        "Call before implementing features to get targeted guidance instead of generic rules. " +
        "Returns concise fragments matched to your topic, language, and framework.",
      input: {
        ...objectSchema,
        required: ["topic"],
        properties: {
          topic: {
            type: "string",
            description:
              'What you are working on. Use keywords like "auth", "secrets", "input-validation", "sql-injection", "xss", "testing", "error-handling", "react-hooks".',
          },
          language: { type: "string", description: "Programming language (e.g., typescript, python, go)." },
          framework: { type: "string", description: "Framework name (e.g., react, nextjs, express, django)." },
          task_type: { type: "string", description: "Type of task: implementation, review, refactoring, testing." },
        },
      },
      async execute(raw) {
        const args = raw as KnowledgeArgs
        const result = matchFragments({
          topic: args.topic ?? "",
          language: args.language,
          framework: args.framework,
          taskType: args.task_type,
        })
        return { content: formatResult(result.fragments) }
      },
    })
  })
}
