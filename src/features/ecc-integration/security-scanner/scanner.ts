import { readFileSync, statSync, readdirSync } from "node:fs"
import { join, extname } from "node:path"
import type { SecurityFinding, Severity } from "./types"
import { scanFileForSecrets, shouldScanFile } from "./rules/secrets"
import { scanPermissions } from "./rules/permissions"
import { scanMcpConfig } from "./rules/mcp"

const SCANNABLE_EXTENSIONS = [
  ".ts", ".tsx", ".js", ".jsx", ".json", ".jsonc",
  ".py", ".go", ".rs", ".java", ".rb",
  ".yaml", ".yml", ".toml", ".env",
  ".sh", ".bash",
  ".md",
]

const IGNORE_DIRS = [
  "node_modules", ".git", "dist", "build", ".next",
  "__pycache__", ".venv", "venv", ".cache",
  "vendor", "target", ".gradle",
]

const MAX_FILE_SIZE = 1024 * 1024

function isScannable(filePath: string): boolean {
  const ext = extname(filePath)
  const filename = filePath.split(/[/\\]/).pop() ?? ""
  if (!SCANNABLE_EXTENSIONS.includes(ext) && !filename.startsWith(".env")) return false
  if (!shouldScanFile(filename)) return false
  try {
    const stat = statSync(filePath)
    return stat.size <= MAX_FILE_SIZE
  } catch {
    return false
  }
}

function walkDirectory(dir: string, files: string[]): void {
  let entries: string[]
  try {
    entries = readdirSync(dir)
  } catch {
    return
  }
  for (const entry of entries) {
    if (IGNORE_DIRS.includes(entry)) continue
    const fullPath = join(dir, entry)
    try {
      const stat = statSync(fullPath)
      if (stat.isDirectory()) {
        walkDirectory(fullPath, files)
      } else if (isScannable(fullPath)) {
        files.push(fullPath)
      }
    } catch {
      continue
    }
  }
}

const SEVERITY_ORDER: Record<Severity, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
  info: 4,
}

export function scanPath(basePath: string): {
  findings: SecurityFinding[]
  totalFiles: number
} {
  const files: string[] = []
  walkDirectory(basePath, files)

  const allFindings: SecurityFinding[] = []

  for (const filePath of files) {
    let content: string
    try {
      content = readFileSync(filePath, "utf-8")
    } catch {
      continue
    }

    const filename = filePath.split(/[/\\]/).pop() ?? filePath
    const isConfig = filename.endsWith(".json") || filename.endsWith(".jsonc") || filename.endsWith(".yaml") || filename.endsWith(".yml")

    const secretFindings = scanFileForSecrets(content, filename)
    for (const f of secretFindings) {
      allFindings.push({
        severity: f.severity as Severity,
        category: "secrets",
        rule: f.id,
        message: `${f.name} detected`,
        file: filePath,
        line: f.line,
        recommendation: f.recommendation,
      })
    }

    if (isConfig) {
      const permFindings = scanPermissions(content, filename)
      const mcpFindings = scanMcpConfig(content, filename)
      allFindings.push(...permFindings, ...mcpFindings)
    }
  }

  allFindings.sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity])

  return {
    findings: allFindings,
    totalFiles: files.length,
  }
}
