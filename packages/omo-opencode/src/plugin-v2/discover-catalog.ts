/** Pure catalog logic for the discover_tools semantic search. No V2 imports. */

export interface CatalogTool {
  readonly id: string
  readonly name?: string
  readonly description: string
  readonly input?: unknown
  readonly namespace?: string
}

export interface CatalogMatch {
  readonly tool: CatalogTool
  readonly score: number
}

/** Exact Code Mode call expression for a tool, e.g. tools.fusion360.execute_script. */
export function callExpression(tool: CatalogTool): string {
  if (tool.namespace && tool.name) return `tools.${tool.namespace}.${tool.name}`
  return `tools.${tool.id}`
}

function parameterSummary(input: unknown): string {
  if (typeof input !== "object" || input === null) return ""
  const props = (input as { properties?: unknown }).properties
  if (typeof props !== "object" || props === null) return ""
  return Object.entries(props as Record<string, unknown>)
    .map(([key, value]) => {
      const desc =
        typeof value === "object" && value !== null && typeof (value as { description?: unknown }).description === "string"
          ? (value as { description: string }).description
          : ""
      return desc ? `${key}: ${desc}` : key
    })
    .join(", ")
}

/** Text embedded for one tool: id, description, and parameter hints. */
export function embeddingText(tool: CatalogTool): string {
  const params = parameterSummary(tool.input)
  return [tool.id, tool.description, params].filter((part) => part.length > 0).join("\n")
}

interface RawToolLike {
  readonly id: string
  readonly name?: string
  readonly description: string
  readonly input?: unknown
  readonly options?: { readonly namespace?: string }
}

/** Map ctx.tool.list() output to catalog tools, excluding the given ids. */
export function buildCatalog(raw: readonly RawToolLike[], excluded: ReadonlySet<string>): CatalogTool[] {
  return raw
    .filter((tool) => !excluded.has(tool.id))
    .map((tool) => ({
      id: tool.id,
      name: tool.name,
      description: tool.description ?? "",
      input: tool.input,
      namespace: tool.options?.namespace,
    }))
}

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((term) => term.length >= 3)
}

/**
 * Lexical fallback used when the embedding engine is unavailable or has no
 * confident match. Same intent as the built-in codemode search, minus its
 * stopword noise: tokens shorter than 3 characters are ignored.
 */
export function keywordFallback(query: string, tools: readonly CatalogTool[], topK: number): CatalogMatch[] {
  const terms = tokenize(query)
  if (terms.length === 0) return []

  const matches: CatalogMatch[] = []
  for (const tool of tools) {
    const haystack = embeddingText(tool).toLowerCase()
    const name = (tool.namespace ? `${tool.namespace}.${tool.name ?? tool.id}` : tool.name ?? tool.id).toLowerCase()
    let score = 0
    for (const term of terms) {
      if (name.includes(term)) score += 3
      if (tool.description.toLowerCase().includes(term)) score += 2
      if (haystack.includes(term)) score += 1
    }
    if (score > 0) matches.push({ tool, score })
  }

  matches.sort((a, b) => b.score - a.score || (a.tool.id < b.tool.id ? -1 : a.tool.id > b.tool.id ? 1 : 0))
  return matches.slice(0, topK)
}

function firstSentence(text: string): string {
  const cut = text.replace(/\s+/g, " ").trim()
  const stop = cut.search(/[.!?](\s|$)/)
  const line = stop === -1 ? cut : cut.slice(0, stop + 1)
  return line.length > 160 ? `${line.slice(0, 157)}...` : line
}

/** Human/model readable result block with exact call expressions. */
export function formatDiscoverResults(
  query: string,
  matches: readonly CatalogMatch[],
  semantic: boolean,
): string {
  const mode = semantic ? "semantic" : "keyword fallback (semantic engine unavailable)"
  if (matches.length === 0) {
    return `No tools matched "${query}" (${mode}). Try the built-in search({ query }) with more literal tool-name terms, or broaden the query.`
  }
  const lines = matches.map(
    (m) => `- ${callExpression(m.tool)}  [id: ${m.tool.id}] ${m.tool.description ? firstSentence(m.tool.description) : ""}`,
  )
  return [`Matches for "${query}" (${mode}):`, ...lines].join("\n")
}
