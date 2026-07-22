import { describe, it, expect, beforeEach } from "bun:test"
import { createDiscoverToolsTool, extractMcpToolIDs } from "./create-discover-tools"
import { McpDeferredRegistry } from "../../hooks/mcp-deferred-loader/registry"

describe("createDiscoverToolsTool", () => {
  let registry: McpDeferredRegistry
  let mcpToolIDs: string[]
  let descriptions: Map<string, string>

  beforeEach(() => {
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
  })

  const createTool = () =>
    createDiscoverToolsTool({
      registry,
      getMcpToolIDs: () => mcpToolIDs,
      getToolDescriptions: () => descriptions,
    })

  describe("#when searching by name substring", () => {
    it("finds matching tools and marks them discovered", async () => {
      const tool = createTool()
      const result = await tool.execute({ query: "context7" }, { sessionID: "session-1" })
      const parsed = JSON.parse(result as string)

      expect(parsed.result).toBe("discovered")
      expect(parsed.discovered_count).toBe(1)
      expect(parsed.tools[0].toolID).toBe("mcp__context7__resolve")
      expect(registry.isDiscovered("mcp__context7__resolve")).toBe(true)
    })
  })

  describe("#when searching by description keyword", () => {
    it("finds tools with matching descriptions", async () => {
      const tool = createTool()
      const result = await tool.execute({ query: "code patterns" }, { sessionID: "session-1" })
      const parsed = JSON.parse(result as string)

      expect(parsed.result).toBe("discovered")
      expect(parsed.discovered_count).toBe(1)
      expect(parsed.tools[0].toolID).toBe("mcp__grep_app__search")
    })
  })

  describe("#when search matches multiple tools", () => {
    it("discovers all matching non-always-loaded tools", async () => {
      const tool = createTool()
      const result = await tool.execute({ query: "search" }, { sessionID: "session-1" })
      const parsed = JSON.parse(result as string)

      expect(parsed.result).toBe("discovered")
      expect(parsed.discovered_count).toBe(1)
      expect(parsed.tools[0].toolID).toBe("mcp__grep_app__search")
      expect(registry.isDiscovered("mcp__grep_app__search")).toBe(true)
    })

    it("discovers multiple tools without always-load restriction", async () => {
      const noAlwaysLoadRegistry = new McpDeferredRegistry()
      const noAlwaysLoadTool = createDiscoverToolsTool({
        registry: noAlwaysLoadRegistry,
        getMcpToolIDs: () => mcpToolIDs,
        getToolDescriptions: () => descriptions,
      })
      const result = await noAlwaysLoadTool.execute({ query: "search" }, { sessionID: "session-1" })
      const parsed = JSON.parse(result as string)

      // "search" matches: websearch__search (name), websearch__fetch (name "search" in "websearch"),
      // grep_app__search (name + description)
      expect(parsed.result).toBe("discovered")
      expect(parsed.discovered_count).toBe(3)
      expect(noAlwaysLoadRegistry.isDiscovered("mcp__websearch__search")).toBe(true)
      expect(noAlwaysLoadRegistry.isDiscovered("mcp__grep_app__search")).toBe(true)
    })
  })

  describe("#when search has no matches", () => {
    it("returns no_matches with available tool list", async () => {
      const tool = createTool()
      const result = await tool.execute({ query: "nonexistent" }, { sessionID: "session-1" })
      const parsed = JSON.parse(result as string)

      expect(parsed.result).toBe("no_matches")
      expect(parsed.available_tools).toBeDefined()
      expect(parsed.available_tools).not.toContain("mcp__websearch__search")
    })
  })

  describe("#when query is empty", () => {
    it("returns an error", async () => {
      const tool = createTool()
      const result = await tool.execute({ query: "" }, { sessionID: "session-1" })
      const parsed = JSON.parse(result as string)

      expect(parsed.error).toBe("query is required")
    })
  })

  describe("#when always-loaded tools are matched", () => {
    it("excludes them from discovery results", async () => {
      const tool = createTool()
      const result = await tool.execute({ query: "websearch" }, { sessionID: "session-1" })
      const parsed = JSON.parse(result as string)

      expect(parsed.result).toBe("no_matches")
    })
  })

  describe("extractMcpToolIDs", () => {
    it("filters tools by mcp__ prefix", () => {
      const tools = {
        bash: {},
        read: {},
        mcp__websearch__search: {},
        mcp__context7__resolve: {},
      }
      expect(extractMcpToolIDs(tools)).toEqual(["mcp__websearch__search", "mcp__context7__resolve"])
    })
  })
})
