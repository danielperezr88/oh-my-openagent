export type Severity = "critical" | "high" | "medium" | "low" | "info"

export type ScanCategory = "secrets" | "permissions" | "hooks" | "mcp" | "agent-config"

export interface SecurityFinding {
  readonly severity: Severity
  readonly category: ScanCategory
  readonly rule: string
  readonly message: string
  readonly file?: string
  readonly line?: number
  readonly recommendation: string
}

export interface ScanResult {
  readonly findings: readonly SecurityFinding[]
  readonly totalFiles: number
  readonly criticalCount: number
  readonly highCount: number
}

export interface SecretPattern {
  readonly id: string
  readonly name: string
  readonly severity: Severity
  readonly pattern: RegExp
  readonly recommendation: string
}
