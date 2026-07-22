import { tool, type ToolDefinition } from "@opencode-ai/plugin"
import { detectStack } from "./detector"

export function createDetectStackTool(): ToolDefinition {
  return tool({
    description:
      "Detect the project's tech stack by scanning for indicator files and dependencies. " +
      "Returns detected languages, frameworks, package manager, test framework, and runtime.",
    args: {
      path: tool.schema.string().optional().describe("Directory path to scan. Defaults to current working directory."),
    },
    async execute(args: { path?: string }) {
      const info = detectStack(args.path ?? process.cwd())
      return JSON.stringify(info, null, 2)
    },
  })
}
