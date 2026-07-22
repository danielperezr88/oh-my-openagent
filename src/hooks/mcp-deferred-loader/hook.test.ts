import { describe, it, expect } from "bun:test"
import { createMcpDeferredLoaderHook } from "./hook"
import { McpDeferredRegistry } from "./registry"
import { DEFAULT_STUB_DESCRIPTION } from "./constants"

describe("McpDeferredLoader hook", () => {
  describe("#given a tool.definition call for an undiscovered MCP tool", () => {
    const registry = new McpDeferredRegistry()
    const hook = createMcpDeferredLoaderHook(registry)
    const output = {
      description: "Search the web using Exa or Tavily. Supports full-text search, keyword search, and more.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "Search query" },
          provider: { type: "string", enum: ["exa", "tavily"] },
        },
      },
    }

    it("replaces description and parameters with stub", async () => {
      await hook["tool.definition"]!(
        { toolID: "mcp__websearch__search" },
        output,
      )
      expect(output.description).toBe(DEFAULT_STUB_DESCRIPTION)
      expect(output.parameters).toEqual({ type: "object", properties: {} })
    })

    it("records tool ID into registry for later discovery", async () => {
      const freshRegistry = new McpDeferredRegistry()
      const freshHook = createMcpDeferredLoaderHook(freshRegistry)
      const freshOutput = {
        description: "Search the web",
        parameters: { type: "object", properties: {} },
      }

      await freshHook["tool.definition"]!(
        { toolID: "mcp__astrolabe__search" },
        freshOutput,
      )
      expect(freshRegistry.getUndiscoveredTools()).toContain("mcp__astrolabe__search")
    })

    it("records tool description into registry", async () => {
      const freshRegistry = new McpDeferredRegistry()
      const freshHook = createMcpDeferredLoaderHook(freshRegistry)
      const freshOutput = {
        description: "Search astrolabe indices for code",
        parameters: { type: "object", properties: {} },
      }

      await freshHook["tool.definition"]!(
        { toolID: "mcp__astrolabe__search" },
        freshOutput,
      )
      expect(freshRegistry.getToolDescription("mcp__astrolabe__search")).toBe("Search astrolabe indices for code")
    })

    it("is idempotent when same tool.definition fires multiple times", async () => {
      const freshRegistry = new McpDeferredRegistry()
      const freshHook = createMcpDeferredLoaderHook(freshRegistry)
      const freshOutput = {
        description: "Search the web",
        parameters: { type: "object", properties: {} },
      }

      await freshHook["tool.definition"]!({ toolID: "mcp__astrolabe__search" }, freshOutput)
      await freshHook["tool.definition"]!({ toolID: "mcp__astrolabe__search" }, freshOutput)
      expect(freshRegistry.getUndiscoveredTools()).toEqual(["mcp__astrolabe__search"])
    })
  })

  describe("#given a tool.definition call for a non-MCP tool", () => {
    const registry = new McpDeferredRegistry()
    const hook = createMcpDeferredLoaderHook(registry)
    const output = {
      description: "Run a bash command",
      parameters: { type: "object", properties: { command: { type: "string" } } },
    }

    it("does not modify the tool definition", async () => {
      await hook["tool.definition"]!(
        { toolID: "bash" },
        output,
      )
      expect(output.description).toBe("Run a bash command")
      expect(output.parameters).toEqual({ type: "object", properties: { command: { type: "string" } } })
    })
  })

  describe("#given a tool.definition call for a discovered MCP tool", () => {
    const registry = new McpDeferredRegistry()
    registry.markDiscovered(["mcp__websearch__search"])
    const hook = createMcpDeferredLoaderHook(registry)
    const output = {
      description: "Search the web using Exa or Tavily.",
      parameters: { type: "object", properties: { query: { type: "string" } } },
    }

    it("keeps the full schema", async () => {
      await hook["tool.definition"]!(
        { toolID: "mcp__websearch__search" },
        output,
      )
      expect(output.description).toBe("Search the web using Exa or Tavily.")
      expect(output.parameters).toEqual({ type: "object", properties: { query: { type: "string" } } })
    })
  })

  describe("#given a tool.definition call for an always-loaded MCP tool", () => {
    const registry = new McpDeferredRegistry(["websearch"])
    const hook = createMcpDeferredLoaderHook(registry)
    const output = {
      description: "Search the web",
      parameters: { type: "object", properties: { query: { type: "string" } } },
    }

    it("keeps the full schema even if undiscovered", async () => {
      await hook["tool.definition"]!(
        { toolID: "mcp__websearch__search" },
        output,
      )
      expect(output.description).toBe("Search the web")
    })
  })

  describe("#given custom stub description", () => {
    const registry = new McpDeferredRegistry()
    const hook = createMcpDeferredLoaderHook(registry, { stubDescription: "Custom stub" })
    const output = { description: "Full description", parameters: {} }

    it("uses the custom stub description", async () => {
      await hook["tool.definition"]!(
        { toolID: "mcp__websearch__search" },
        output,
      )
      expect(output.description).toBe("Custom stub")
    })
  })

  describe("messages.transform", () => {
    it("injects deferred tools list into first user message", async () => {
      const registry = new McpDeferredRegistry()
      registry.setAllMcpToolIDs(["mcp__websearch__search", "mcp__context7__resolve"])
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
      expect(text).toContain("<available-deferred-tools>")
      expect(text).toContain("mcp__websearch__search")
      expect(text).toContain("mcp__context7__resolve")
      expect(text).toContain("discover_tools(query)")
      expect(text).toContain("Hello, help me search the web")
    })

    it("does not inject when all tools are discovered", async () => {
      const registry = new McpDeferredRegistry()
      registry.setAllMcpToolIDs(["mcp__websearch__search"])
      registry.markDiscovered(["mcp__websearch__search"])
      const hook = createMcpDeferredLoaderHook(registry)

      const output = {
        messages: [
          {
            info: { role: "user" as const },
            parts: [{ type: "text" as const, text: "Hello" }],
          },
        ],
      }

      await hook["experimental.chat.messages.transform"]!({}, output)

      const text = (output.messages[0].parts[0] as { text: string }).text
      expect(text).not.toContain("<available-deferred-tools>")
    })

    it("does not inject when no MCP tools are registered", async () => {
      const registry = new McpDeferredRegistry()
      const hook = createMcpDeferredLoaderHook(registry)

      const output = {
        messages: [
          {
            info: { role: "user" as const },
            parts: [{ type: "text" as const, text: "Hello" }],
          },
        ],
      }

      await hook["experimental.chat.messages.transform"]!({}, output)

      const text = (output.messages[0].parts[0] as { text: string }).text
      expect(text).not.toContain("<available-deferred-tools>")
    })

    it("excludes always-loaded tools from deferred list", async () => {
      const registry = new McpDeferredRegistry(["websearch"])
      registry.setAllMcpToolIDs(["mcp__websearch__search", "mcp__context7__resolve"])
      const hook = createMcpDeferredLoaderHook(registry)

      const output = {
        messages: [
          {
            info: { role: "user" as const },
            parts: [{ type: "text" as const, text: "Hello" }],
          },
        ],
      }

      await hook["experimental.chat.messages.transform"]!({}, output)

      const text = (output.messages[0].parts[0] as { text: string }).text
      expect(text).not.toContain("mcp__websearch__search")
      expect(text).toContain("mcp__context7__resolve")
    })
  })
})
