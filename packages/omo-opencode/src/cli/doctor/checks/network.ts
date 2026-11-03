import { existsSync, readFileSync } from "node:fs"

import { LEGACY_PLUGIN_NAME, PLUGIN_NAME, getOpenCodeConfigPaths, parseJsonc } from "../../../shared"
import { CHECK_IDS, CHECK_NAMES } from "../framework/constants"
import type { CheckResult, DoctorIssue } from "../framework/types"

const PROXY_URL_VARS = ["HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "http_proxy", "https_proxy", "all_proxy"] as const
const REGISTRY_PROBE_URL = "https://registry.npmjs.org/oh-my-openagent"
const MODELS_DEV_PROBE_URL = "https://models.dev/api.json"
const PROBE_TIMEOUT_MS = 5000

export type ProbeOutcome = "ok" | "unreachable"

export interface NetworkCheckDeps {
  /** Environment to inspect; defaults to process.env. */
  env?: Record<string, string | undefined>
  /** Fetch implementation for probes; defaults to globalThis.fetch. Tests inject a mock here. */
  fetchImpl?: typeof fetch
  /** OpenCode config text to parse; when omitted the on-disk config is read. */
  configContent?: string | null
}

interface ProxyProblem {
  readonly variable: string
  readonly problem: string
  readonly fix: string
}

interface PluginResolution {
  readonly registered: boolean
  readonly configPath: string | null
  readonly mode: "local" | "registry" | "none"
  readonly entry: string | null
}

function proxyProblemFor(variable: string, raw: string | undefined): ProxyProblem | null {
  if (raw === undefined) return null
  const value = raw.trim()
  if (value.length === 0) {
    return {
      variable,
      problem: "set but empty (Node fetch fails with: proxy.url must be a non-empty string)",
      fix: `either unset ${variable} or set a full URL`,
    }
  }
  if (!value.includes("//")) {
    return {
      variable,
      problem: `missing URL scheme (value: "${value}")`,
      fix: `set ${variable} including the scheme, e.g. http://${value}`,
    }
  }
  let parsed: URL
  try {
    parsed = new URL(value)
  } catch {
    return {
      variable,
      problem: `not a valid URL (value: "${value}")`,
      fix: `set ${variable} to a full URL, e.g. http://proxy.corp.example:8080`,
    }
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return {
      variable,
      problem: `unsupported scheme "${parsed.protocol}"`,
      fix: `use an http:// or https:// proxy URL for ${variable}`,
    }
  }
  return null
}

function readPluginEntriesFromConfig(content: string): string[] {
  const parsed = parseJsonc<Record<string, unknown>>(content)
  const entries: string[] = []
  const legacy = parsed["plugin"]
  if (Array.isArray(legacy)) {
    for (const item of legacy) {
      if (typeof item === "string") entries.push(item)
    }
  }
  const modern = parsed["plugins"]
  if (Array.isArray(modern)) {
    for (const item of modern) {
      if (typeof item === "string") {
        entries.push(item)
        continue
      }
      if (item !== null && typeof item === "object") {
        const pkg = (item as Record<string, unknown>)["package"]
        if (typeof pkg === "string") entries.push(pkg)
      }
    }
  }
  return entries
}

function isOmoEntry(entry: string): { local: boolean } | null {
  if (entry === PLUGIN_NAME || entry.startsWith(`${PLUGIN_NAME}@`)) return { local: false }
  if (entry === LEGACY_PLUGIN_NAME || entry.startsWith(`${LEGACY_PLUGIN_NAME}@`)) return { local: false }
  if (entry.startsWith("file:") && (entry.includes(PLUGIN_NAME) || entry.includes(LEGACY_PLUGIN_NAME))) {
    return { local: true }
  }
  return null
}

function detectResolution(deps: NetworkCheckDeps): PluginResolution {
  let content: string | null = null
  let configPath: string | null = null
  if (deps.configContent !== undefined) {
    content = deps.configContent
  } else {
    const paths = getOpenCodeConfigPaths({ binary: "opencode", version: null })
    for (const candidate of [paths.configJson, paths.configJsonc]) {
      if (existsSync(candidate)) {
        configPath = candidate
        try {
          content = readFileSync(candidate, "utf-8")
        } catch {
          content = null
        }
        break
      }
    }
  }
  if (content === null || content.trim().length === 0) {
    return { registered: false, configPath, mode: "none", entry: null }
  }
  let entries: string[]
  try {
    entries = readPluginEntriesFromConfig(content)
  } catch {
    return { registered: false, configPath, mode: "none", entry: null }
  }
  for (const entry of entries) {
    const omo = isOmoEntry(entry)
    if (omo) {
      return { registered: true, configPath, mode: omo.local ? "local" : "registry", entry }
    }
  }
  return { registered: false, configPath, mode: "none", entry: null }
}

async function probe(fetchImpl: typeof fetch, url: string): Promise<ProbeOutcome> {
  try {
    await fetchImpl(url, { signal: AbortSignal.timeout(PROBE_TIMEOUT_MS), headers: { accept: "application/json" } })
    return "ok"
  } catch {
    return "unreachable"
  }
}

export async function checkNetwork(deps: NetworkCheckDeps = {}): Promise<CheckResult> {
  const env: Record<string, string | undefined> = deps.env ?? process.env
  const fetchImpl = deps.fetchImpl ?? globalThis.fetch
  const issues: DoctorIssue[] = []
  const details: string[] = []

  const proxyVars = PROXY_URL_VARS.map((variable) => ({ variable, value: env[variable] })).filter(
    (entry) => entry.value !== undefined,
  )
  const noProxy = env["NO_PROXY"] ?? env["no_proxy"]
  details.push(
    proxyVars.length === 0
      ? "no proxy variables set - direct egress assumed"
      : `proxy variables: ${proxyVars.map((entry) => entry.variable).join(", ")}${noProxy ? ` | NO_PROXY=${noProxy}` : ""}`,
  )

  const resolution = detectResolution(deps)
  if (!resolution.registered) {
    return {
      name: CHECK_NAMES[CHECK_IDS.NETWORK],
      status: "skip",
      message: "omo plugin entry not found in the OpenCode config - network checks skipped",
      details,
      issues: [],
    }
  }
  details.push(`plugin resolution: ${resolution.mode} (${resolution.entry ?? "?"})`)

  let registryOutcome: ProbeOutcome | null = null
  if (resolution.mode === "registry") {
    registryOutcome = await probe(fetchImpl, REGISTRY_PROBE_URL)
    details.push(`registry probe ${REGISTRY_PROBE_URL}: ${registryOutcome}`)
    if (registryOutcome === "unreachable") {
      issues.push({
        title: "Plugin resolves from the npm registry, but the registry is unreachable",
        description:
          `OpenCode loads omo by installing "${resolution.entry ?? PLUGIN_NAME}" from the registry. `
          + "With the registry unreachable, omo never loads and OpenCode starts with only the default agents.",
        fix:
          "Load from a local build instead: clone the repo, run script/agent/setup.sh, then set the plugin entry "
          + 'to "file:///<repo>/dist" in opencode.json. Also verify proxy variables are well-formed (scheme included, not empty).',
        affects: ["omo plugin load"],
        severity: "warning",
      })
    }
  } else {
    details.push("registry probe skipped - plugin resolves from a local file:// path (offline-safe)")
  }

  const modelsDevOutcome = await probe(fetchImpl, MODELS_DEV_PROBE_URL)
  details.push(`models.dev probe ${MODELS_DEV_PROBE_URL}: ${modelsDevOutcome}`)
  if (modelsDevOutcome === "unreachable") {
    issues.push({
      title: "models.dev is unreachable",
      description:
        "OpenCode and omo fetch model metadata from models.dev; when it is blocked, startup slows with fetch "
        + "timeouts and model resolution may work from stale cached data only.",
      fix: "Mirror the models.dev catalog internally or accept degraded metadata; pin model ids explicitly in the provider config.",
      affects: ["model metadata"],
      severity: "warning",
    })
  }

  const proxyProblems: ProxyProblem[] = []
  for (const entry of proxyVars) {
    const problem = proxyProblemFor(entry.variable, entry.value)
    if (problem) proxyProblems.push(problem)
  }
  for (const problem of proxyProblems) {
    issues.push({
      title: `Proxy variable ${problem.variable}: ${problem.problem}`,
      description: "Malformed proxy variables break the fetches OpenCode makes at startup (plugin install, model metadata).",
      fix: problem.fix,
      affects: ["omo plugin load", "model metadata"],
      severity: "warning",
    })
  }

  const registryBroken = issues.some((issue) => issue.title.includes("registry is unreachable"))
  const status = registryBroken ? "fail" : issues.length > 0 ? "warn" : "pass"
  const summaryParts = [
    `resolution: ${resolution.mode}`,
    registryOutcome !== null ? `registry ${registryOutcome}` : "registry not needed",
    `models.dev ${modelsDevOutcome}`,
    proxyProblems.length > 0
      ? `${proxyProblems.length} proxy variable problem(s)`
      : proxyVars.length > 0
        ? "proxy variables well-formed"
        : "no proxy configured",
  ]
  return {
    name: CHECK_NAMES[CHECK_IDS.NETWORK],
    status,
    message: `Network: ${summaryParts.join("; ")}`,
    details,
    issues,
  }
}
