import type { Hooks } from "@opencode-ai/plugin"

type ToolExecuteInput = { tool: string }
type ToolExecuteBeforeOutput = { args: Record<string, unknown> }

const PROTECTED_PATTERNS = [
  /tsconfig\.json$/,
  /biome\.json$/,
  /\.eslintrc/,
  /\.prettierrc/,
  /babel\.config/,
  /vite\.config/,
  /next\.config/,
  /tailwind\.config/,
  /webpack\.config/,
  /rollup\.config/,
]

const WARN_PATTERNS = [
  /package\.json$/,
]

function extractFilePath(args: Record<string, unknown>): string | undefined {
  const raw = args.filePath ?? args.path ?? args.file_path ?? args.file
  return typeof raw === "string" ? raw : undefined
}

export function createConfigProtectionHook(): Hooks {
  return {
    "tool.execute.before": async (_input: ToolExecuteInput, output: ToolExecuteBeforeOutput) => {
      const filePath = extractFilePath(output.args)
      if (!filePath) return

      const isProtected = PROTECTED_PATTERNS.some((p) => p.test(filePath))
      const isWarnOnly = WARN_PATTERNS.some((p) => p.test(filePath))

      if (isProtected) {
        output.args.__warning = `You are modifying a build/lint configuration file: ${filePath}. Ensure this change is intentional and reviewed.`
      } else if (isWarnOnly) {
        const action = output.args.content ?? output.args.newString ?? output.args.rewrite
        if (action) {
          output.args.__warning = `You are modifying package.json. Review dependency changes carefully.`
        }
      }
    },
  }
}
