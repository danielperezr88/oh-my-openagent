import { tool, type ToolDefinition } from "@opencode-ai/plugin/tool"
import type { McpDeferredRegistry } from "../../hooks/mcp-deferred-loader/registry"
import { MCP_TOOL_ID_PREFIX } from "../../hooks/mcp-deferred-loader/constants"
import { getLocalToolEmbedder, type SemanticSearchResult } from "../../features/local-embeddings"
import { log } from "../../shared/logger"

interface DiscoverToolsDeps {
  registry: McpDeferredRegistry
  getMcpToolIDs: () => string[]
  getToolDescriptions: () => Map<string, string>
  /** @deprecated Use local embeddings instead. */
  semanticUrl?: string
}

export function createDiscoverToolsTool(deps: DiscoverToolsDeps): ToolDefinition {
  const { registry, getMcpToolIDs, getToolDescriptions } = deps

  return tool({
    description: `Search and discover MCP tools. Returns matching tool names and descriptions, and unlocks their full schemas for use in subsequent requests.

When you need an MCP tool but only see a stub description, use this tool to find and unlock the relevant tools by searching their names or keywords.`,
    args: {
      query: tool.schema.string().describe("Search query: tool name or keyword to search MCP tool names and descriptions"),
    },
    execute: async (args) => {
      const query = typeof args.query === "string" ? args.query.trim() : ""
      if (!query) {
        return JSON.stringify({ error: "query is required" })
      }

      // Try semantic discovery first (local embeddings)
      const semanticResult = await trySemanticDiscovery(query, registry)
      if (semanticResult !== null) {
        return semanticResult
      }

      // Fallback: substring search
      return substringDiscovery(query, registry, getMcpToolIDs, getToolDescriptions)
    },
  })
}

async function trySemanticDiscovery(
  query: string,
  registry: McpDeferredRegistry,
): Promise<string | null> {
  const embedder = getLocalToolEmbedder()

  if (!embedder.isReady()) {
    const becameReady = await embedder.waitForReady(3000)
    if (!becameReady) {
      log("[discover-tools] Local embedder not ready, falling back to substring search")
      return null
    }
  }

  try {
    const descriptions = registry.getAllToolDescriptions()
    const undiscovered = registry.getUndiscoveredTools()

    // Filter descriptions to only undiscovered tools
    const searchDescriptions = new Map<string, string>()
    for (const toolID of undiscovered) {
      const desc = descriptions.get(toolID)
      if (desc) {
        searchDescriptions.set(toolID, desc)
      }
    }

    if (searchDescriptions.size === 0) return null

    const results = await embedder.search(query, searchDescriptions, {
      threshold: 0.3,
      topK: 5,
    })

    if (results.length === 0) {
      return JSON.stringify({
        result: "no_matches",
        message: `No MCP tools found matching "${query}" (semantic search).`,
        available_tools: undiscovered,
      })
    }

    // Mark discovered
    const discoveredIDs = results.map((r) => r.toolID)
    registry.markDiscovered(discoveredIDs)

    const matches = results.map((r) => ({
      toolID: r.toolID,
      description: descriptions.get(r.toolID) ?? "No description available",
      score: Math.round(r.score * 100) / 100,
    }))

    return JSON.stringify({
      result: "discovered",
      discovered_count: matches.length,
      semantic: true,
      tools: matches,
    })
  } catch (error) {
    log("[discover-tools] Semantic discovery failed", { error: String(error) })
    return null
  }
}

function substringDiscovery(
  query: string,
  registry: McpDeferredRegistry,
  getMcpToolIDs: () => string[],
  getToolDescriptions: () => Map<string, string>,
): string {
  const queryLower = query.toLowerCase()
  const allMcpTools = getMcpToolIDs()
  const descriptions = getToolDescriptions()

  const matches: Array<{ toolID: string; description: string }> = []
  const discoveredIDs: string[] = []

  for (const toolID of allMcpTools) {
    if (registry.isAlwaysLoaded(toolID)) continue

    const nameLower = toolID.toLowerCase()
    const descLower = (descriptions.get(toolID) ?? "").toLowerCase()

    if (nameLower.includes(queryLower) || descLower.includes(queryLower)) {
      const desc = descriptions.get(toolID) ?? "No description available"
      matches.push({ toolID, description: desc })
      discoveredIDs.push(toolID)
    }
  }

  if (discoveredIDs.length > 0) {
    registry.markDiscovered(discoveredIDs)
  }

  if (matches.length === 0) {
    return JSON.stringify({
      result: "no_matches",
      message: `No MCP tools found matching "${query}".`,
      available_tools: allMcpTools.filter(id => !registry.isAlwaysLoaded(id)),
    })
  }

  return JSON.stringify({
    result: "discovered",
    discovered_count: matches.length,
    semantic: false,
    tools: matches,
  })
}

/**
 * Auto-discover tools based on a user message using local semantic search.
 * Called from messages.transform on the first user message.
 * Returns the number of tools discovered, or 0 if embeddings unavailable.
 */
export async function autoDiscoverFromMessage(
  message: string,
  registry: McpDeferredRegistry,
): Promise<number> {
  if (!message || message.length < 5) return 0

  const embedder = getLocalToolEmbedder()

  // Wait for embedder to be ready (with short timeout)
  if (!embedder.isReady()) {
    const becameReady = await embedder.waitForReady(3000)
    if (!becameReady) {
      log("[mcp-deferred-loader] Embedder not ready for auto-discovery, skipping")
      return 0
    }
  }

  try {
    const descriptions = registry.getAllToolDescriptions()
    const undiscovered = registry.getUndiscoveredTools()

    const searchDescriptions = new Map<string, string>()
    for (const toolID of undiscovered) {
      const desc = descriptions.get(toolID)
      if (desc) {
        searchDescriptions.set(toolID, desc)
      }
    }

    if (searchDescriptions.size === 0) return 0

    const results = await embedder.search(message, searchDescriptions, {
      threshold: 0.4,
      topK: 3,
    })

    if (results.length === 0) return 0

    const discoveredIDs = results.map((r) => r.toolID)
    registry.markDiscovered(discoveredIDs)

    log("[discover-tools] Auto-discovered tools from message (local embeddings)", {
      count: discoveredIDs.length,
      tools: discoveredIDs,
      scores: results.map((r) => Math.round(r.score * 100) / 100),
    })

    return discoveredIDs.length
  } catch (err) {
    log("[discover-tools] Auto-discovery failed", { error: String(err) })
    return 0
  }
}

export function extractMcpToolIDs(tools: Record<string, unknown>): string[] {
  return Object.keys(tools).filter(id => id.startsWith(MCP_TOOL_ID_PREFIX))
}

export function extractMcpToolDescriptions(tools: Record<string, unknown>): Map<string, string> {
  const map = new Map<string, string>()
  for (const [id, def] of Object.entries(tools)) {
    if (id.startsWith(MCP_TOOL_ID_PREFIX)) {
      const desc = (def as { description?: string })?.description
      if (typeof desc === "string") {
        map.set(id, desc)
      }
    }
  }
  return map
}
