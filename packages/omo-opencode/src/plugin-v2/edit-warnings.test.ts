import { describe, expect, test } from "bun:test"
import { configEditWarning, diagnosticsReminder } from "./edit-warnings"

describe("configEditWarning", () => {
  describe("#given a build or lint config file", () => {
    test("#then a protection warning is returned", () => {
      // given / when
      const warning = configEditWarning("tsconfig.json", true)

      // then
      expect(warning).toContain("build/lint configuration file")
      expect(warning).toContain("tsconfig.json")
    })
  })

  describe("#given package.json with a content change", () => {
    test("#then a dependency warning is returned", () => {
      // given / when
      const warning = configEditWarning("package.json", true)

      // then
      expect(warning).toContain("package.json")
    })
  })

  describe("#given package.json without content fields", () => {
    test("#then no warning is returned", () => {
      // given / when
      const warning = configEditWarning("package.json", false)

      // then
      expect(warning).toBeNull()
    })
  })

  describe("#given an ordinary source file", () => {
    test("#then no warning is returned", () => {
      // given / when
      const warning = configEditWarning("src/index.ts", true)

      // then
      expect(warning).toBeNull()
    })
  })
})

describe("diagnosticsReminder", () => {
  describe("#given a ts file whose edit output contains errors", () => {
    test("#then a reminder is returned", () => {
      // given / when
      const reminder = diagnosticsReminder("src/a.ts", "Error: TS2345 type mismatch")

      // then
      expect(reminder).toContain("src/a.ts")
      expect(reminder).toContain("errors")
    })
  })

  describe("#given a ts file with a clean output", () => {
    test("#then no reminder is returned", () => {
      // given / when
      const reminder = diagnosticsReminder("src/a.ts", "Applied edit successfully")

      // then
      expect(reminder).toBeNull()
    })
  })

  describe("#given a markdown file with errors in output", () => {
    test("#then no reminder is returned", () => {
      // given / when
      const reminder = diagnosticsReminder("README.md", "error occurred")

      // then
      expect(reminder).toBeNull()
    })
  })
})
