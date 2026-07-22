import type { SecurityFinding } from "../types"

interface PermissionFinding {
  readonly rule: string
  readonly pattern: RegExp
  readonly severity: SecurityFinding["severity"]
  readonly message: string
  readonly recommendation: string
}

const PERMISSION_RULES: readonly PermissionFinding[] = [
  {
    rule: "wildcard-tools",
    pattern: /"tools"\s*:\s*\["\*"\]/,
    severity: "high",
    message: "Agent has wildcard tool access (tools: ['*'])",
    recommendation: "Specify only the tools this agent needs. Wildcard access is a security risk.",
  },
  {
    rule: "dangerously-allow-all",
    pattern: /dangerouslyAllowAll[Rr]esources|dangerouslyAllowAllTools/,
    severity: "critical",
    message: "Dangerously allow all flag is enabled",
    recommendation: "Remove this flag and specify exact permissions needed.",
  },
  {
    rule: "shell-exec-without-guard",
    pattern: /"tools"\s*:\s*\[.*"bash".*"edit".*"write"/,
    severity: "medium",
    message: "Agent has both shell and write access",
    recommendation: "Review whether this agent needs both bash and file write permissions.",
  },
]

export function scanPermissions(
  content: string,
  filename: string,
): SecurityFinding[] {
  const findings: SecurityFinding[] = []

  for (const rule of PERMISSION_RULES) {
    if (rule.pattern.test(content)) {
      findings.push({
        severity: rule.severity,
        category: "permissions",
        rule: rule.rule,
        message: rule.message,
        file: filename,
        recommendation: rule.recommendation,
      })
    }
  }

  return findings
}
