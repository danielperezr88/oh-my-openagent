/**
 * Secret scrubbing for observation data.
 * Reuses the regex patterns from security-scanner/rules/secrets.ts.
 */

const SCRUB_PATTERNS: readonly { pattern: RegExp; replacement: string }[] = [
  { pattern: /AKIA[A-Z0-9]{16}/g, replacement: "[REDACTED:AWS_KEY]" },
  { pattern: /ghp_[a-zA-Z0-9]{36}/g, replacement: "[REDACTED:GH_TOKEN]" },
  { pattern: /github_pat_[a-zA-Z0-9_]{22,}/g, replacement: "[REDACTED:GH_PAT]" },
  { pattern: /sk-[a-zA-Z0-9]{20,}/g, replacement: "[REDACTED:API_KEY]" },
  { pattern: /sk-ant-[a-zA-Z0-9-]{20,}/g, replacement: "[REDACTED:ANT_KEY]" },
  { pattern: /AIza[a-zA-Z0-9_-]{35}/g, replacement: "[REDACTED:GOOGLE_KEY]" },
  { pattern: /-----BEGIN\s+(?:RSA\s+|EC\s+|OPENSSH\s+|PGP\s+)?PRIVATE KEY-----/g, replacement: "[REDACTED:PRIVATE_KEY]" },
  { pattern: /(postgres|postgresql|mongodb|mysql|redis):\/\/[^:\s]+:[^@\s]+@/g, replacement: "$1://[REDACTED]@" },
  { pattern: /xox[baprs]-[a-zA-Z0-9-]{10,}/g, replacement: "[REDACTED:SLACK_TOKEN]" },
  { pattern: /sk_(live|test)_[a-zA-Z0-9]{24,}/g, replacement: "sk_$1_[REDACTED]" },
  { pattern: /(jwt[_-]?secret|JWT[_-]?SECRET)\s*[:=]\s*["'][^"']{8,}["']/g, replacement: "$1=[REDACTED]" },
  { pattern: /(password|passwd|pwd)\s*[:=]\s*["'][^"']{4,}["']/gi, replacement: "$1=[REDACTED]" },
  { pattern: /Bearer\s+[a-zA-Z0-9._-]{20,}/g, replacement: "Bearer [REDACTED]" },
]

export function scrubSecrets(text: string): string {
  let result = text
  for (const { pattern, replacement } of SCRUB_PATTERNS) {
    result = result.replace(pattern, replacement)
  }
  return result
}

export function truncate(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text
  return text.slice(0, maxChars) + "...[truncated]"
}

export function scrubAndTruncate(text: string | undefined, maxChars: number): string | undefined {
  if (!text) return undefined
  return truncate(scrubSecrets(text), maxChars)
}
