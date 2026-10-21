import { describe, expect, test } from "bun:test"
import {
  buildCatalog,
  callExpression,
  embeddingText,
  formatDiscoverResults,
  keywordFallback,
  type CatalogTool,
} from "./discover-catalog"

const baseTool = (overrides: Partial<CatalogTool> & { id: string }): CatalogTool => ({
  description: "",
  ...overrides,
})

describe("callExpression", () => {
  describe("#given a namespaced tool", () => {
    test("#then the call path uses namespace and short name", () => {
      // given
      const tool = baseTool({ id: "fusion360_execute_script", name: "execute_script", namespace: "fusion360" })

      // when / then
      expect(callExpression(tool)).toBe("tools.fusion360.execute_script")
    })
  })

  describe("#given a bare tool", () => {
    test("#then the call path uses the effective id", () => {
      // given
      const tool = baseTool({ id: "doc_store_query", name: "doc_store_query" })

      // when / then
      expect(callExpression(tool)).toBe("tools.doc_store_query")
    })
  })
})

describe("buildCatalog", () => {
  describe("#given raw tool list output", () => {
    test("#then excluded ids are dropped and namespace is mapped", () => {
      // given
      const raw = [
        { id: "discover_tools", name: "discover_tools", description: "self" },
        { id: "execute", name: "execute", description: "sandbox" },
        { id: "acme_greeting", name: "greeting", description: "Say hi", options: { namespace: "acme" } },
      ]

      // when
      const catalog = buildCatalog(raw, new Set(["discover_tools", "execute"]))

      // then
      expect(catalog).toHaveLength(1)
      expect(catalog[0]?.id).toBe("acme_greeting")
      expect(catalog[0]?.namespace).toBe("acme")
    })
  })
})

describe("embeddingText", () => {
  describe("#given a tool with parameter descriptions", () => {
    test("#then id, description and parameter hints are included", () => {
      // given
      const tool = baseTool({
        id: "doc_store_query",
        description: "Retrieve knowledge from a vault.",
        input: {
          type: "object",
          properties: {
            vault: { type: "string", description: "Vault name" },
            question: { type: "string", description: "Question to answer" },
          },
        },
      })

      // when
      const text = embeddingText(tool)

      // then
      expect(text).toContain("doc_store_query")
      expect(text).toContain("Retrieve knowledge from a vault.")
      expect(text).toContain("question: Question to answer")
    })
  })
})

describe("keywordFallback", () => {
  const tools = [
    baseTool({ id: "doc_store_query", description: "Retrieve knowledge items from a vault for a question." }),
    baseTool({ id: "edit", name: "edit", namespace: "opencode", description: "Edit a file." }),
    baseTool({ id: "glob", name: "glob", description: "Find files by pattern." }),
  ]

  describe("#given a query whose words appear in descriptions", () => {
    test("#then matching tools are ranked with scores", () => {
      // given / when
      const matches = keywordFallback("knowledge vault question", tools, 5)

      // then
      expect(matches[0]?.tool.id).toBe("doc_store_query")
      expect(matches[0]?.score).toBeGreaterThan(0)
    })
  })

  describe("#given short stopword-like tokens", () => {
    test("#then they do not produce matches on their own", () => {
      // given / when
      const matches = keywordFallback("a of to", tools, 5)

      // then
      expect(matches).toHaveLength(0)
    })
  })

  describe("#given a name hit versus a description hit", () => {
    test("#then the name hit scores higher", () => {
      // given
      const mixed = [
        baseTool({ id: "vault_export", description: "unrelated words" }),
        baseTool({ id: "other", description: "Export from a vault of knowledge." }),
      ]

      // when
      const matches = keywordFallback("vault export", mixed, 2)

      // then
      expect(matches[0]?.tool.id).toBe("vault_export")
    })
  })
})

describe("formatDiscoverResults", () => {
  describe("#given semantic matches", () => {
    test("#then output contains the call expression and semantic marker", () => {
      // given
      const matches = [
        { tool: baseTool({ id: "doc_store_query", description: "Retrieve knowledge items." }), score: 0.82 },
      ]

      // when
      const out = formatDiscoverResults("what do my notes say", matches, true)

      // then
      expect(out).toContain("semantic")
      expect(out).toContain("tools.doc_store_query")
      expect(out).toContain("[id: doc_store_query]")
    })
  })

  describe("#given no matches", () => {
    test("#then output suggests the built-in search", () => {
      // given / when
      const out = formatDiscoverResults("gibberish xyzzy", [], false)

      // then
      expect(out).toContain("keyword fallback")
      expect(out).toContain("search({ query })")
    })
  })
})
