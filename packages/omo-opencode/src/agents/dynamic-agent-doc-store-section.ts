/**
 * Doc-Store awareness sections for agent prompts.
 *
 * Injects knowledge about doc-store tools so agents know when and how to use
 * the document vault. Each section is clearly delimited with XML-style comments
 * for easy identification and removal.
 */

/**
 * General doc-store awareness for orchestrator/worker agents (Sisyphus, Hephaestus).
 * Placed in the Exploration & Research phase alongside explore/librarian sections.
 */
export function buildDocStoreSection(): string {
  return `<!-- DOC-STORE INTEGRATION -->
### Doc-Store = Knowledge Vault

You have access to a doc-store knowledge vault via these tools:

| Tool | Purpose | When to Use |
|------|---------|-------------|
| \`doc_store_status\` | Vault overview and stats | Before starting complex research to check what's available |
| \`doc_store_search\` | BM25 + vector search | Checking if a topic has already been researched and consolidated |
| \`doc_store_query\` | Retrieve relevant knowledge for a question | Getting source material to synthesize answers from accumulated knowledge |
| \`doc_store_ingest\` | Add raw documents to vault | Saving useful data sources found during research |
| \`doc_store_consolidate_list\` | Find pending docs | Before starting consolidation to see what needs processing |
| \`doc_store_consolidate_prepare\` | Get doc context + schema | Phase 1: extract document text and consolidation instructions |
| \`doc_store_consolidate_store\` | Save consolidation result | Phase 2: submit structured JSON, validates and persists |

**Integration pattern:**
1. Before deep research: \`doc_store_search\` to check existing knowledge
2. After librarian/explore findings: \`doc_store_ingest\` to save useful raw sources
3. After ingestion: \`doc_store_consolidate_list\` -> for each pending doc:
   a. \`doc_store_consolidate_prepare\` (returns doc text, schema, and rules)
   b. Produce valid JSON matching the schema
   c. \`doc_store_consolidate_store\` (validates and saves)
4. When context needed: \`doc_store_search\` or \`doc_store_query\`
<!-- END DOC-STORE INTEGRATION -->`
}

/**
 * Extended doc-store awareness for the Librarian agent.
 * The librarian is the primary consumer: it ingests raw sources and performs consolidation.
 */
export function buildDocStoreLibrarianExtension(): string {
  return `
<!-- DOC-STORE INTEGRATION (librarian-specific) -->
### Doc-Store Integration (MANDATORY)

You are the **primary doc-store operator**. Your research workflow MUST include:

**Phase 1.5 - Doc-Store Check (NEW, after Phase 0.5):**
Before external research, run \`doc_store_status\` and \`doc_store_search\` to check if the topic has already been researched. If relevant knowledge exists, incorporate it and skip redundant searches.

**Phase 2.5 - Doc-Store Ingest & Consolidate (NEW, after Phase 2):**
After synthesizing findings, save useful raw data sources to the vault:
1. \`doc_store_ingest\` - Save the raw source files/pages you found most useful (download them first if remote)
2. \`doc_store_consolidate_list\` - Check what documents need consolidation
3. For EACH pending document:
   a. \`doc_store_consolidate_prepare\` [vault, doc_id] - Returns the document text, related items, schema, and rules
   b. READ the document text carefully. Produce a JSON object matching the EXACT schema provided:
      - Extract 1-5 knowledge items as self-contained units
      - Each item needs: title, category, summary (20+ chars), key_insights (5+ chars each), tags
      - Add relationships between items using titles as source/target
      - Write an overall summary (10+ chars)
   c. \`doc_store_consolidate_store\` [vault, doc_id, job_id, result_json] - Submit your JSON
   d. If validation fails, read the error carefully, fix the JSON, and retry

**IMPORTANT:** You ARE the consolidation engine. Doc-store provides the context and schema, but the reasoning and extraction quality is YOURS. Produce high-quality structured knowledge from the document text.

**Available tools:**
- \`doc_store_status\` [vault?] - Check vault overview
- \`doc_store_search\` [vault, query] - Search existing knowledge
- \`doc_store_query\` [vault, question] - Retrieve knowledge for a question (you synthesize the answer)
- \`doc_store_ingest\` [vault, path, tags?, categories?] - Add raw documents
- \`doc_store_consolidate_list\` [vault] - List documents needing consolidation
- \`doc_store_consolidate_prepare\` [vault, doc_id] - Get document context + schema
- \`doc_store_consolidate_store\` [vault, doc_id, job_id, result_json] - Store consolidation result

Use a consistent vault name per project/topic. If unsure, use "default".
<!-- END DOC-STORE INTEGRATION (librarian-specific) -->`
}

/**
 * Brief doc-store awareness paragraph for non-primary subagents.
 * Used for Oracle, Explore, Metis, Momus, Atlas, Prometheus, Sisyphus-Junior.
 */
export function buildDocStoreAwarenessBrief(): string {
  return `<!-- DOC-STORE INTEGRATION (brief) -->
**Doc-Store**: You have access to \`doc_store_search\` and \`doc_store_query\` for retrieving accumulated project knowledge. Use them to check existing research before starting your own analysis.
<!-- END DOC-STORE INTEGRATION (brief) -->`
}

/**
 * Doc-store awareness for agents that should also trigger post-work actions.
 * Used for Atlas (post-task consolidation) and Sisyphus-Junior.
 */
export function buildDocStoreAwarenessWithActions(): string {
  return `<!-- DOC-STORE INTEGRATION (with actions) -->
**Doc-Store**: You have access to knowledge vault tools:
- Before work: \`doc_store_search\` / \`doc_store_query\` to retrieve relevant past learnings
- After completing a task:
  1. \`doc_store_ingest\` to save useful sources
  2. \`doc_store_consolidate_list\` to find pending docs
  3. \`doc_store_consolidate_prepare\` + produce JSON + \`doc_store_consolidate_store\` for each doc
<!-- END DOC-STORE INTEGRATION (with actions) -->`
}
