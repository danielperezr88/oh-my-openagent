import { describe, expect, it } from "bun:test"
import { createFactForceGateHook } from "./fact-force-gate"
import { createConfigProtectionHook } from "./config-protection"

describe("fact-force-gate", () => {
  describe("#given a file that has been read", () => {
    it("allows editing", async () => {
      // given
      const hook = createFactForceGateHook()
      const sessionID = "test-session-1"
      const filePath = "/src/index.ts"
      const beforeOutput = { args: { filePath } }

      // when - read first
      await hook["tool.execute.before"]!({ tool: "read", sessionID, callID: "1" } as never, { args: { filePath } } as never)
      // when - then edit
      await hook["tool.execute.before"]!({ tool: "edit", sessionID, callID: "2" } as never, beforeOutput as never)

      // then
      expect(beforeOutput.args.__blocked).toBeUndefined()
    })
  })

  describe("#given a file that has NOT been read", () => {
    it("blocks the edit", async () => {
      // given
      const hook = createFactForceGateHook()
      const sessionID = "test-session-2"
      const filePath = "/src/secret.ts"
      const beforeOutput = { args: { filePath } }

      // when - edit without reading
      await hook["tool.execute.before"]!({ tool: "edit", sessionID, callID: "1" } as never, beforeOutput as never)

      // then
      expect(beforeOutput.args.__blocked).toBe(true)
      expect(beforeOutput.args.__block_reason).toContain("Read")
    })
  })

  describe("#given a non-edit tool", () => {
    it("does not block", async () => {
      // given
      const hook = createFactForceGateHook()
      const beforeOutput = { args: { filePath: "/src/test.ts" } }

      // when
      await hook["tool.execute.before"]!({ tool: "grep", sessionID: "s", callID: "1" } as never, beforeOutput as never)

      // then
      expect(beforeOutput.args.__blocked).toBeUndefined()
    })
  })
})

describe("config-protection", () => {
  describe("#given an edit to tsconfig.json", () => {
    it("adds a warning", async () => {
      // given
      const hook = createConfigProtectionHook()
      const beforeOutput = { args: { filePath: "/project/tsconfig.json" } }

      // when
      await hook["tool.execute.before"]!({ tool: "edit" } as never, beforeOutput as never)

      // then
      expect(beforeOutput.args.__warning).toContain("configuration file")
    })
  })

  describe("#given an edit to a normal source file", () => {
    it("does not add a warning", async () => {
      // given
      const hook = createConfigProtectionHook()
      const beforeOutput = { args: { filePath: "/src/index.ts" } }

      // when
      await hook["tool.execute.before"]!({ tool: "edit" } as never, beforeOutput as never)

      // then
      expect(beforeOutput.args.__warning).toBeUndefined()
    })
  })

  describe("#given an edit to package.json", () => {
    it("adds a dependency warning", async () => {
      // given
      const hook = createConfigProtectionHook()
      const beforeOutput = { args: { filePath: "/project/package.json", content: '{"name":"test"}' } }

      // when
      await hook["tool.execute.before"]!({ tool: "write" } as never, beforeOutput as never)

      // then
      expect(beforeOutput.args.__warning).toContain("package.json")
    })
  })
})
