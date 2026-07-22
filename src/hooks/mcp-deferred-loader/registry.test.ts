import { describe, it, expect } from "bun:test"
import { McpDeferredRegistry } from "./registry"

describe("McpDeferredRegistry", () => {
  describe("#given a fresh registry", () => {
    const registry = new McpDeferredRegistry()

    it("identifies MCP tools by prefix", () => {
      expect(registry.isMcpTool("mcp__websearch__search")).toBe(true)
      expect(registry.isMcpTool("mcp__context7__resolve")).toBe(true)
      expect(registry.isMcpTool("bash")).toBe(false)
      expect(registry.isMcpTool("read")).toBe(false)
    })

    it("extracts server name from tool ID", () => {
      expect(registry.getServerName("mcp__websearch__search")).toBe("websearch")
      expect(registry.getServerName("mcp__grep_app__search")).toBe("grep_app")
      expect(registry.getServerName("bash")).toBeUndefined()
      expect(registry.getServerName("mcp__onlyone")).toBeUndefined()
    })

    it("reports undiscovered MCP tools as not discovered", () => {
      expect(registry.isDiscovered("mcp__websearch__search")).toBe(false)
    })

    it("returns empty undiscovered list when no tools registered", () => {
      expect(registry.getUndiscoveredTools()).toEqual([])
    })
  })

  describe("#given a registry with always-load servers", () => {
    const registry = new McpDeferredRegistry(["websearch"])

    it("marks tools from always-load servers as always loaded", () => {
      expect(registry.isAlwaysLoaded("mcp__websearch__search")).toBe(true)
      expect(registry.isAlwaysLoaded("mcp__websearch__fetch")).toBe(true)
      expect(registry.isAlwaysLoaded("mcp__context7__resolve")).toBe(false)
    })

    it("excludes always-loaded tools from undiscovered list", () => {
      registry.setAllMcpToolIDs(["mcp__websearch__search", "mcp__context7__resolve", "mcp__grep_app__search"])
      const undiscovered = registry.getUndiscoveredTools()
      expect(undiscovered).toEqual(["mcp__context7__resolve", "mcp__grep_app__search"])
    })
  })

  describe("#when marking tools as discovered", () => {
    const registry = new McpDeferredRegistry()
    registry.setAllMcpToolIDs(["mcp__websearch__search", "mcp__context7__resolve", "mcp__grep_app__search"])

    it("tracks discovered tools globally", () => {
      registry.markDiscovered(["mcp__websearch__search"])
      expect(registry.isDiscovered("mcp__websearch__search")).toBe(true)
      expect(registry.isDiscovered("mcp__context7__resolve")).toBe(false)
    })

    it("can mark multiple tools at once", () => {
      registry.markDiscovered(["mcp__context7__resolve", "mcp__grep_app__search"])
      expect(registry.isDiscovered("mcp__context7__resolve")).toBe(true)
      expect(registry.isDiscovered("mcp__grep_app__search")).toBe(true)
    })

    it("returns empty undiscovered list after all discovered", () => {
      expect(registry.getUndiscoveredTools()).toEqual([])
    })
  })

  describe("#when recording tool IDs dynamically", () => {
    const registry = new McpDeferredRegistry()

    it("adds new tool ID to internal list", () => {
      registry.recordToolID("mcp__astrolabe__search")
      expect(registry.getUndiscoveredTools()).toEqual(["mcp__astrolabe__search"])
    })

    it("is idempotent — ignores duplicate tool IDs", () => {
      registry.recordToolID("mcp__astrolabe__search")
      registry.recordToolID("mcp__astrolabe__search")
      expect(registry.getUndiscoveredTools()).toEqual(["mcp__astrolabe__search"])
    })

    it("accumulates multiple tool IDs", () => {
      registry.recordToolID("mcp__astrolabe__search")
      registry.recordToolID("mcp__codegraph__resolve")
      expect(registry.getUndiscoveredTools()).toContain("mcp__astrolabe__search")
      expect(registry.getUndiscoveredTools()).toContain("mcp__codegraph__resolve")
    })
  })

  describe("#when recording tool descriptions dynamically", () => {
    const registry = new McpDeferredRegistry()

    it("stores description for a tool ID", () => {
      registry.recordToolDescription("mcp__astrolabe__search", "Search astrolabe indices")
      expect(registry.getToolDescription("mcp__astrolabe__search")).toBe("Search astrolabe indices")
    })

    it("overwrites previous description for same tool ID", () => {
      registry.recordToolDescription("mcp__astrolabe__search", "First")
      registry.recordToolDescription("mcp__astrolabe__search", "Second")
      expect(registry.getToolDescription("mcp__astrolabe__search")).toBe("Second")
    })

    it("stores multiple tool descriptions", () => {
      const freshRegistry = new McpDeferredRegistry()
      freshRegistry.recordToolDescription("mcp__a__t1", "Desc A")
      freshRegistry.recordToolDescription("mcp__b__t2", "Desc B")
      expect(freshRegistry.getAllToolDescriptions().size).toBe(2)
    })
  })

  describe("#when clearing the registry", () => {
    it("removes all discovered tools", () => {
      const registry = new McpDeferredRegistry()
      registry.markDiscovered(["mcp__websearch__search"])
      registry.markDiscovered(["mcp__context7__resolve"])

      registry.clear()
      expect(registry.isDiscovered("mcp__websearch__search")).toBe(false)
      expect(registry.isDiscovered("mcp__context7__resolve")).toBe(false)
    })
  })
})
