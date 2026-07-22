import type { SecurityFinding } from "../types"

interface McpFinding {
  readonly rule: string
  readonly pattern: RegExp
  readonly severity: SecurityFinding["severity"]
  readonly message: string
  readonly recommendation: string
}

const MCP_RULES: readonly McpFinding[] = [
  {
    rule: "mcp-no-auth",
    pattern: /"type"\s*:\s*"http"[^}]*"url"\s*:\s*"https?:\/\/[^"]*"/,
    severity: "medium",
    message: "HTTP MCP server may lack authentication",
    recommendation: "Add authentication headers or tokens to the MCP server configuration.",
  },
  {
    rule: "mcp-env-secret",
    pattern: /"env"\s*:\s*\{[^}]*"(api_?key|secret|token|password)"/i,
    severity: "high",
    message: "MCP server config contains inline secrets in env",
    recommendation: "Use environment variable references (e.g., ${API_KEY}) instead of inline values.",
  },
]

export function scanMcpConfig(
  content: string,
  filename: string,
): SecurityFinding[] {
  const findings: SecurityFinding[] = []

  for (const rule of MCP_RULES) {
    if (rule.pattern.test(content)) {
      findings.push({
        severity: rule.severity,
        category: "mcp",
        rule: rule.rule,
        message: rule.message,
        file: filename,
        recommendation: rule.recommendation,
      })
    }
  }

  return findings
}
