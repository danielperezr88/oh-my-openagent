import { tool, type ToolDefinition } from "@opencode-ai/plugin"
import { listTopics, matchFragments } from "./matcher"

function formatResult(fragments: readonly { id: string; topic: string; content: string }[]): string {
  if (fragments.length === 0) {
    const topics = listTopics()
    return `No knowledge fragments matched your query.\n\nAvailable topics: ${topics.join(", ")}`
  }
  const sections = fragments.map(
    (f) => `---\nTopic: ${f.topic} (${f.id})\n${f.content}`,
  )
  return `${sections.join("\n\n")}\n---\n${fragments.length} fragment(s) returned.`
}

export function createContextualKnowledgeTool(): ToolDefinition {
  return tool({
    description:
      "Retrieve contextually relevant coding standards, security checklists, and framework patterns. " +
      "Call before implementing features to get targeted guidance instead of generic rules. " +
      "Returns concise fragments matched to your topic, language, and framework.",
    args: {
      topic: tool.schema.string().describe(
        'What you are working on. Use keywords like "auth", "secrets", "input-validation", "sql-injection", "xss", "testing", "error-handling", "react-hooks", etc.',
      ),
      language: tool.schema.string().optional().describe("Programming language (e.g., typescript, python, go)."),
      framework: tool.schema.string().optional().describe("Framework name (e.g., react, nextjs, express, django)."),
      task_type: tool.schema.string().optional().describe("Type of task: implementation, review, refactoring, testing."),
    },
    async execute(args: { topic: string; language?: string; framework?: string; task_type?: string }) {
      const result = matchFragments({
        topic: args.topic,
        language: args.language,
        framework: args.framework,
        taskType: args.task_type,
      })
      return formatResult(result.fragments)
    },
  })
}
