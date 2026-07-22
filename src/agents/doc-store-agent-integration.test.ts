import { describe, test, expect } from "bun:test"
import { createOracleAgent } from "./oracle"
import { createLibrarianAgent } from "./librarian"
import { createExploreAgent } from "./explore"
import { createMomusAgent } from "./momus"
import { createMetisAgent } from "./metis"
import { createAtlasAgent } from "./atlas"
import { createSisyphusJuniorAgentWithOverrides } from "./sisyphus-junior"
import { getPrometheusPrompt } from "./prometheus/system-prompt"
import { getHephaestusPrompt } from "./hephaestus/agent"
import { createDocStoreTools } from "../tools/doc-store/tools"
import { getAgentToolRestrictions } from "../shared/agent-tool-restrictions"
import { trimToolsToCap } from "../plugin/tool-registry"
import type { ToolsRecord } from "../plugin/types"
import { tool } from "@opencode-ai/plugin"

const DOC_STORE_TOOL_NAMES = Object.keys(createDocStoreTools())
const TEST_MODEL = "anthropic/claude-sonnet-4-5"

// ─── Tool Registry: doc-store tools are registered ───

describe("doc-store tools in tool registry", () => {
  const tools = createDocStoreTools()

  test("createDocStoreTools returns exactly 9 tools", () => {
    expect(DOC_STORE_TOOL_NAMES).toHaveLength(9)
  })

  for (const toolName of DOC_STORE_TOOL_NAMES) {
    test(`${toolName} is present in createDocStoreTools output`, () => {
      expect(tools).toHaveProperty(toolName)
    })
  }
})

// ─── Agent Restrictions: no agent denies doc-store tools ───

describe("agent tool restrictions do not deny doc-store tools", () => {
  const agentsWithRestrictions = [
    "explore",
    "librarian",
    "oracle",
    "metis",
    "momus",
    "sisyphus-junior",
  ]

  for (const agentName of agentsWithRestrictions) {
    describe(`${agentName}`, () => {
      const restrictions = getAgentToolRestrictions(agentName)

      for (const docStoreTool of DOC_STORE_TOOL_NAMES) {
        test(`${docStoreTool} is not denied`, () => {
          expect(restrictions[docStoreTool]).not.toBe(false)
        })
      }
    })
  }
})

// ─── Agent Prompts: every agent that imports doc-store sections includes them ───

describe("agent prompts include doc-store awareness", () => {
  // Agents using buildDocStoreAwarenessBrief
  const briefAgents: Array<{ name: string; createAgent: () => { prompt: string } }> = [
    {
      name: "Oracle (default)",
      createAgent: () => createOracleAgent(TEST_MODEL) as unknown as { prompt: string },
    },
    {
      name: "Oracle (GPT)",
      createAgent: () => createOracleAgent("openai/gpt-5-4") as unknown as { prompt: string },
    },
    {
      name: "Explore",
      createAgent: () => createExploreAgent(TEST_MODEL) as unknown as { prompt: string },
    },
    {
      name: "Momus",
      createAgent: () => createMomusAgent(TEST_MODEL) as unknown as { prompt: string },
    },
    {
      name: "Metis",
      createAgent: () => createMetisAgent(TEST_MODEL) as unknown as { prompt: string },
    },
  ]

  for (const { name, createAgent } of briefAgents) {
    describe(`${name}`, () => {
      const prompt = createAgent().prompt

      test("contains doc-store brief section delimiter", () => {
        expect(prompt).toContain("DOC-STORE INTEGRATION")
      })

      test("references doc_store_search", () => {
        expect(prompt).toContain("doc_store_search")
      })

      test("references doc_store_query", () => {
        expect(prompt).toContain("doc_store_query")
      })
    })
  }

  // Agent using buildDocStoreLibrarianExtension
  describe("Librarian", () => {
    const prompt = (createLibrarianAgent(TEST_MODEL) as unknown as { prompt: string }).prompt

    test("contains librarian-specific doc-store section", () => {
      expect(prompt).toContain("DOC-STORE INTEGRATION (librarian-specific)")
    })

    test("references all librarian doc-store tools", () => {
      const librarianTools = [
        "doc_store_status",
        "doc_store_search",
        "doc_store_query",
        "doc_store_ingest",
        "doc_store_consolidate_list",
        "doc_store_consolidate_prepare",
        "doc_store_consolidate_store",
      ]
      for (const toolName of librarianTools) {
        expect(prompt).toContain(toolName)
      }
    })

    test("marks integration as MANDATORY", () => {
      expect(prompt).toContain("MANDATORY")
    })
  })

  // Agent using buildDocStoreAwarenessWithActions
  describe("Atlas", () => {
    const prompt = (createAtlasAgent({ model: TEST_MODEL }) as unknown as { prompt: string }).prompt

    test("contains doc-store with-actions section", () => {
      expect(prompt).toContain("DOC-STORE INTEGRATION (with actions)")
    })

    test("references search and query tools for before-work", () => {
      expect(prompt).toContain("doc_store_search")
      expect(prompt).toContain("doc_store_query")
    })

    test("references ingest and consolidate for after-work", () => {
      expect(prompt).toContain("doc_store_ingest")
      expect(prompt).toContain("doc_store_consolidate_prepare")
    })
  })

  // Sisyphus-Junior uses buildDocStoreAwarenessWithActions
  describe("Sisyphus-Junior", () => {
    const prompt = (createSisyphusJuniorAgentWithOverrides(
      { model: TEST_MODEL },
      undefined,
    ) as unknown as { prompt: string }).prompt

    test("contains doc-store with-actions section", () => {
      expect(prompt).toContain("DOC-STORE INTEGRATION (with actions)")
    })
  })

  // Prometheus uses buildDocStoreAwarenessBrief via system-prompt.ts
  describe("Prometheus (default)", () => {
    const prompt = getPrometheusPrompt(TEST_MODEL)

    test("contains doc-store brief section", () => {
      expect(prompt).toContain("DOC-STORE INTEGRATION")
    })
  })

  describe("Prometheus (GPT)", () => {
    const prompt = getPrometheusPrompt("openai/gpt-5-4")

    test("contains doc-store brief section", () => {
      expect(prompt).toContain("DOC-STORE INTEGRATION")
    })
  })

  describe("Prometheus (Gemini)", () => {
    const prompt = getPrometheusPrompt("google/gemini-2.5-pro")

    test("contains doc-store brief section", () => {
      expect(prompt).toContain("DOC-STORE INTEGRATION")
    })
  })

  // Hephaestus uses buildDocStoreSection in all sub-prompts
  describe("Hephaestus", () => {
    test("all prompt sources include doc-store section", () => {
      const sources: Record<string, string> = {
        gpt: "openai/gpt-5",
        "gpt-5-4": "openai/gpt-5-4",
        "gpt-5-3-codex": "openai/gpt-5-3-codex",
      }

      for (const [source, model] of Object.entries(sources)) {
        const prompt = getHephaestusPrompt(model)
        expect(prompt).toContain("DOC-STORE INTEGRATION")
        expect(prompt).toContain("doc_store_search")
      }
    })
  })
})

// ─── Tool Trimming: doc-store tools survive reasonable caps ───

describe("doc-store tools vs max_tools trimming", () => {
  const fakeTool = tool({
    description: "fake",
    args: {},
    async execute() {
      return "ok"
    },
  })

  test("doc-store tools are trimmed after LOW_PRIORITY tools but before core tools", () => {
    const tools: ToolsRecord = {}
    // Core tools that are NOT in LOW_PRIORITY_TOOL_ORDER (these survive longest)
    tools["bash"] = fakeTool
    tools["read"] = fakeTool
    tools["write"] = fakeTool
    // LOW_PRIORITY tools (trimmed first)
    tools["edit"] = fakeTool
    tools["glob"] = fakeTool
    tools["grep"] = fakeTool
    tools["skill"] = fakeTool
    tools["task"] = fakeTool
    tools["look_at"] = fakeTool
    tools["interactive_bash"] = fakeTool
    // Doc-store tools (unlisted — trimmed after low-priority but sorted alphabetically)
    const docStoreTools = createDocStoreTools()
    for (const [name, def] of Object.entries(docStoreTools)) {
      tools[name] = def
    }

    // Total: 3 core + 7 low-priority + 9 doc-store = 19 tools
    // Cap at 13: removes 6 tools (low-priority first),
    // doc-store tools survive because low-priority absorbs the trimming.
    trimToolsToCap(tools, 13)

    // Core tools survive
    expect(tools).toHaveProperty("bash")
    expect(tools).toHaveProperty("read")
    // Doc-store tools survive (only low-priority was trimmed)
    for (const name of DOC_STORE_TOOL_NAMES) {
      expect(tools).toHaveProperty(name)
    }
  })

  test("doc-store tools are trimmed only after low-priority tools are exhausted", () => {
    const tools: ToolsRecord = {}
    // Add 20 low-priority listed tools
    for (const lp of ["edit", "glob", "grep", "skill", "task", "look_at", "interactive_bash",
      "session_list", "session_read", "session_search", "session_info",
      "call_omo_agent", "task_create", "task_get", "task_list", "task_update",
      "background_output", "background_cancel", "ast_grep_replace", "ast_grep_search"]) {
      tools[lp] = fakeTool
    }
    // Add doc-store tools
    const docStoreTools = createDocStoreTools()
    for (const [name, def] of Object.entries(docStoreTools)) {
      tools[name] = def
    }

    // Total: 20 low-priority + 9 doc-store = 29 tools
    // Cap at 15: need to remove 14. All 14 come from low-priority first.
    trimToolsToCap(tools, 15)

    // All doc-store tools survive because low-priority tools absorb the trimming
    for (const name of DOC_STORE_TOOL_NAMES) {
      expect(tools).toHaveProperty(name)
    }
  })
})

// ─── Cross-check: tool names in prompts match registered tool names ───

describe("tool names in doc-store sections match registered tools", () => {
  const { buildDocStoreSection, buildDocStoreLibrarianExtension, buildDocStoreAwarenessBrief, buildDocStoreAwarenessWithActions } = require("./dynamic-agent-doc-store-section")

  const allSections = [
    { name: "buildDocStoreSection", content: buildDocStoreSection() },
    { name: "buildDocStoreLibrarianExtension", content: buildDocStoreLibrarianExtension() },
    { name: "buildDocStoreAwarenessBrief", content: buildDocStoreAwarenessBrief() },
    { name: "buildDocStoreAwarenessWithActions", content: buildDocStoreAwarenessWithActions() },
  ]

  for (const section of allSections) {
    // Extract backtick-wrapped tool references from the section
    const referencedTools = [...section.content.matchAll(/`([^`]+)`/g)]
      .map((m: RegExpMatchArray) => m[1])
      .filter((name: string) => name.startsWith("doc_store_"))

    for (const toolName of referencedTools) {
      test(`${toolName} referenced in ${section.name} exists in createDocStoreTools`, () => {
        expect(DOC_STORE_TOOL_NAMES).toContain(toolName)
      })
    }
  }
})
