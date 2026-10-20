import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "fs"
import { tmpdir } from "os"
import { join } from "path"
import { describe, expect, test } from "bun:test"
import { buildRulesSystemBlock, scanRuleFiles } from "./rules-injection"

function makeProject(): string {
  return mkdtempSync(join(tmpdir(), "omo-v2-rules-"))
}

describe("rules-injection", () => {
  describe("#given a project with always and scoped rules", () => {
    test("#then scanRuleFiles classifies both and the system block separates them", () => {
      // given
      const dir = makeProject()
      try {
        mkdirSync(join(dir, ".omo", "rules"), { recursive: true })
        writeFileSync(
          join(dir, ".omo", "rules", "always.md"),
          "---\ndescription: test always\nglobs: []\nalwaysApply: true\n---\nAlways body marker ALWAYS_MARKER_X",
        )
        writeFileSync(
          join(dir, ".omo", "rules", "scoped.md"),
          "---\ndescription: test scoped\nglobs:\n  - \"**/*.ts\"\n---\nScoped body marker SCOPED_MARKER_X",
        )

        // when
        const scanned = scanRuleFiles(dir)
        const block = buildRulesSystemBlock(dir)

        // then
        expect(scanned).toHaveLength(2)
        expect(scanned.find((r) => r.path.endsWith("always.md"))?.alwaysApply).toBe(true)
        expect(scanned.find((r) => r.path.endsWith("scoped.md"))?.globs).toEqual(["**/*.ts"])
        expect(block).toContain("ALWAYS_MARKER_X")
        expect(block).toContain("**/*.ts")
        expect(block).toContain("SCOPED_MARKER_X")
        expect(block).toContain("<omo-project-rules>")
      } finally {
        rmSync(dir, { recursive: true, force: true })
      }
    })
  })

  describe("#given a project with no rule directories", () => {
    test("#then the system block is null", () => {
      // given
      const dir = makeProject()
      try {
        // when
        const block = buildRulesSystemBlock(dir)

        // then
        expect(block).toBeNull()
      } finally {
        rmSync(dir, { recursive: true, force: true })
      }
    })
  })

  describe("#given a rule without frontmatter", () => {
    test("#then it is treated as always-apply", () => {
      // given
      const dir = makeProject()
      try {
        mkdirSync(join(dir, ".claude", "rules"), { recursive: true })
        writeFileSync(join(dir, ".claude", "rules", "plain.md"), "Plain body marker PLAIN_MARKER_X")

        // when
        const block = buildRulesSystemBlock(dir)

        // then
        expect(block).toContain("PLAIN_MARKER_X")
        expect(block).toContain("## Always apply")
      } finally {
        rmSync(dir, { recursive: true, force: true })
      }
    })
  })
})
