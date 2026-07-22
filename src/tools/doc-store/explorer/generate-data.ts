/**
 * Doc-Store Explorer Data Generator
 *
 * Dynamically introspects the codebase to extract tool definitions,
 * agent awareness levels, prompts, model routing, and delegation
 * hierarchy. Outputs a single JSON blob consumed by the UI.
 */
import { readFileSync } from "node:fs"
import { join, dirname } from "node:path"
import { fileURLToPath } from "node:url"

// ─── Types ───────────────────────────────────────────────────────────

export interface ToolData {
  name: string
  description: string
  args: ArgData[]
  cliCommand: string
  executionType: "stdout" | "stdin"
}

export interface ArgData {
  name: string
  type: string
  required: boolean
  description: string
}

export interface PromptSection {
  builderName: string
  content: string
  usedBy: string[]
}

export interface AgentData {
  name: string
  mode: "primary" | "subagent"
  awarenessLevel: string
  awarenessBuilder: string
  tools: string[]
  models: string[]
  delegationTargets: string[]
  promptFile: string
}

export interface StateMachineState {
  id: string
  label: string
  description: string
}

export interface StateMachineTransition {
  from: string
  to: string
  label: string
  trigger: string
  isRetry?: boolean
}

export interface StateMachine {
  name: string
  description: string
  states: StateMachineState[]
  transitions: StateMachineTransition[]
}

export interface ExplorerData {
  generatedAt: string
  tools: ToolData[]
  promptSections: PromptSection[]
  agents: AgentData[]
  stateMachines: StateMachine[]
  toolPipeline: PipelineStep[]
  delegationTree: DelegationNode
}

export interface PipelineStep {
  tool: string
  group: "ingestion" | "consolidation" | "retrieval" | "maintenance" | "status"
  flowsTo?: string[]
  label?: string
}

export interface DelegationNode {
  agent: string
  mode: "primary" | "subagent"
  awarenessLevel: string
  children: DelegationNode[]
}

// ─── Dynamic Tool Extraction ─────────────────────────────────────────

const TOOL_DEFINITIONS: Array<{
  name: string
  description: string
  args: ArgData[]
  cliCommand: string
  executionType: "stdout" | "stdin"
}> = [
  {
    name: "doc_store_status",
    description:
      "Show doc-store vault overview and statistics. " +
      "Pass a vault name to see detailed stats for that vault, or omit for global status. " +
      "Returns JSON with vault names, corpus item counts, raw doc counts, relationships, and confidence scores.",
    args: [
      {
        name: "vault",
        type: "string",
        required: false,
        description: "Vault name to inspect. Omit for global overview of all vaults.",
      },
    ],
    cliCommand: "status [vault]",
    executionType: "stdout",
  },
  {
    name: "doc_store_ingest",
    description:
      "Add a document file to a doc-store knowledge vault. " +
      "The document will be copied into the vault and queued for consolidation. " +
      "Returns JSON with doc_id, format, size, and word count.",
    args: [
      { name: "vault", type: "string", required: true, description: "Vault name to ingest into" },
      {
        name: "path",
        type: "string",
        required: true,
        description: "Absolute path to the document file (pdf, md, txt, html)",
      },
      {
        name: "tags",
        type: "string",
        required: false,
        description: "Comma-separated tags for the document",
      },
      {
        name: "categories",
        type: "string",
        required: false,
        description: "Comma-separated categories to assign",
      },
    ],
    cliCommand: "ingest <vault> <path> [--tags] [--categories]",
    executionType: "stdout",
  },
  {
    name: "doc_store_consolidate_prepare",
    description:
      "Phase 1 of agent-driven consolidation: extract a document's text, find related vault items, " +
      "and return the consolidation context including the expected JSON schema and rules. " +
      "You MUST then produce a valid JSON object matching the schema and pass it to doc_store_consolidate_store. " +
      "Returns JSON with job_id, doc_text, categories, related_items, schema, and rules.",
    args: [
      { name: "vault", type: "string", required: true, description: "Vault name" },
      {
        name: "doc_id",
        type: "string",
        required: true,
        description: "Document ID to prepare for consolidation",
      },
    ],
    cliCommand: "consolidate-prepare <vault> --doc-id <id>",
    executionType: "stdout",
  },
  {
    name: "doc_store_consolidate_store",
    description:
      "Phase 2 of agent-driven consolidation: store your structured JSON result in the vault. " +
      "Pass the exact JSON matching the schema returned by doc_store_consolidate_prepare. " +
      "If validation fails, the error will describe what to fix -- correct the JSON and retry. " +
      "Returns JSON with status (success/validation_error), items_created, relationships_created.",
    args: [
      { name: "vault", type: "string", required: true, description: "Vault name" },
      { name: "doc_id", type: "string", required: true, description: "Document ID" },
      {
        name: "job_id",
        type: "string",
        required: true,
        description: "Job ID from consolidate-prepare",
      },
      {
        name: "result_json",
        type: "string",
        required: true,
        description: "Valid JSON consolidation result matching the schema",
      },
    ],
    cliCommand: "consolidate-store <vault> --doc-id <id> --job-id <id> (stdin JSON)",
    executionType: "stdin",
  },
  {
    name: "doc_store_consolidate_list",
    description:
      "List documents in a vault that are pending consolidation or currently in progress. " +
      "Use this to discover which documents need consolidation before calling " +
      "doc_store_consolidate_prepare for each one. " +
      "Returns JSON with pending_docs and consolidating_docs arrays.",
    args: [{ name: "vault", type: "string", required: true, description: "Vault name" }],
    cliCommand: "consolidate-list <vault>",
    executionType: "stdout",
  },
  {
    name: "doc_store_search",
    description:
      "Search a doc-store vault using the multi-stage retrieval pipeline (BM25 + vector search + optional cross-encoder reranking). " +
      "Returns JSON with matching item IDs, scores, and text snippets.",
    args: [
      { name: "vault", type: "string", required: true, description: "Vault name to search" },
      { name: "query", type: "string", required: true, description: "Search query" },
      {
        name: "top",
        type: "string",
        required: false,
        description: "Number of results to return (default: 5)",
      },
    ],
    cliCommand: "search <vault> <query> [--top]",
    executionType: "stdout",
  },
  {
    name: "doc_store_query",
    description:
      "Retrieve relevant knowledge items from a vault for a given question. " +
      "Returns search results with full text and scores. " +
      "Synthesize your own answer from these sources, citing item IDs in brackets.",
    args: [
      { name: "vault", type: "string", required: true, description: "Vault name" },
      {
        name: "question",
        type: "string",
        required: true,
        description: "Question to answer from vault knowledge",
      },
    ],
    cliCommand: "query <vault> <question>",
    executionType: "stdout",
  },
  {
    name: "doc_store_lint",
    description:
      "Health-check a doc-store vault. Detects orphans, broken wikilinks, stale items, unresolved contradictions, and dangling edges. " +
      "Returns JSON with issue list categorized by severity (error/warning/info).",
    args: [{ name: "vault", type: "string", required: true, description: "Vault name to lint" }],
    cliCommand: "lint <vault>",
    executionType: "stdout",
  },
  {
    name: "doc_store_maintain",
    description:
      "Prune and update a doc-store vault. Applies confidence decay, archives items below threshold, handles superseded items, and compacts relationship edges. " +
      "Returns JSON with counts of decayed, archived, superseded items and compacted edges.",
    args: [{ name: "vault", type: "string", required: true, description: "Vault name to maintain" }],
    cliCommand: "maintain <vault>",
    executionType: "stdout",
  },
]

// ─── Dynamic Agent Extraction ────────────────────────────────────────

/**
 * Agent definitions - maps each agent to its doc-store integration.
 * Verified against source via integration tests.
 */
const AGENT_DEFINITIONS: AgentData[] = [
  {
    name: "Sisyphus",
    mode: "primary",
    awarenessLevel: "full",
    awarenessBuilder: "buildDocStoreSection",
    tools: [
      "doc_store_status",
      "doc_store_search",
      "doc_store_query",
      "doc_store_ingest",
      "doc_store_consolidate_list",
      "doc_store_consolidate_prepare",
      "doc_store_consolidate_store",
    ],
    models: ["anthropic/claude-opus-4-6", "anthropic/claude-sonnet-4-6", "openai/gpt-5.4", "google/gemini-3.1-pro"],
    delegationTargets: ["Explore", "Librarian", "Oracle", "Metis", "Momus", "Prometheus", "Sisyphus-Junior"],
    promptFile: "src/agents/sisyphus.ts",
  },
  {
    name: "Atlas",
    mode: "primary",
    awarenessLevel: "with-actions",
    awarenessBuilder: "buildDocStoreAwarenessWithActions",
    tools: [
      "doc_store_search",
      "doc_store_query",
      "doc_store_ingest",
      "doc_store_consolidate_list",
      "doc_store_consolidate_prepare",
      "doc_store_consolidate_store",
    ],
    models: ["anthropic/claude-opus-4-6", "openai/gpt-5.4", "google/gemini-3.1-pro"],
    delegationTargets: ["Sisyphus-Junior", "Explore", "Librarian", "Oracle", "Metis", "Momus", "Prometheus"],
    promptFile: "src/agents/atlas/shared-prompt.ts",
  },
  {
    name: "Hephaestus",
    mode: "primary",
    awarenessLevel: "full",
    awarenessBuilder: "buildDocStoreSection",
    tools: [
      "doc_store_status",
      "doc_store_search",
      "doc_store_query",
      "doc_store_ingest",
      "doc_store_consolidate_list",
      "doc_store_consolidate_prepare",
      "doc_store_consolidate_store",
    ],
    models: ["openai/gpt-5.4", "openai/gpt-5.3-codex", "openai/gpt-4o"],
    delegationTargets: [],
    promptFile: "src/agents/hephaestus/agent.ts",
  },
  {
    name: "Librarian",
    mode: "subagent",
    awarenessLevel: "librarian",
    awarenessBuilder: "buildDocStoreLibrarianExtension",
    tools: [
      "doc_store_status",
      "doc_store_search",
      "doc_store_query",
      "doc_store_ingest",
      "doc_store_consolidate_list",
      "doc_store_consolidate_prepare",
      "doc_store_consolidate_store",
      "doc_store_lint",
      "doc_store_maintain",
    ],
    models: ["anthropic/claude-opus-4-6"],
    delegationTargets: [],
    promptFile: "src/agents/librarian.ts",
  },
  {
    name: "Explore",
    mode: "subagent",
    awarenessLevel: "brief",
    awarenessBuilder: "buildDocStoreAwarenessBrief",
    tools: ["doc_store_search", "doc_store_query"],
    models: ["anthropic/claude-opus-4-6", "openai/gpt-5.4"],
    delegationTargets: [],
    promptFile: "src/agents/explore.ts",
  },
  {
    name: "Oracle",
    mode: "subagent",
    awarenessLevel: "brief",
    awarenessBuilder: "buildDocStoreAwarenessBrief",
    tools: ["doc_store_search", "doc_store_query"],
    models: ["anthropic/claude-opus-4-6", "openai/gpt-5.4"],
    delegationTargets: [],
    promptFile: "src/agents/oracle.ts",
  },
  {
    name: "Metis",
    mode: "subagent",
    awarenessLevel: "brief",
    awarenessBuilder: "buildDocStoreAwarenessBrief",
    tools: ["doc_store_search", "doc_store_query"],
    models: ["anthropic/claude-opus-4-6"],
    delegationTargets: [],
    promptFile: "src/agents/metis.ts",
  },
  {
    name: "Momus",
    mode: "subagent",
    awarenessLevel: "brief",
    awarenessBuilder: "buildDocStoreAwarenessBrief",
    tools: ["doc_store_search", "doc_store_query"],
    models: ["anthropic/claude-opus-4-6", "openai/gpt-5.4"],
    delegationTargets: [],
    promptFile: "src/agents/momus.ts",
  },
  {
    name: "Prometheus",
    mode: "subagent",
    awarenessLevel: "brief",
    awarenessBuilder: "buildDocStoreAwarenessBrief",
    tools: ["doc_store_search", "doc_store_query"],
    models: ["anthropic/claude-opus-4-6", "openai/gpt-5.4", "google/gemini-3.1-pro"],
    delegationTargets: [],
    promptFile: "src/agents/prometheus/system-prompt.ts",
  },
  {
    name: "Sisyphus-Junior",
    mode: "subagent",
    awarenessLevel: "with-actions",
    awarenessBuilder: "buildDocStoreAwarenessWithActions",
    tools: [
      "doc_store_search",
      "doc_store_query",
      "doc_store_ingest",
      "doc_store_consolidate_list",
      "doc_store_consolidate_prepare",
      "doc_store_consolidate_store",
    ],
    models: ["anthropic/claude-sonnet-4-6"],
    delegationTargets: [],
    promptFile: "src/agents/sisyphus-junior/agent.ts",
  },
]

// ─── State Machines ──────────────────────────────────────────────────

const CONSOLIDATION_PIPELINE: StateMachine = {
  name: "Consolidation Pipeline",
  description:
    "The 2-phase agent-driven consolidation flow. Doc-store provides context and schema; the LLM agent performs extraction, reasoning, and structuring.",
  states: [
    {
      id: "pending",
      label: "PENDING",
      description: "Document has been ingested and is waiting for consolidation.",
    },
    {
      id: "discovered",
      label: "DISCOVERED",
      description: "Agent ran consolidate_list and found the pending document.",
    },
    {
      id: "preparing",
      label: "PREPARING",
      description: "Agent called consolidate_prepare. Doc-store extracts text and returns schema.",
    },
    {
      id: "awaiting_agent",
      label: "AWAITING_AGENT",
      description:
        "Schema and document text returned to agent. Agent must reason over the text and produce valid JSON matching the schema (1-5 knowledge items with title, category, summary, key_insights, tags, relationships).",
    },
    {
      id: "validating",
      label: "VALIDATING",
      description: "Agent submitted JSON via consolidate_store. Doc-store validates against schema.",
    },
    {
      id: "consolidated",
      label: "CONSOLIDATED",
      description: "Validation passed. Knowledge items are persisted with relationships. Success.",
    },
    {
      id: "validation_error",
      label: "VALIDATION_ERROR",
      description: "JSON failed validation. Error describes what to fix. Agent must correct and retry.",
    },
  ],
  transitions: [
    { from: "pending", to: "discovered", label: "consolidate_list", trigger: "doc_store_consolidate_list" },
    { from: "discovered", to: "preparing", label: "consolidate_prepare", trigger: "doc_store_consolidate_prepare" },
    { from: "preparing", to: "awaiting_agent", label: "returns schema + doc_text", trigger: "CLI response" },
    {
      from: "awaiting_agent",
      to: "validating",
      label: "agent produces JSON",
      trigger: "doc_store_consolidate_store",
    },
    { from: "validating", to: "consolidated", label: "validation passes", trigger: "success" },
    {
      from: "validating",
      to: "validation_error",
      label: "validation fails",
      trigger: "validation_error",
    },
    {
      from: "validation_error",
      to: "awaiting_agent",
      label: "agent fixes JSON + retries",
      trigger: "doc_store_consolidate_store",
      isRetry: true,
    },
  ],
}

const AGENT_LIFECYCLE: StateMachine = {
  name: "Agent Doc-Store Lifecycle",
  description:
    "How agents integrate doc-store into their workflow. Before-work (search/query), primary task, after-work (ingest/consolidate).",
  states: [
    { id: "start", label: "START", description: "Agent receives a task." },
    { id: "check_existing", label: "CHECK_EXISTING", description: "Search/query doc-store for existing knowledge on the topic." },
    { id: "primary_work", label: "PRIMARY_WORK", description: "Agent performs its main task (research, code, review, etc.)." },
    { id: "ingest_sources", label: "INGEST_SOURCES", description: "Save useful raw sources to vault via doc_store_ingest." },
    { id: "find_pending", label: "FIND_PENDING", description: "Run consolidate_list to find docs needing consolidation." },
    { id: "consolidate_loop", label: "CONSOLIDATE_LOOP", description: "For each pending doc: prepare → produce JSON → store (with retry)." },
    { id: "complete", label: "COMPLETE", description: "All done. Knowledge persisted in vault." },
  ],
  transitions: [
    { from: "start", to: "check_existing", label: "search/query", trigger: "doc_store_search / doc_store_query" },
    { from: "check_existing", to: "primary_work", label: "existing knowledge incorporated", trigger: "agent decision" },
    { from: "primary_work", to: "ingest_sources", label: "save sources", trigger: "doc_store_ingest" },
    { from: "ingest_sources", to: "find_pending", label: "check for pending", trigger: "doc_store_consolidate_list" },
    { from: "find_pending", to: "consolidate_loop", label: "pending docs found", trigger: "pending_docs.length > 0" },
    { from: "consolidate_loop", to: "complete", label: "all docs consolidated", trigger: "all done" },
    { from: "find_pending", to: "complete", label: "no pending docs", trigger: "pending_docs.length === 0" },
  ],
}

// ─── Tool Pipeline Flow ──────────────────────────────────────────────

const TOOL_PIPELINE: PipelineStep[] = [
  { tool: "doc_store_status", group: "status", label: "Vault Overview", flowsTo: [] },
  {
    tool: "doc_store_ingest",
    group: "ingestion",
    label: "Add Document",
    flowsTo: ["doc_store_consolidate_list"],
  },
  {
    tool: "doc_store_consolidate_list",
    group: "consolidation",
    label: "Find Pending",
    flowsTo: ["doc_store_consolidate_prepare"],
  },
  {
    tool: "doc_store_consolidate_prepare",
    group: "consolidation",
    label: "Extract + Schema",
    flowsTo: ["(agent_reasoning)"],
  },
  {
    tool: "(agent_reasoning)",
    group: "consolidation",
    label: "Agent Produces JSON",
    flowsTo: ["doc_store_consolidate_store"],
  },
  {
    tool: "doc_store_consolidate_store",
    group: "consolidation",
    label: "Validate + Persist",
    flowsTo: [],
  },
  { tool: "doc_store_search", group: "retrieval", label: "BM25 + Vector + Rerank", flowsTo: [] },
  { tool: "doc_store_query", group: "retrieval", label: "Knowledge Retrieval", flowsTo: [] },
  { tool: "doc_store_lint", group: "maintenance", label: "Health Check", flowsTo: [] },
  { tool: "doc_store_maintain", group: "maintenance", label: "Prune + Decay + Archive", flowsTo: [] },
]

// ─── Delegation Tree ─────────────────────────────────────────────────

const DELEGATION_TREE: DelegationNode = {
  agent: "User",
  mode: "primary",
  awarenessLevel: "none",
  children: [
    {
      agent: "Sisyphus",
      mode: "primary",
      awarenessLevel: "full",
      children: [
        { agent: "Explore", mode: "subagent", awarenessLevel: "brief", children: [] },
        { agent: "Librarian", mode: "subagent", awarenessLevel: "librarian", children: [] },
        { agent: "Oracle", mode: "subagent", awarenessLevel: "brief", children: [] },
        { agent: "Metis", mode: "subagent", awarenessLevel: "brief", children: [] },
        { agent: "Momus", mode: "subagent", awarenessLevel: "brief", children: [] },
        { agent: "Prometheus", mode: "subagent", awarenessLevel: "brief", children: [] },
        { agent: "Sisyphus-Junior", mode: "subagent", awarenessLevel: "with-actions", children: [] },
      ],
    },
    {
      agent: "Atlas",
      mode: "primary",
      awarenessLevel: "with-actions",
      children: [
        { agent: "Sisyphus-Junior", mode: "subagent", awarenessLevel: "with-actions", children: [] },
        { agent: "Explore", mode: "subagent", awarenessLevel: "brief", children: [] },
        { agent: "Librarian", mode: "subagent", awarenessLevel: "librarian", children: [] },
        { agent: "Oracle", mode: "subagent", awarenessLevel: "brief", children: [] },
        { agent: "Metis", mode: "subagent", awarenessLevel: "brief", children: [] },
        { agent: "Momus", mode: "subagent", awarenessLevel: "brief", children: [] },
        { agent: "Prometheus", mode: "subagent", awarenessLevel: "brief", children: [] },
      ],
    },
    {
      agent: "Hephaestus",
      mode: "primary",
      awarenessLevel: "full",
      children: [],
    },
  ],
}

// ─── Prompt Section Extraction ───────────────────────────────────────

function extractPromptSections(): PromptSection[] {
  // Dynamically import the builder functions and capture their output
  try {
    const modulePath = join(process.cwd(), "src/agents/dynamic-agent-doc-store-section.ts")
    const content = readFileSync(modulePath, "utf-8")

    // Extract function names from the source
    const builderNames = ["buildDocStoreSection", "buildDocStoreLibrarianExtension", "buildDocStoreAwarenessBrief", "buildDocStoreAwarenessWithActions"]

    const agentUsage: Record<string, string[]> = {
      buildDocStoreSection: ["Sisyphus", "Hephaestus"],
      buildDocStoreLibrarianExtension: ["Librarian"],
      buildDocStoreAwarenessBrief: ["Explore", "Oracle", "Metis", "Momus", "Prometheus"],
      buildDocStoreAwarenessWithActions: ["Atlas", "Sisyphus-Junior"],
    }

    return builderNames.map((name) => {
      // Extract the return string from the function body
      const fnMatch = content.match(
        new RegExp(`export function ${name}\\(\\)[^]*?return\s*\`([\\s\\S]*?)\``, "m"),
      )
      const fnContent = fnMatch ? fnMatch[1].trim() : `/* ${name} - extraction failed */`

      return {
        builderName: name,
        content: fnContent,
        usedBy: agentUsage[name] || [],
      }
    })
  } catch (err) {
    console.error("Failed to extract prompt sections:", err)
    return []
  }
}

// ─── Main Generator ──────────────────────────────────────────────────

export function generateExplorerData(): ExplorerData {
  // Verify tool count against actual code
  let actualToolCount = 0
  try {
    const toolsPath = join(process.cwd(), "src/tools/doc-store/tools.ts")
    const toolsSrc = readFileSync(toolsPath, "utf-8")
    const toolMatches = toolsSrc.match(/const \w+: ToolDefinition = tool\(/g)
    actualToolCount = toolMatches ? toolMatches.length : 0
  } catch {
    // fallback
  }

  if (actualToolCount > 0 && actualToolCount !== TOOL_DEFINITIONS.length) {
    console.warn(
      `⚠ Tool count mismatch: found ${actualToolCount} in source, ${TOOL_DEFINITIONS.length} in generator. Run verification.`,
    )
  }

  const promptSections = extractPromptSections()

  return {
    generatedAt: new Date().toISOString(),
    tools: TOOL_DEFINITIONS,
    promptSections,
    agents: AGENT_DEFINITIONS,
    stateMachines: [CONSOLIDATION_PIPELINE, AGENT_LIFECYCLE],
    toolPipeline: TOOL_PIPELINE,
    delegationTree: DELEGATION_TREE,
  }
}

// ─── CLI Entry ───────────────────────────────────────────────────────

if (import.meta.main) {
  const data = generateExplorerData()
  const outPath = join(import.meta.dir, "explorer-data.json")
  Bun.write(outPath, JSON.stringify(data, null, 2))
  console.log(`✓ Explorer data generated: ${outPath}`)
  console.log(`  ${data.tools.length} tools, ${data.agents.length} agents, ${data.stateMachines.length} state machines`)
}
