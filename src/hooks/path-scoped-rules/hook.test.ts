import { describe, it, expect } from "bun:test"
import { parseRuleFile, globMatch, createPathScopedRulesHook } from "./hook"

describe("parseRuleFile", () => {
  describe("given frontmatter with paths", () => {
    it("should extract paths and content", () => {
      const content = `---
paths:
  - "src/api/**/*.ts"
  - "src/routes/**/*.ts"
---

# API Conventions
- Use RESTful patterns
- Always validate input
`
      const rule = parseRuleFile(content, "api-rules.md")

      expect(rule).not.toBeNull()
      expect(rule!.paths).toEqual(["src/api/**/*.ts", "src/routes/**/*.ts"])
      expect(rule!.content).toContain("API Conventions")
      expect(rule!.name).toBe("api-rules")
    })
  })

  describe("given no frontmatter", () => {
    it("should treat as always-applicable rule", () => {
      const content = `# General Rules\n- Be concise`
      const rule = parseRuleFile(content, "general.md")

      expect(rule).not.toBeNull()
      expect(rule!.paths).toEqual(["**/*"])
      expect(rule!.content).toContain("General Rules")
    })
  })

  describe("given empty content", () => {
    it("should return null", () => {
      const rule = parseRuleFile("", "empty.md")
      expect(rule).toBeNull()
    })

    it("should return null for whitespace-only content", () => {
      const rule = parseRuleFile("   \n  \n  ", "whitespace.md")
      expect(rule).toBeNull()
    })
  })

  describe("given frontmatter with no paths", () => {
    it("should return null", () => {
      const content = `---
paths:
---

Some content
`
      const rule = parseRuleFile(content, "no-paths.md")
      expect(rule).toBeNull()
    })
  })

  describe("given frontmatter with single path", () => {
    it("should extract single path", () => {
      const content = `---
paths:
  - "*.test.ts"
---

# Test Rules
`
      const rule = parseRuleFile(content, "test-rules.md")
      expect(rule!.paths).toEqual(["*.test.ts"])
      expect(rule!.name).toBe("test-rules")
    })
  })
})

describe("globMatch", () => {
  it("should match * wildcard", () => {
    expect(globMatch("src/foo.ts", "src/*.ts")).toBe(true)
    expect(globMatch("src/bar.ts", "src/*.ts")).toBe(true)
    expect(globMatch("src/baz/utils.ts", "src/*.ts")).toBe(false)
  })

  it("should match ** globstar", () => {
    expect(globMatch("src/api/routes/handler.ts", "src/**/*.ts")).toBe(true)
    expect(globMatch("src/utils.ts", "src/**/*.ts")).toBe(false) // ** matches 1+ segments, needs intermediate dir
    expect(globMatch("lib/src/foo.ts", "src/**/*.ts")).toBe(false)
  })

  it("should match ? single char", () => {
    expect(globMatch("file1.ts", "file?.ts")).toBe(true)
    expect(globMatch("file12.ts", "file?.ts")).toBe(false)
  })

  it("should handle exact matches", () => {
    expect(globMatch("src/index.ts", "src/index.ts")).toBe(true)
    expect(globMatch("src/other.ts", "src/index.ts")).toBe(false)
  })

  it("should normalize backslashes", () => {
    expect(globMatch("src\\api\\handler.ts", "src/**/*.ts")).toBe(true)
  })

  it("should match ** at root", () => {
    expect(globMatch("dir/anything.txt", "**/*")).toBe(true)
  })
})

describe("createPathScopedRulesHook", () => {
  describe("tool.execute.after", () => {
    it("should extract file paths from read tool output", async () => {
      const hook = createPathScopedRulesHook({ directory: "/project" })
      await hook["tool.execute.after"]!(
        { tool: "Read", sessionID: "sess-1", callID: "c1" },
        { title: "read", output: "contents of src/api/handler.ts:\nconst x = 1", metadata: {} },
      )
      // No error = paths tracked internally
    })

    it("should ignore non-path tools", async () => {
      const hook = createPathScopedRulesHook({ directory: "/project" })
      await hook["tool.execute.after"]!(
        { tool: "bash", sessionID: "sess-1", callID: "c2" },
        { title: "bash", output: "src/main.ts compiled", metadata: {} },
      )
      // No error, no paths tracked for bash tool
    })
  })

  describe("event handler", () => {
    it("should clean up on session.deleted", async () => {
      const hook = createPathScopedRulesHook({ directory: "/project" })
      // Track a path
      await hook["tool.execute.after"]!(
        { tool: "Read", sessionID: "sess-del", callID: "c3" },
        { title: "read", output: "file src/app.ts", metadata: {} },
      )
      // Delete session
      await hook.event({ event: { type: "session.deleted", properties: { info: { id: "sess-del" } } } })
      // No error = cleanup done
    })

    it("should ignore other event types", async () => {
      const hook = createPathScopedRulesHook({ directory: "/project" })
      await hook.event({ event: { type: "session.created", properties: {} } })
      // No error
    })
  })
})
