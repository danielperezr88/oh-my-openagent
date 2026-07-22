import { describe, expect, it } from "bun:test"
import { existsSync, mkdirSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { detectStack } from "./detector"

const TEST_DIR = join(tmpdir(), `ecc-stack-test-${Date.now()}`)

function setupTestDir(files: Record<string, string>): string {
  if (existsSync(TEST_DIR)) {
    for (const f of Object.keys(files)) {
      writeFileSync(join(TEST_DIR, f), files[f])
    }
  } else {
    mkdirSync(TEST_DIR, { recursive: true })
    for (const [name, content] of Object.entries(files)) {
      writeFileSync(join(TEST_DIR, name), content)
    }
  }
  return TEST_DIR
}

describe("detectStack", () => {
  describe("#given a TypeScript + React + Bun project", () => {
    it("detects all three", () => {
      // given
      const dir = setupTestDir({
        "tsconfig.json": "{}",
        "package.json": JSON.stringify({
          dependencies: { react: "18.0.0", "react-dom": "18.0.0" },
          devDependencies: { vitest: "1.0.0" },
        }),
        "bun.lock": "",
        "next.config.mjs": "export default {}",
      })
      // when
      const result = detectStack(dir)
      // then
      expect(result.languages).toContain("typescript")
      expect(result.frameworks).toContain("react")
      expect(result.frameworks).toContain("nextjs")
      expect(result.runtime).toBe("bun")
      expect(result.packageManager).toBe("bun-pm")
      expect(["vitest", "bun-test"]).toContain(result.testFramework)
    })
  })

  describe("#given a Python project", () => {
    it("detects Python", () => {
      // given
      const dir = setupTestDir({
        "requirements.txt": "fastapi==0.100.0\npytest==7.0.0",
      })
      // when
      const result = detectStack(dir)
      // then
      expect(result.languages).toContain("python")
    })
  })

  describe("#given a Go project", () => {
    it("detects Go", () => {
      // given
      const dir = setupTestDir({
        "go.mod": "module example\n\ngo 1.21",
      })
      // when
      const result = detectStack(dir)
      // then
      expect(result.languages).toContain("go")
    })
  })

  describe("#given an empty directory", () => {
    it("returns empty stack info", () => {
      // given
      const dir = join(tmpdir(), `ecc-empty-${Date.now()}`)
      mkdirSync(dir, { recursive: true })
      // when
      const result = detectStack(dir)
      // then
      expect(result.languages).toHaveLength(0)
      expect(result.frameworks).toHaveLength(0)
      expect(result.packageManager).toBeNull()
    })
  })
})
