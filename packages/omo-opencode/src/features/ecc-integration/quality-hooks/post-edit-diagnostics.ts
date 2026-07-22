import type { Hooks } from "@opencode-ai/plugin"
import { log } from "../../../shared/logger"

type ToolExecuteInput = { tool: string }
type ToolExecuteAfterOutput = {
  title: string
  output: string
  metadata: Record<string, unknown>
}

const EXTENSIONS_TO_CHECK = [".ts", ".tsx", ".js", ".jsx"]

function extractFilePath(args: Record<string, unknown>): string | undefined {
  const raw = args.filePath ?? args.path ?? args.file_path ?? args.file
  return typeof raw === "string" ? raw : undefined
}

function shouldCheck(filePath: string | undefined): boolean {
  if (!filePath) return false
  return EXTENSIONS_TO_CHECK.some((ext) => filePath.endsWith(ext))
}

export function createPostEditDiagnosticsHook(): Hooks {
  return {
    "tool.execute.after": async (input: ToolExecuteInput, output: ToolExecuteAfterOutput) => {
      const editTools = ["edit", "write", "ast_grep_replace"]
      if (!editTools.includes(input.tool)) return

      const metadata = output.metadata as { args?: Record<string, unknown> } | undefined
      const filePath = extractFilePath(metadata?.args ?? {})
      if (!shouldCheck(filePath)) return

      const hasErrors = typeof output.output === "string" && output.output.toLowerCase().includes("error")
      if (hasErrors) {
        log(`[post-edit-diagnostics] Output contains errors after editing ${filePath}`)
      }
    },
  }
}
