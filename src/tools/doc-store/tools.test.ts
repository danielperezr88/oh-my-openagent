import { describe, test, expect } from "bun:test"
import { createDocStoreTools } from "./tools"

describe("createDocStoreTools", () => {
  const tools = createDocStoreTools()

  const expectedTools = [
    "doc_store_status",
    "doc_store_ingest",
    "doc_store_consolidate_prepare",
    "doc_store_consolidate_store",
    "doc_store_consolidate_list",
    "doc_store_search",
    "doc_store_query",
    "doc_store_lint",
    "doc_store_maintain",
  ]

  test("returns all expected tool names", () => {
    const names = Object.keys(tools)
    for (const name of expectedTools) {
      expect(names).toContain(name)
    }
    expect(names).toHaveLength(expectedTools.length)
  })

  test("each tool has a description", () => {
    for (const [name, def] of Object.entries(tools)) {
      expect(typeof def.description).toBe("string")
      expect(def.description.length).toBeGreaterThan(10)
    }
  })

  test("each tool has args with proper schema", () => {
    for (const [name, def] of Object.entries(tools)) {
      expect(typeof def.args).toBe("object")
      expect(Object.keys(def.args!).length).toBeGreaterThan(0)
    }
  })

  test("each tool has an execute function", () => {
    for (const [name, def] of Object.entries(tools)) {
      expect(typeof def.execute).toBe("function")
    }
  })

  test("status tool accepts optional vault arg", () => {
    const statusTool = tools["doc_store_status"]!
    const args = statusTool.args as Record<string, unknown>
    expect(args).toHaveProperty("vault")
  })

  test("ingest tool requires vault and path", () => {
    const ingestTool = tools["doc_store_ingest"]!
    const args = ingestTool.args as Record<string, unknown>
    expect(args).toHaveProperty("vault")
    expect(args).toHaveProperty("path")
    expect(args).toHaveProperty("tags")
    expect(args).toHaveProperty("categories")
  })

  test("consolidate_prepare tool requires vault and doc_id", () => {
    const prepareTool = tools["doc_store_consolidate_prepare"]!
    const args = prepareTool.args as Record<string, unknown>
    expect(args).toHaveProperty("vault")
    expect(args).toHaveProperty("doc_id")
  })

  test("consolidate_store tool requires vault, doc_id, job_id, and result_json", () => {
    const storeTool = tools["doc_store_consolidate_store"]!
    const args = storeTool.args as Record<string, unknown>
    expect(args).toHaveProperty("vault")
    expect(args).toHaveProperty("doc_id")
    expect(args).toHaveProperty("job_id")
    expect(args).toHaveProperty("result_json")
  })

  test("consolidate_list tool requires vault", () => {
    const listTool = tools["doc_store_consolidate_list"]!
    const args = listTool.args as Record<string, unknown>
    expect(args).toHaveProperty("vault")
  })

  test("search tool requires vault and query", () => {
    const searchTool = tools["doc_store_search"]!
    const args = searchTool.args as Record<string, unknown>
    expect(args).toHaveProperty("vault")
    expect(args).toHaveProperty("query")
    expect(args).toHaveProperty("top")
  })

  test("query tool requires vault and question", () => {
    const queryTool = tools["doc_store_query"]!
    const args = queryTool.args as Record<string, unknown>
    expect(args).toHaveProperty("vault")
    expect(args).toHaveProperty("question")
  })

  test("lint tool requires vault", () => {
    const lintTool = tools["doc_store_lint"]!
    const args = lintTool.args as Record<string, unknown>
    expect(args).toHaveProperty("vault")
  })

  test("maintain tool requires vault", () => {
    const maintainTool = tools["doc_store_maintain"]!
    const args = maintainTool.args as Record<string, unknown>
    expect(args).toHaveProperty("vault")
  })
})
