import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { STACK_INDICATORS } from "./indicators"
import type { StackInfo, StackIndicator } from "./types"

function fileExists(basePath: string, pattern: string): boolean {
  if (pattern.includes("*")) {
    return false
  }
  return existsSync(join(basePath, pattern))
}

function extractDeps(basePath: string): Record<string, string> {
  const pkgPath = join(basePath, "package.json")
  if (!existsSync(pkgPath)) return {}
  try {
    const content = JSON.parse(readFileSync(pkgPath, "utf-8"))
    return {
      ...content.dependencies,
      ...content.devDependencies,
    }
  } catch {
    return {}
  }
}

function checkDeps(indicator: StackIndicator, deps: Record<string, string>): boolean {
  if (!indicator.deps || indicator.deps.length === 0) return false
  return indicator.deps.some((dep) => dep in deps)
}

export function detectStack(basePath: string = process.cwd()): StackInfo {
  const languages: string[] = []
  const frameworks: string[] = []
  let packageManager: string | null = null
  let testFramework: string | null = null
  let runtime: string | null = null

  const deps = extractDeps(basePath)

  for (const indicator of STACK_INDICATORS) {
    const fileFound = indicator.files.some((pattern) => fileExists(basePath, pattern))
    const depFound = checkDeps(indicator, deps)
    const matched = fileFound || depFound
    if (!matched) continue

    switch (indicator.type) {
      case "language":
        languages.push(indicator.stack)
        break
      case "framework":
        frameworks.push(indicator.stack)
        break
      case "package-manager":
        if (!packageManager) packageManager = indicator.stack
        break
      case "test-framework":
        if (!testFramework) testFramework = indicator.stack
        break
      case "runtime":
        if (!runtime) runtime = indicator.stack
        break
    }
  }

  return {
    languages: [...new Set(languages)],
    frameworks: [...new Set(frameworks)],
    packageManager,
    testFramework,
    runtime,
  }
}
