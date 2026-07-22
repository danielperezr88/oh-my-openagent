import type { SecretPattern } from "../types"

export const SECRET_PATTERNS: readonly SecretPattern[] = [
  {
    id: "aws-access-key",
    name: "AWS Access Key ID",
    severity: "critical",
    pattern: /AKIA[A-Z0-9]{16}/,
    recommendation: "Remove the key, rotate it in AWS IAM, and use environment variables or a secrets manager.",
  },
  {
    id: "github-token",
    name: "GitHub Personal Access Token",
    severity: "critical",
    pattern: /ghp_[a-zA-Z0-9]{36}/,
    recommendation: "Revoke the token in GitHub settings and use a secrets manager.",
  },
  {
    id: "github-fine-grained-token",
    name: "GitHub Fine-Grained Token",
    severity: "critical",
    pattern: /github_pat_[a-zA-Z0-9_]{22,}/,
    recommendation: "Revoke the token and use environment variables.",
  },
  {
    id: "openai-api-key",
    name: "OpenAI API Key",
    severity: "critical",
    pattern: /sk-[a-zA-Z0-9]{20,}/,
    recommendation: "Rotate the key in OpenAI dashboard and store it in environment variables.",
  },
  {
    id: "anthropic-api-key",
    name: "Anthropic API Key",
    severity: "critical",
    pattern: /sk-ant-[a-zA-Z0-9-]{20,}/,
    recommendation: "Rotate the key in Anthropic console and use env vars.",
  },
  {
    id: "google-api-key",
    name: "Google API Key",
    severity: "high",
    pattern: /AIza[a-zA-Z0-9_-]{35}/,
    recommendation: "Restrict the key in Google Cloud Console and rotate if exposed.",
  },
  {
    id: "private-key-block",
    name: "Private Key Block",
    severity: "critical",
    pattern: /-----BEGIN\s+(RSA\s+|EC\s+|OPENSSH\s+|PGP\s+)?PRIVATE KEY-----/,
    recommendation: "Remove the private key from source, rotate it, and use a secrets manager.",
  },
  {
    id: "database-url-with-creds",
    name: "Database URL with Credentials",
    severity: "high",
    pattern: /(postgres|postgresql|mongodb|mysql|redis):\/\/[^:\s]+:[^@\s]+@/,
    recommendation: "Use environment variables for the connection string, not hardcoded credentials.",
  },
  {
    id: "slack-token",
    name: "Slack Token",
    severity: "high",
    pattern: /xox[baprs]-[a-zA-Z0-9-]{10,}/,
    recommendation: "Revoke the token in Slack admin and use env vars.",
  },
  {
    id: "stripe-key",
    name: "Stripe Secret Key",
    severity: "critical",
    pattern: /sk_(live|test)_[a-zA-Z0-9]{24,}/,
    recommendation: "Roll the key in Stripe dashboard immediately.",
  },
  {
    id: "jwt-secret-assignment",
    name: "JWT Secret Assignment",
    severity: "medium",
    pattern: /(jwt[_-]?secret|JWT[_-]?SECRET)\s*[:=]\s*["'][^"']{8,}["']/,
    recommendation: "Load JWT secrets from environment variables, never hardcode them.",
  },
  {
    id: "password-assignment",
    name: "Password Assignment",
    severity: "medium",
    pattern: /(password|passwd|pwd)\s*[:=]\s*["'][^"']{4,}["']/i,
    recommendation: "Do not hardcode passwords. Use env vars or a secrets manager.",
  },
  {
    id: "generic-bearer-token",
    name: "Generic Bearer Token",
    severity: "low",
    pattern: /Bearer\s+[a-zA-Z0-9._-]{20,}/,
    recommendation: "Review whether this is a hardcoded token or a dynamic value.",
  },
  {
    id: "twilio-auth-token",
    name: "Twilio Auth Token",
    severity: "high",
    pattern: /SK[a-zA-Z0-9]{32}:[a-zA-Z0-9]{32}/,
    recommendation: "Rotate the token in Twilio console and use env vars.",
  },
]

const IGNORE_EXTENSIONS = [".lock", ".min.js", ".min.css", ".map"]
const IGNORE_FILENAMES = ["bun.lock", "yarn.lock", "package-lock.json", "Cargo.lock", "go.sum"]

export function shouldScanFile(filename: string): boolean {
  if (IGNORE_FILENAMES.includes(filename)) return false
  return !IGNORE_EXTENSIONS.some((ext) => filename.endsWith(ext))
}

export function scanFileForSecrets(
  content: string,
  filename: string,
): { id: string; name: string; severity: string; line: number; recommendation: string }[] {
  const lines = content.split("\n")
  const findings: { id: string; name: string; severity: string; line: number; recommendation: string }[] = []

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    for (const pattern of SECRET_PATTERNS) {
      if (pattern.pattern.test(line)) {
        findings.push({
          id: pattern.id,
          name: pattern.name,
          severity: pattern.severity,
          line: i + 1,
          recommendation: pattern.recommendation,
        })
      }
    }
  }

  return findings
}
