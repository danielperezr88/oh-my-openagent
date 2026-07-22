import { describe, it, expect, beforeEach } from "bun:test"
import { createDiscoverToolsTool, extractMcpToolDescriptions } from "../../tools/discover-tools"
import { McpDeferredRegistry } from "../../hooks/mcp-deferred-loader/registry"
import { LocalToolEmbedder, _resetEmbedderSingleton, getLocalToolEmbedder } from "./embedder"
import { createMcpDeferredLoaderHook } from "../../hooks/mcp-deferred-loader/hook"

/**
 * Helper: inject a mock pipeline into a LocalToolEmbedder for testing.
 * The mock uses keyword matching to simulate semantic embeddings.
 */
function injectMockPipeline(embedder: LocalToolEmbedder): void {
  const anyEmbedder = embedder as unknown as {
    pipeline: (texts: string[], opts: { pooling: string; normalize: boolean }) => Promise<{ data: Float32Array; dims: number[] }>
    ready: boolean
    cachedDescriptionsHash: string
    descriptionEmbeddings: Map<string, number[]>
  }

  anyEmbedder.ready = true
  // Clear cache so fresh descriptions get embedded
  anyEmbedder.cachedDescriptionsHash = ""
  anyEmbedder.descriptionEmbeddings = new Map()

  anyEmbedder.pipeline = async (texts: string[], _opts: { pooling: string; normalize: boolean }) => {
    const dim = 4
    const data = new Float32Array(texts.length * dim)

    for (let i = 0; i < texts.length; i++) {
      const text = texts[i]!.toLowerCase()
      let emb: number[]
      if (text.includes("search") || text.includes("web") || text.includes("find") || text.includes("internet")) {
        emb = [0.95, 0.05, 0.0, 0.0]
      } else if (text.includes("read") || text.includes("file") || text.includes("document") || text.includes("fetch")) {
        emb = [0.0, 0.05, 0.95, 0.0]
      } else if (text.includes("terminal") || text.includes("bash") || text.includes("command") || text.includes("shell")) {
        emb = [0.0, 0.0, 0.05, 0.95]
      } else {
        emb = [0.25, 0.25, 0.25, 0.25]
      }
      for (let j = 0; j < dim; j++) {
        data[i * dim + j] = emb[j]!
      }
    }

    return { data, dims: [texts.length, dim] }
  }
}

describe("discover_tools with local embeddings", () => {
  let registry: McpDeferredRegistry
  let mcpToolIDs: string[]
  let descriptions: Map<string, string>

  beforeEach(() => {
    // Reset singleton so each test gets a fresh embedder
    _resetEmbedderSingleton()

    registry = new McpDeferredRegistry(["websearch"])
    mcpToolIDs = [
      "mcp__websearch__search",
      "mcp__websearch__fetch",
      "mcp__context7__resolve",
      "mcp__grep_app__search",
    ]
    descriptions = new Map([
      ["mcp__websearch__search", "Search the web using Exa or Tavily"],
      ["mcp__websearch__fetch", "Fetch and read a web page URL"],
      ["mcp__context7__resolve", "Resolve library documentation queries"],
      ["mcp__grep_app__search", "Search code patterns using grep.app"],
    ])

    registry.setAllMcpToolIDs(mcpToolIDs)
    registry.setToolDescriptions(descriptions)

    // Inject mock pipeline into the singleton embedder
    const embedder = getLocalToolEmbedder()
    injectMockPipeline(embedder)
  })

  const createTool = () =>
    createDiscoverToolsTool({
      registry,
      getMcpToolIDs: () => mcpToolIDs,
      getToolDescriptions: () => descriptions,
    })

  describe("semantic search", () => {
    it("finds tools by semantic similarity", async () => {
      const tool = createTool()
      const result = await tool.execute({ query: "search the internet for information" }, { sessionID: "s1" })
      const parsed = JSON.parse(result as string)

      expect(parsed.result).toBe("discovered")
      expect(parsed.semantic).toBe(true)
      expect(parsed.discovered_count).toBeGreaterThanOrEqual(1)
    })

    it("falls back to substring when no descriptions in registry", async () => {
      // Reset and create registry without descriptions
      _resetEmbedderSingleton()
      const noDescRegistry = new McpDeferredRegistry()
      // Don't set descriptions - embedder search returns empty, falls back to substring

      const tool = createDiscoverToolsTool({
        registry: noDescRegistry,
        getMcpToolIDs: () => mcpToolIDs,
        getToolDescriptions: () => descriptions,
      })
      const result = await tool.execute({ query: "context7" }, { sessionID: "s1" })
      const parsed = JSON.parse(result as string)

      // Should fall back to substring search
      expect(parsed.result).toBe("discovered")
      expect(parsed.semantic).toBe(false)
    })
  })

  describe("extractMcpToolDescriptions", () => {
    it("extracts descriptions from MCP tools only", () => {
      const tools = {
        bash: { description: "Run bash commands" },
        mcp__websearch__search: { description: "Search the web" },
        mcp__context7__resolve: { description: "Resolve docs" },
      }
      const result = extractMcpToolDescriptions(tools)
      expect(result.size).toBe(2)
      expect(result.get("mcp__websearch__search")).toBe("Search the web")
      expect(result.get("mcp__context7__resolve")).toBe("Resolve docs")
    })

    it("skips MCP tools without description", () => {
      const tools = {
        mcp__foo__bar: { description: "Has desc" },
        mcp__baz__qux: { noDescription: true },
      }
      const result = extractMcpToolDescriptions(tools)
      expect(result.size).toBe(1)
      expect(result.get("mcp__foo__bar")).toBe("Has desc")
    })
  })
})

describe("auto-discovery with local embeddings", () => {
  beforeEach(() => {
    _resetEmbedderSingleton()
  })

  it("auto-discovers relevant tools from first user message", async () => {
    const registry = new McpDeferredRegistry()
    registry.setAllMcpToolIDs(["mcp__websearch__search", "mcp__context7__resolve"])
    registry.setToolDescriptions(new Map([
      ["mcp__websearch__search", "Search the web for information"],
      ["mcp__context7__resolve", "Resolve library documentation queries"],
    ]))

    const embedder = getLocalToolEmbedder()
    injectMockPipeline(embedder)

    const hook = createMcpDeferredLoaderHook(registry)

    const output = {
      messages: [
        {
          info: { role: "user" as const },
          parts: [{ type: "text" as const, text: "Can you help me find information on the web about React hooks?" }],
        },
      ],
    }

    await hook["experimental.chat.messages.transform"]!({}, output)

    // The websearch tool should have been auto-discovered
    expect(registry.isDiscovered("mcp__websearch__search")).toBe(true)
  })

  it("injects deferred tools hint for undiscovered tools after auto-discovery", async () => {
    const registry = new McpDeferredRegistry()
    registry.setAllMcpToolIDs([
      "mcp__websearch__search",
      "mcp__terminal__exec",
      "mcp__filesystem__read",
    ])
    registry.setToolDescriptions(new Map([
      ["mcp__websearch__search", "Search the web"],
      ["mcp__terminal__exec", "Execute terminal commands"],
      ["mcp__filesystem__read", "Read files from disk"],
    ]))

    const embedder = getLocalToolEmbedder()
    injectMockPipeline(embedder)

    const hook = createMcpDeferredLoaderHook(registry)

    const output = {
      messages: [
        {
          info: { role: "user" as const },
          parts: [{ type: "text" as const, text: "Hello, help me search the web" }],
        },
      ],
    }

    await hook["experimental.chat.messages.transform"]!({}, output)

    const text = (output.messages[0].parts[0] as { text: string }).text
    // websearch was discovered (contains "search" and "web")
    // but filesystem__read and terminal__exec should still be undiscovered
    // The deferred hint should mention at least one of them
    expect(text).toContain("<available-deferred-tools>")
    expect(text).toContain("mcp__filesystem__read")
    expect(text).toContain("mcp__terminal__exec")
  })

  it("does not inject hint when all tools are discovered", async () => {
    const registry = new McpDeferredRegistry()
    registry.setAllMcpToolIDs(["mcp__websearch__search"])
    registry.setToolDescriptions(new Map([
      ["mcp__websearch__search", "Search the web"],
    ]))

    const embedder = getLocalToolEmbedder()
    injectMockPipeline(embedder)

    const hook = createMcpDeferredLoaderHook(registry)

    const output = {
      messages: [
        {
          info: { role: "user" as const },
          parts: [{ type: "text" as const, text: "search the web for me" }],
        },
      ],
    }

    await hook["experimental.chat.messages.transform"]!({}, output)

    const text = (output.messages[0].parts[0] as { text: string }).text
    // All tools were auto-discovered, no hint needed
    expect(text).not.toContain("<available-deferred-tools>")
  })
})

describe("registry description storage", () => {
  it("stores and retrieves tool descriptions", () => {
    const registry = new McpDeferredRegistry()
    const descs = new Map([
      ["mcp__foo__bar", "Does something"],
      ["mcp__baz__qux", "Does another thing"],
    ])
    registry.setToolDescriptions(descs)

    expect(registry.getToolDescription("mcp__foo__bar")).toBe("Does something")
    expect(registry.getToolDescription("mcp__baz__qux")).toBe("Does another thing")
    expect(registry.getToolDescription("mcp__nonexistent")).toBeUndefined()
  })

  it("getAllToolDescriptions returns a copy", () => {
    const registry = new McpDeferredRegistry()
    registry.setToolDescriptions(new Map([["a", "desc a"]]))

    const all = registry.getAllToolDescriptions()
    all.set("b", "desc b")

    // Original should not be modified
    expect(registry.getToolDescription("b")).toBeUndefined()
  })
})
