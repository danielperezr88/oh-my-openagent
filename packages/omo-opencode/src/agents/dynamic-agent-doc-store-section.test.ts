import { describe, test, expect } from "bun:test"
import {
  buildDocStoreSection,
  buildDocStoreLibrarianExtension,
  buildDocStoreAwarenessBrief,
  buildDocStoreAwarenessWithActions,
} from "./dynamic-agent-doc-store-section"

// Tools referenced in the orchestrator-level buildDocStoreSection()
const DOC_STORE_SECTION_TOOLS = [
  "doc_store_status",
  "doc_store_ingest",
  "doc_store_consolidate_prepare",
  "doc_store_consolidate_store",
  "doc_store_consolidate_list",
  "doc_store_search",
  "doc_store_query",
]

describe("buildDocStoreSection", () => {
  const section = buildDocStoreSection()

  test("contains XML-style delimiters", () => {
    expect(section).toContain("<!-- DOC-STORE INTEGRATION -->")
    expect(section).toContain("<!-- END DOC-STORE INTEGRATION -->")
  })

  for (const toolName of DOC_STORE_SECTION_TOOLS) {
    test(`references tool ${toolName}`, () => {
      expect(section).toContain(`\`${toolName}\``)
    })
  }

  test("contains integration pattern steps", () => {
    expect(section).toContain("Before deep research")
    expect(section).toContain("After librarian/explore findings")
    expect(section).toContain("After ingestion")
    expect(section).toContain("When context needed")
  })
})

describe("buildDocStoreLibrarianExtension", () => {
  const section = buildDocStoreLibrarianExtension()

  test("contains XML-style delimiters", () => {
    expect(section).toContain("<!-- DOC-STORE INTEGRATION (librarian-specific) -->")
    expect(section).toContain("<!-- END DOC-STORE INTEGRATION (librarian-specific) -->")
  })

  test("marks doc-store integration as MANDATORY", () => {
    expect(section).toContain("MANDATORY")
  })

  test("references the primary tools librarian needs", () => {
    const toolsLibrarianNeeds = [
      "doc_store_status",
      "doc_store_search",
      "doc_store_query",
      "doc_store_ingest",
      "doc_store_consolidate_list",
      "doc_store_consolidate_prepare",
      "doc_store_consolidate_store",
    ]
    for (const toolName of toolsLibrarianNeeds) {
      expect(section).toContain(`\`${toolName}\``)
    }
  })

  test("includes vault name guidance", () => {
    expect(section).toContain("vault name")
  })
})

describe("buildDocStoreAwarenessBrief", () => {
  const section = buildDocStoreAwarenessBrief()

  test("contains XML-style delimiters", () => {
    expect(section).toContain("<!-- DOC-STORE INTEGRATION (brief) -->")
    expect(section).toContain("<!-- END DOC-STORE INTEGRATION (brief) -->")
  })

  test("references search and query tools", () => {
    expect(section).toContain("`doc_store_search`")
    expect(section).toContain("`doc_store_query`")
  })
})

describe("buildDocStoreAwarenessWithActions", () => {
  const section = buildDocStoreAwarenessWithActions()

  test("contains XML-style delimiters", () => {
    expect(section).toContain("<!-- DOC-STORE INTEGRATION (with actions) -->")
    expect(section).toContain("<!-- END DOC-STORE INTEGRATION (with actions) -->")
  })

  test("references before-work tools", () => {
    expect(section).toContain("`doc_store_search`")
    expect(section).toContain("`doc_store_query`")
  })

  test("references after-work action tools", () => {
    expect(section).toContain("`doc_store_ingest`")
    expect(section).toContain("`doc_store_consolidate_prepare`")
  })
})
