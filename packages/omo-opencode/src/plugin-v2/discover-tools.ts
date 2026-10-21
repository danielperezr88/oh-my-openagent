import type { Plugin } from "@opencode/plugin"
import { getLocalToolEmbedder } from "../features/local-embeddings"
import { log } from "../shared/logger"
import { buildCatalog, embeddingText, formatDiscoverResults, keywordFallback, type CatalogMatch } from "./discover-catalog"

const SELF_ID = "discover_tools"
const EXCLUDED_IDS = new Set([SELF_ID, "execute"])

export interface DiscoverToolsOptions {
  readonly topK?: number
  readonly threshold?: number
}

/**
 * MiniLM cosine-similarity floor calibrated against real tool descriptions:
 * relevant intent queries score 0.16-0.35, unrelated pairs top out ~0.11.
 * The embedder's own default (0.3) drops most good matches.
 */
const DEFAULT_THRESHOLD = 0.12

interface QueryArgs {
  readonly query?: string
  readonly top?: number
}

const objectSchema = {
  type: "object" as const,
  additionalProperties: false,
}

/**
 * Registers `discover_tools`: semantic (embedding) tool discovery callable from
 * Code Mode as tools.discover_tools({ query }). Complements the built-in
 * lexical search() with meaning-based ranking; falls back to keyword matching
 * while the local model loads or if it is unavailable.
 */
export function registerDiscoverToolsTool(ctx: Plugin.Context, options: DiscoverToolsOptions = {}): void {
  const embedder = getLocalToolEmbedder()
  embedder.warmup()
  log("[plugin-v2/discover-tools] registered; embedding model warming up in background")

  void ctx.tool.transform((editor) => {
    editor.add({
      name: SELF_ID,
      description:
        "Semantic tool discovery: find tools by meaning using local embeddings. " +
        "Prefer this over the built-in search() when the query is natural-language intent " +
        '(e.g. "what do my notes say about X") or when search() returned nothing useful. ' +
        "Returns ranked tools with their exact call expression.",
      input: {
        ...objectSchema,
        required: ["query"],
        properties: {
          query: { type: "string", description: "What you want to do, in plain language." },
          top: { type: "number", description: "Maximum results (default 5)." },
        },
      },
      async execute(raw) {
        const args = raw as QueryArgs
        const query = (args.query ?? "").trim()
        if (query.length === 0) {
          return { content: "Provide a query describing what you want to do." }
        }
        const topK = Math.max(1, Math.min(args.top ?? options.topK ?? 5, 20))

        const catalog = buildCatalog(await ctx.tool.list(), EXCLUDED_IDS)
        const descriptions = new Map(catalog.map((tool) => [tool.id, embeddingText(tool)]))
        const byID = new Map(catalog.map((tool) => [tool.id, tool]))

        let semantic = true
        let matches: CatalogMatch[] = []
        try {
          const ranked = await embedder.search(query, descriptions, {
            topK,
            threshold: options.threshold ?? DEFAULT_THRESHOLD,
          })
          matches = ranked.flatMap((result) => {
            const tool = byID.get(result.toolID)
            return tool ? [{ tool, score: result.score }] : []
          })
        } catch (e) {
          log(`[plugin-v2/discover-tools] semantic search failed: ${e instanceof Error ? e.message : String(e)}`)
        }
        if (matches.length === 0) {
          semantic = false
          matches = keywordFallback(query, catalog, topK)
        }

        return { content: formatDiscoverResults(query, matches, semantic) }
      },
    })
  })
}
