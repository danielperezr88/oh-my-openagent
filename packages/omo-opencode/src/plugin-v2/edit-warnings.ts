import type { Plugin } from "@opencode/plugin"
import { extractFilePath } from "./fact-force-gate"

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

const WARN_PATTERNS = [/package\.json$/]

const EDIT_TOOLS = new Set(["edit", "write", "hashline_edit", "file_edit", "safe_write"])
const DIAGNOSTIC_EXTENSIONS = [".ts", ".tsx", ".js", ".jsx"]

/** Warning text for config-file edits, or null when the path is not protected. */
export function configEditWarning(filePath: string | undefined, modifiesContent: boolean): string | null {
  if (!filePath) return null
  if (PROTECTED_PATTERNS.some((p) => p.test(filePath))) {
    return `You are modifying a build/lint configuration file: ${filePath}. Ensure this change is intentional and reviewed.`
  }
  if (modifiesContent && WARN_PATTERNS.some((p) => p.test(filePath))) {
    return "You are modifying package.json. Review dependency changes carefully."
  }
  return null
}

/** Reminder text when an edit's output signals errors, or null. */
export function diagnosticsReminder(filePath: string | undefined, outputText: string): string | null {
  if (!filePath) return null
  if (!DIAGNOSTIC_EXTENSIONS.some((ext) => filePath.endsWith(ext))) return null
  if (!outputText.toLowerCase().includes("error")) return null
  return `The edit output for ${filePath} contains errors. Check diagnostics and fix before continuing.`
}

function appendToResultText(existing: string, addition: string): string {
  return `${existing}\n\n[omo warning] ${addition}`
}

type ContentPartLike = { readonly type: string; readonly text?: string }

function resultText(result: unknown): string | null {
  if (typeof result !== "object" || result === null) return null
  const content = (result as { content?: unknown }).content
  if (typeof content === "string") return content
  if (Array.isArray(content)) {
    const joined = (content as ContentPartLike[])
      .filter((part) => part.type === "text" && typeof part.text === "string")
      .map((part) => part.text ?? "")
      .join("\n")
    return joined.length > 0 ? joined : null
  }
  return null
}

export function registerEditWarnings(ctx: Plugin.Context): void {
  void ctx.tool.hook("execute.after", (event) => {
    if (!EDIT_TOOLS.has(event.tool)) return
    if (event.status !== "completed") return

    const input = event.input as Record<string, unknown> | undefined
    const filePath = input ? extractFilePath(input) : undefined
    const modifiesContent = typeof input?.content === "string" || typeof input?.newString === "string"

    const currentText = resultText(event.result)
    if (currentText === null) return

    const warning = configEditWarning(filePath, modifiesContent) ?? diagnosticsReminder(filePath, currentText)
    if (!warning) return

    const mutable = event.result as { content?: unknown }
    if (typeof mutable.content === "string") {
      mutable.content = appendToResultText(mutable.content, warning)
      return
    }
    if (Array.isArray(mutable.content)) {
      type MutableContentPart = { type: string; text?: string }
      const parts = mutable.content as MutableContentPart[]
      const lastText = [...parts].reverse().find((part) => part.type === "text" && typeof part.text === "string")
      if (lastText) {
        lastText.text = appendToResultText(lastText.text ?? "", warning)
      } else {
        parts.push({ type: "text", text: `[omo warning] ${warning}` })
      }
    }
  })
}
