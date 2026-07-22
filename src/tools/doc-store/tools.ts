import { spawn } from "node:child_process"
import { join } from "node:path"
import { homedir } from "node:os"
import { tool, type ToolDefinition } from "@opencode-ai/plugin/tool"
import { getCurrentSessionID } from "../../telemetry/session-context"

const DOC_STORE_CLI = join(homedir(), "doc-store", "src", "cli", "index.ts")

async function runDocStore(args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const env: Record<string, string | undefined> = { ...process.env }
    const sessionID = getCurrentSessionID()
    if (sessionID) {
      env.OPENAGENT_SESSION_ID = sessionID
    }

    const proc = spawn("bun", ["run", DOC_STORE_CLI, "--json", ...args], {
      stdio: ["ignore", "pipe", "pipe"],
      shell: true,
      env,
    })

    const chunks: Buffer[] = []
    const errChunks: Buffer[] = []

    proc.stdout.on("data", (d: Buffer) => chunks.push(d))
    proc.stderr.on("data", (d: Buffer) => errChunks.push(d))

    proc.on("close", (code) => {
      const stdout = Buffer.concat(chunks).toString("utf-8")
      const stderr = Buffer.concat(errChunks).toString("utf-8")
      if (code !== 0) {
        reject(new Error(stderr.trim() || stdout.trim() || `Exit code ${code}`))
      } else {
        resolve(stdout.trim())
      }
    })

    proc.on("error", (err) => reject(err))
  })
}

/**
 * Like runDocStore but writes `input` to stdin before closing it.
 * Used for consolidate-store to pass JSON payloads that may be too large
 * for CLI arguments.
 */
async function runDocStoreWithInput(args: string[], input: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const env: Record<string, string | undefined> = { ...process.env }
    const sessionID = getCurrentSessionID()
    if (sessionID) {
      env.OPENAGENT_SESSION_ID = sessionID
    }

    const proc = spawn("bun", ["run", DOC_STORE_CLI, "--json", ...args], {
      stdio: ["pipe", "pipe", "pipe"],
      shell: true,
      env,
    })

    const chunks: Buffer[] = []
    const errChunks: Buffer[] = []

    proc.stdout.on("data", (d: Buffer) => chunks.push(d))
    proc.stderr.on("data", (d: Buffer) => errChunks.push(d))

    proc.stdin.write(input)
    proc.stdin.end()

    proc.on("close", (code) => {
      const stdout = Buffer.concat(chunks).toString("utf-8")
      const stderr = Buffer.concat(errChunks).toString("utf-8")
      if (code !== 0) {
        reject(new Error(stderr.trim() || stdout.trim() || `Exit code ${code}`))
      } else {
        resolve(stdout.trim())
      }
    })

    proc.on("error", (err) => reject(err))
  })
}

export function createDocStoreTools(): Record<string, ToolDefinition> {
  const docStoreStatus: ToolDefinition = tool({
    description:
      "Show doc-store vault overview and statistics. " +
      "Pass a vault name to see detailed stats for that vault, or omit for global status. " +
      "Returns JSON with vault names, corpus item counts, raw doc counts, relationships, and confidence scores.",
    args: {
      vault: tool.schema
        .string()
        .optional()
        .describe("Vault name to inspect. Omit for global overview of all vaults."),
    },
    execute: async (args) => {
      try {
        const cliArgs = ["status"]
        if (args.vault) cliArgs.push(args.vault)
        return await runDocStore(cliArgs)
      } catch (e) {
        return `Error: ${e instanceof Error ? e.message : String(e)}`
      }
    },
  })

  const docStoreIngest: ToolDefinition = tool({
    description:
      "Add a document file to a doc-store knowledge vault. " +
      "The document will be copied into the vault and queued for consolidation. " +
      "Returns JSON with doc_id, format, size, and word count.",
    args: {
      vault: tool.schema.string().describe("Vault name to ingest into"),
      path: tool.schema.string().describe("Absolute path to the document file (pdf, md, txt, html)"),
      tags: tool.schema
        .string()
        .optional()
        .describe("Comma-separated tags for the document"),
      categories: tool.schema
        .string()
        .optional()
        .describe("Comma-separated categories to assign"),
    },
    execute: async (args) => {
      try {
        const cliArgs = ["ingest", args.vault, args.path]
        if (args.tags) cliArgs.push("--tags", args.tags)
        if (args.categories) cliArgs.push("--categories", args.categories)
        return await runDocStore(cliArgs)
      } catch (e) {
        return `Error: ${e instanceof Error ? e.message : String(e)}`
      }
    },
  })

  const docStoreConsolidatePrepare: ToolDefinition = tool({
    description:
      "Phase 1 of agent-driven consolidation: extract a document's text, find related vault items, " +
      "and return the consolidation context including the expected JSON schema and rules. " +
      "You MUST then produce a valid JSON object matching the schema and pass it to doc_store_consolidate_store. " +
      "Returns JSON with job_id, doc_text, categories, related_items, schema, and rules.",
    args: {
      vault: tool.schema.string().describe("Vault name"),
      doc_id: tool.schema.string().describe("Document ID to prepare for consolidation"),
    },
    execute: async (args) => {
      try {
        return await runDocStore(["consolidate-prepare", args.vault, "--doc-id", args.doc_id])
      } catch (e) {
        return `Error: ${e instanceof Error ? e.message : String(e)}`
      }
    },
  })

  const docStoreConsolidateStore: ToolDefinition = tool({
    description:
      "Phase 2 of agent-driven consolidation: store your structured JSON result in the vault. " +
      "Pass the exact JSON matching the schema returned by doc_store_consolidate_prepare. " +
      "If validation fails, the error will describe what to fix -- correct the JSON and retry. " +
      "Returns JSON with status (success/validation_error), items_created, relationships_created.",
    args: {
      vault: tool.schema.string().describe("Vault name"),
      doc_id: tool.schema.string().describe("Document ID"),
      job_id: tool.schema.string().describe("Job ID from consolidate-prepare"),
      result_json: tool.schema.string().describe("Valid JSON consolidation result matching the schema"),
    },
    execute: async (args) => {
      try {
        return await runDocStoreWithInput(
          ["consolidate-store", args.vault, "--doc-id", args.doc_id, "--job-id", args.job_id],
          args.result_json,
        )
      } catch (e) {
        return `Error: ${e instanceof Error ? e.message : String(e)}`
      }
    },
  })

  const docStoreConsolidateList: ToolDefinition = tool({
    description:
      "List documents in a vault that are pending consolidation or currently in progress. " +
      "Use this to discover which documents need consolidation before calling " +
      "doc_store_consolidate_prepare for each one. " +
      "Returns JSON with pending_docs and consolidating_docs arrays.",
    args: {
      vault: tool.schema.string().describe("Vault name"),
    },
    execute: async (args) => {
      try {
        return await runDocStore(["consolidate-list", args.vault])
      } catch (e) {
        return `Error: ${e instanceof Error ? e.message : String(e)}`
      }
    },
  })

  const docStoreSearch: ToolDefinition = tool({
    description:
      "Search a doc-store vault using the multi-stage retrieval pipeline (BM25 + vector search + optional cross-encoder reranking). " +
      "Returns JSON with matching item IDs, scores, and text snippets.",
    args: {
      vault: tool.schema.string().describe("Vault name to search"),
      query: tool.schema.string().describe("Search query"),
      top: tool.schema
        .string()
        .optional()
        .describe("Number of results to return (default: 5)"),
    },
    execute: async (args) => {
      try {
        const cliArgs = ["search", args.vault, args.query]
        if (args.top) cliArgs.push("--top", args.top)
        return await runDocStore(cliArgs)
      } catch (e) {
        return `Error: ${e instanceof Error ? e.message : String(e)}`
      }
    },
  })

  const docStoreQuery: ToolDefinition = tool({
    description:
      "Retrieve relevant knowledge items from a vault for a given question. " +
      "Returns search results with full text and scores. " +
      "Synthesize your own answer from these sources, citing item IDs in brackets.",
    args: {
      vault: tool.schema.string().describe("Vault name"),
      question: tool.schema.string().describe("Question to answer from vault knowledge"),
    },
    execute: async (args) => {
      try {
        return await runDocStore(["query", args.vault, args.question])
      } catch (e) {
        return `Error: ${e instanceof Error ? e.message : String(e)}`
      }
    },
  })

  const docStoreLint: ToolDefinition = tool({
    description:
      "Health-check a doc-store vault. Detects orphans, broken wikilinks, stale items, unresolved contradictions, and dangling edges. " +
      "Returns JSON with issue list categorized by severity (error/warning/info).",
    args: {
      vault: tool.schema.string().describe("Vault name to lint"),
    },
    execute: async (args) => {
      try {
        return await runDocStore(["lint", args.vault])
      } catch (e) {
        return `Error: ${e instanceof Error ? e.message : String(e)}`
      }
    },
  })

  const docStoreMaintain: ToolDefinition = tool({
    description:
      "Prune and update a doc-store vault. Applies confidence decay, archives items below threshold, handles superseded items, and compacts relationship edges. " +
      "Returns JSON with counts of decayed, archived, superseded items and compacted edges.",
    args: {
      vault: tool.schema.string().describe("Vault name to maintain"),
    },
    execute: async (args) => {
      try {
        return await runDocStore(["maintain", args.vault])
      } catch (e) {
        return `Error: ${e instanceof Error ? e.message : String(e)}`
      }
    },
  })

  return {
    doc_store_status: docStoreStatus,
    doc_store_ingest: docStoreIngest,
    doc_store_consolidate_prepare: docStoreConsolidatePrepare,
    doc_store_consolidate_store: docStoreConsolidateStore,
    doc_store_consolidate_list: docStoreConsolidateList,
    doc_store_search: docStoreSearch,
    doc_store_query: docStoreQuery,
    doc_store_lint: docStoreLint,
    doc_store_maintain: docStoreMaintain,
  }
}
