import type { Instinct, InstinctDomain, InstinctScope, InstinctSource } from "../types"

interface ParsedInstinct {
  readonly frontmatter: Record<string, unknown>
  readonly body: string
}

const FRONTMATTER_DELIMITER = "---"

export function parseInstinctFile(content: string): Instinct | null {
  const parsed = splitFrontmatter(content)
  if (!parsed) return null

  const fm = parsed.frontmatter
  const id = String(fm.id ?? "")
  const trigger = String(fm.trigger ?? "")
  if (!id || !trigger) return null

  return {
    id,
    trigger,
    confidence: Number(fm.confidence ?? 0.3),
    domain: String(fm.domain ?? "workflow") as InstinctDomain,
    source: String(fm.source ?? "session-observation") as InstinctSource,
    scope: String(fm.scope ?? "project") as InstinctScope,
    projectHash: fm.project_hash ? String(fm.project_hash) : undefined,
    createdAt: String(fm.created_at ?? new Date().toISOString()),
    lastConfirmed: String(fm.last_confirmed ?? new Date().toISOString()),
    observationCount: Number(fm.observation_count ?? 1),
    content: parsed.body.trim(),
  }
}

export function serializeInstinct(instinct: Instinct): string {
  const fm: Record<string, unknown> = {
    id: instinct.id,
    trigger: instinct.trigger,
    confidence: instinct.confidence,
    domain: instinct.domain,
    source: instinct.source,
    scope: instinct.scope,
  }
  if (instinct.projectHash) fm.project_hash = instinct.projectHash
  fm.created_at = instinct.createdAt
  fm.last_confirmed = instinct.lastConfirmed
  fm.observation_count = instinct.observationCount

  const fmLines = Object.entries(fm).map(([k, v]) => `${k}: ${formatValue(v)}`)
  return `${FRONTMATTER_DELIMITER}\n${fmLines.join("\n")}\n${FRONTMATTER_DELIMITER}\n\n${instinct.content}`
}

function formatValue(v: unknown): string {
  if (typeof v === "string" && v.includes(" ")) return `"${v}"`
  return String(v)
}

function splitFrontmatter(content: string): ParsedInstinct | null {
  const trimmed = content.trimStart()
  if (!trimmed.startsWith(FRONTMATTER_DELIMITER)) return null

  const endOfFirstDelimiter = trimmed.indexOf("\n")
  if (endOfFirstDelimiter === -1) return null

  const afterFirst = trimmed.slice(endOfFirstDelimiter + 1)
  const closingIdx = afterFirst.indexOf(`\n${FRONTMATTER_DELIMITER}`)
  if (closingIdx === -1) return null

  const fmContent = afterFirst.slice(0, closingIdx)
  const body = afterFirst.slice(closingIdx + FRONTMATTER_DELIMITER.length + 2)

  const frontmatter = parseSimpleYaml(fmContent)
  return { frontmatter, body }
}

function parseSimpleYaml(text: string): Record<string, unknown> {
  const result: Record<string, unknown> = {}
  for (const line of text.split("\n")) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith("#")) continue

    const colonIdx = trimmed.indexOf(":")
    if (colonIdx === -1) continue

    const key = trimmed.slice(0, colonIdx).trim()
    let value: string = trimmed.slice(colonIdx + 1).trim()

    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1)
    }

    const num = Number(value)
    if (value !== "" && !isNaN(num)) {
      result[key] = num
    } else {
      result[key] = value
    }
  }
  return result
}
