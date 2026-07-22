import { tool, type ToolDefinition } from "@opencode-ai/plugin"
import { scanPath } from "./scanner"

function formatFindings(findings: readonly {
  severity: string
  category: string
  rule: string
  message: string
  file?: string
  line?: number
  recommendation: string
}[], totalFiles: number): string {
  if (findings.length === 0) {
    return `Security scan complete. No findings across ${totalFiles} files scanned.`
  }

  const critical = findings.filter((f) => f.severity === "critical").length
  const high = findings.filter((f) => f.severity === "high").length

  const header = `Security scan: ${findings.length} finding(s) across ${totalFiles} files (${critical} critical, ${high} high)\n`

  const lines = findings.slice(0, 50).map((f) => {
    const location = f.file ? ` in ${f.file}${f.line ? `:${f.line}` : ""}` : ""
    return `[${f.severity.toUpperCase()}] ${f.message}${location}\n  Rule: ${f.rule}\n  Fix: ${f.recommendation}`
  })

  const truncated = findings.length > 50 ? `\n... and ${findings.length - 50} more findings` : ""

  return `${header}\n${lines.join("\n\n")}${truncated}`
}

export function createSecurityScanTool(): ToolDefinition {
  return tool({
    description:
      "Scan project files for security vulnerabilities: hardcoded secrets (API keys, passwords, private keys), " +
      "permission overreach, dangerous MCP configs. Returns findings sorted by severity. " +
      "Use before commits or PRs to catch security issues early.",
    args: {
      path: tool.schema.string().optional().describe("Directory path to scan. Defaults to current working directory."),
    },
    async execute(args: { path?: string }) {
      const { findings, totalFiles } = scanPath(args.path ?? process.cwd())
      return formatFindings(findings, totalFiles)
    },
  })
}
