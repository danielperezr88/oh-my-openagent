import { existsSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import type { LocalMcpConfig } from "./lsp"
import { resolveRuntimeExecutable, type RuntimeExecutable, type RuntimeExecutableResolver } from "./runtime-executable"

const ASTROLABE_DIR_NAME = "astrolabe"
const CLI_DIST_REL = "packages/cli/dist/index.js"
const ENV_VAR = "ASTROLABE_HOME"

type AstrolabeMcpConfigOptions = {
  readonly moduleUrl?: string
  readonly exists?: (path: string) => boolean
  readonly resolveExecutable?: RuntimeExecutableResolver
  readonly env?: Record<string, string | undefined>
}

type CommandCandidate = {
  readonly command: string[]
  readonly path: string
  readonly exists: boolean
}

function resolveJavaScriptRuntime(resolveExecutable: RuntimeExecutableResolver): RuntimeExecutable {
  const node = resolveExecutable("node")
  return node.available ? node : resolveExecutable("bun")
}

function getModuleDirectory(moduleUrl: string): string | null {
  try {
    return dirname(fileURLToPath(moduleUrl))
  } catch {
    return null
  }
}

function collectCandidates(
  startDirectory: string,
  pathExists: (path: string) => boolean,
  resolveExecutable: RuntimeExecutableResolver,
  env: Record<string, string | undefined>,
): CommandCandidate[] {
  const candidates: CommandCandidate[] = []
  const seen = new Set<string>()

  const runtime = resolveJavaScriptRuntime(resolveExecutable)

  // 1. ASTROLABE_HOME env var
  const envHome = env[ENV_VAR]
  if (envHome) {
    const cliPath = resolve(envHome, CLI_DIST_REL)
    if (!seen.has(cliPath)) {
      seen.add(cliPath)
      candidates.push({
        command: [runtime.command, cliPath, "serve-mcp"],
        path: cliPath,
        exists: runtime.available && pathExists(cliPath),
      })
    }
  }

  // 2. Walk ancestors looking for sibling astrolabe/ directory
  let currentDirectory = resolve(startDirectory)
  while (true) {
    const siblingCliPath = resolve(currentDirectory, ASTROLABE_DIR_NAME, CLI_DIST_REL)
    if (!seen.has(siblingCliPath)) {
      seen.add(siblingCliPath)
      candidates.push({
        command: [runtime.command, siblingCliPath, "serve-mcp"],
        path: siblingCliPath,
        exists: runtime.available && pathExists(siblingCliPath),
      })
    }

    const parentDirectory = resolve(currentDirectory, "..")
    if (parentDirectory === currentDirectory) break
    currentDirectory = parentDirectory
  }

  return candidates
}

export function createAstrolabeMcpConfig(options: AstrolabeMcpConfigOptions = {}): LocalMcpConfig | null {
  const pathExists = options.exists ?? existsSync
  const resolveExecutable = options.resolveExecutable ?? resolveRuntimeExecutable
  const env = options.env ?? process.env

  const moduleDirectory = getModuleDirectory(options.moduleUrl ?? import.meta.url)
  const searchStart = moduleDirectory ?? process.cwd()

  const candidates = collectCandidates(searchStart, pathExists, resolveExecutable, env)

  const found = candidates.find((candidate) => candidate.exists)
  if (!found) return null

  return {
    type: "local",
    command: found.command,
    enabled: true,
  }
}
