import type { Plugin } from "@opencode/plugin"
import { runDocStore, runDocStoreWithInput } from "./doc-store-cli"

type ToolContextLike = { readonly sessionID?: string }

interface VaultArgs {
  readonly vault?: string
}

interface ErrorResult {
  readonly content: string
}

async function call(args: string[], context: ToolContextLike): Promise<ErrorResult> {
  try {
    return { content: await runDocStore(args, { sessionID: context.sessionID }) }
  } catch (e) {
    return { content: `Error: ${e instanceof Error ? e.message : String(e)}` }
  }
}

const objectSchema = {
  type: "object" as const,
  additionalProperties: false,
}
const vaultProp = { type: "string", description: "Vault name" }

export function registerDocStoreTools(ctx: Plugin.Context): void {
  void ctx.tool.transform((editor) => {
    editor.add({
      name: "doc_store_status",
      description:
        "Show doc-store vault overview and statistics. Pass a vault name for detailed stats, or omit for global status.",
      input: {
        ...objectSchema,
        properties: { vault: { type: "string", description: "Vault name to inspect. Omit for global overview." } },
      },
      async execute(raw, context) {
        const args = raw as VaultArgs
        return call(args.vault ? ["status", args.vault] : ["status"], context)
      },
    })

    editor.add({
      name: "doc_store_ingest",
      description:
        "Add a document file to a doc-store knowledge vault. The document is copied into the vault and queued for consolidation. " +
        "Returns JSON with doc_id, format, size, and word count.",
      input: {
        ...objectSchema,
        required: ["vault", "path"],
        properties: {
          vault: vaultProp,
          path: { type: "string", description: "Absolute path to the document file (pdf, md, txt, html)" },
          tags: { type: "string", description: "Comma-separated tags for the document" },
          categories: { type: "string", description: "Comma-separated categories to assign" },
        },
      },
      async execute(raw, context) {
        const args = raw as { vault: string; path: string; tags?: string; categories?: string }
        const cliArgs = ["ingest", args.vault, args.path]
        if (args.tags) cliArgs.push("--tags", args.tags)
        if (args.categories) cliArgs.push("--categories", args.categories)
        return call(cliArgs, context)
      },
    })

    editor.add({
      name: "doc_store_consolidate_prepare",
      description:
        "Phase 1 of agent-driven consolidation: extract a document's text, find related vault items, " +
        "and return the consolidation context including the expected JSON schema and rules. " +
        "Produce a valid JSON object matching the schema and pass it to doc_store_consolidate_store.",
      input: {
        ...objectSchema,
        required: ["vault", "doc_id"],
        properties: { vault: vaultProp, doc_id: { type: "string", description: "Document ID to prepare" } },
      },
      async execute(raw, context) {
        const args = raw as { vault: string; doc_id: string }
        return call(["consolidate-prepare", args.vault, "--doc-id", args.doc_id], context)
      },
    })

    editor.add({
      name: "doc_store_consolidate_store",
      description:
        "Phase 2 of agent-driven consolidation: store your structured JSON result in the vault. " +
        "Pass the exact JSON matching the schema returned by doc_store_consolidate_prepare.",
      input: {
        ...objectSchema,
        required: ["vault", "doc_id", "job_id", "result_json"],
        properties: {
          vault: vaultProp,
          doc_id: { type: "string", description: "Document ID" },
          job_id: { type: "string", description: "Job ID from consolidate-prepare" },
          result_json: { type: "string", description: "Valid JSON consolidation result matching the schema" },
        },
      },
      async execute(raw, context) {
        const args = raw as { vault: string; doc_id: string; job_id: string; result_json: string }
        try {
          const out = await runDocStoreWithInput(
            ["consolidate-store", args.vault, "--doc-id", args.doc_id, "--job-id", args.job_id],
            args.result_json,
            { sessionID: context.sessionID },
          )
          return { content: out }
        } catch (e) {
          return { content: `Error: ${e instanceof Error ? e.message : String(e)}` }
        }
      },
    })

    editor.add({
      name: "doc_store_consolidate_list",
      description:
        "List documents in a vault pending consolidation or in progress. Use to discover which documents need consolidation.",
      input: { ...objectSchema, required: ["vault"], properties: { vault: vaultProp } },
      async execute(raw, context) {
        const args = raw as { vault: string }
        return call(["consolidate-list", args.vault], context)
      },
    })

    editor.add({
      name: "doc_store_search",
      description:
        "Search a doc-store vault using the multi-stage retrieval pipeline (BM25 + vector search + reranking). " +
        "Returns JSON with matching item IDs, scores, and text snippets.",
      input: {
        ...objectSchema,
        required: ["vault", "query"],
        properties: {
          vault: vaultProp,
          query: { type: "string", description: "Search query" },
          top: { type: "string", description: "Number of results to return (default: 5)" },
        },
      },
      async execute(raw, context) {
        const args = raw as { vault: string; query: string; top?: string }
        const cliArgs = ["search", args.vault, args.query]
        if (args.top) cliArgs.push("--top", args.top)
        return call(cliArgs, context)
      },
    })

    editor.add({
      name: "doc_store_query",
      description:
        "Retrieve relevant knowledge items from a vault for a given question. Returns search results with full text and scores. " +
        "Synthesize your own answer from these sources, citing item IDs in brackets.",
      input: {
        ...objectSchema,
        required: ["vault", "question"],
        properties: { vault: vaultProp, question: { type: "string", description: "Question to answer from vault knowledge" } },
      },
      async execute(raw, context) {
        const args = raw as { vault: string; question: string }
        return call(["query", args.vault, args.question], context)
      },
    })

    editor.add({
      name: "doc_store_lint",
      description:
        "Health-check a doc-store vault. Detects orphans, broken wikilinks, stale items, contradictions, and dangling edges.",
      input: { ...objectSchema, required: ["vault"], properties: { vault: vaultProp } },
      async execute(raw, context) {
        const args = raw as { vault: string }
        return call(["lint", args.vault], context)
      },
    })

    editor.add({
      name: "doc_store_maintain",
      description:
        "Prune and update a doc-store vault: confidence decay, archiving below threshold, superseded handling, edge compaction.",
      input: { ...objectSchema, required: ["vault"], properties: { vault: vaultProp } },
      async execute(raw, context) {
        const args = raw as { vault: string }
        return call(["maintain", args.vault], context)
      },
    })
  })
}
