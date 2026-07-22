import { describe, it, expect, beforeEach, afterEach } from "bun:test"
import { mkdirSync, rmSync, existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createCheckpointUndoHook, extractFilePathFromOutput } from "./hook"

function makeTempDir(prefix: string): string {
  const dir = join(tmpdir(), `checkpoint-undo-test-${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`)
  mkdirSync(dir, { recursive: true })
  return dir
}

describe("extractFilePathFromOutput", () => {
  it("should extract path from 'edited file' pattern", () => {
    expect(extractFilePathFromOutput("edited file src/foo.ts")).toBe("src/foo.ts")
  })

  it("should extract path from 'modified' pattern", () => {
    expect(extractFilePathFromOutput("modified src/bar.ts")).toBe("src/bar.ts")
  })

  it("should extract path from 'wrote' pattern", () => {
    expect(extractFilePathFromOutput("wrote lib/utils.ts")).toBe("lib/utils.ts")
  })

  it("should extract path from 'file:' pattern", () => {
    expect(extractFilePathFromOutput("file: src/app.ts")).toBe("src/app.ts")
  })

  it("should return undefined for no match", () => {
    expect(extractFilePathFromOutput("some random output")).toBeUndefined()
  })

  it("should return undefined for empty string", () => {
    expect(extractFilePathFromOutput("")).toBeUndefined()
  })
})

describe("createCheckpointUndoHook", () => {
  describe("with directory configured (full disk persistence)", () => {
    let tempDir: string
    let projectDir: string
    let hook: ReturnType<typeof createCheckpointUndoHook>

    beforeEach(() => {
      tempDir = makeTempDir("with-dir")
      projectDir = join(tempDir, "project")
      mkdirSync(projectDir, { recursive: true })
    })

    afterEach(() => {
      rmSync(tempDir, { recursive: true, force: true })
    })

    it("should capture file content before edit and persist to disk", async () => {
      // Create a file that will be "edited"
      const srcFile = join(projectDir, "src", "foo.ts")
      mkdirSync(join(projectDir, "src"), { recursive: true })
      writeFileSync(srcFile, "const x = 1\n", "utf-8")

      hook = createCheckpointUndoHook({ directory: projectDir })

      // Simulate tool.execute.before — tool args include filePath
      await hook["tool.execute.before"]!(
        { tool: "hashline_edit", sessionID: "sess-1", callID: "call-1" },
        { args: { filePath: "src/foo.ts" } },
      )

      // Simulate tool.execute.after
      await hook["tool.execute.after"]!(
        { tool: "hashline_edit", sessionID: "sess-1", callID: "call-1" },
        { title: "Edit result", output: "edited file src/foo.ts", metadata: {} },
      )

      // Verify checkpoint was written to disk
      const checkpointsDir = join(projectDir, ".sisyphus", "checkpoints")
      expect(existsSync(checkpointsDir)).toBe(true)

      const files = readdirSync(checkpointsDir)
      expect(files).toHaveLength(1)
      expect(files[0]).toBe("sess-1_call-1.json")

      // Verify checkpoint content
      const checkpoint = JSON.parse(readFileSync(join(checkpointsDir, files[0]), "utf-8"))
      expect(checkpoint.filePath).toBe("src/foo.ts")
      expect(checkpoint.content).toBe("const x = 1\n")
      expect(checkpoint.sessionID).toBe("sess-1")
      expect(checkpoint.callID).toBe("call-1")
    })

    it("should capture empty content for new files (file doesn't exist yet)", async () => {
      hook = createCheckpointUndoHook({ directory: projectDir })

      // Tool args reference a file that doesn't exist
      await hook["tool.execute.before"]!(
        { tool: "Write", sessionID: "sess-2", callID: "call-2" },
        { args: { filePath: "src/new-file.ts" } },
      )

      await hook["tool.execute.after"]!(
        { tool: "Write", sessionID: "sess-2", callID: "call-2" },
        { title: "Write result", output: "wrote src/new-file.ts", metadata: {} },
      )

      const checkpointsDir = join(projectDir, ".sisyphus", "checkpoints")
      const files = readdirSync(checkpointsDir)
      expect(files).toHaveLength(1)

      const checkpoint = JSON.parse(readFileSync(join(checkpointsDir, files[0]), "utf-8"))
      expect(checkpoint.content).toBe("")
    })

    it("should handle filePath from args.path key", async () => {
      const srcFile = join(projectDir, "from-path.ts")
      writeFileSync(srcFile, "original content", "utf-8")

      hook = createCheckpointUndoHook({ directory: projectDir })

      await hook["tool.execute.before"]!(
        { tool: "Edit", sessionID: "sess-3", callID: "call-3" },
        { args: { path: "from-path.ts" } },
      )

      await hook["tool.execute.after"]!(
        { tool: "Edit", sessionID: "sess-3", callID: "call-3" },
        { title: "Edit", output: "edited file from-path.ts", metadata: {} },
      )

      const checkpointsDir = join(projectDir, ".sisyphus", "checkpoints")
      const checkpoint = JSON.parse(readFileSync(join(checkpointsDir, "sess-3_call-3.json"), "utf-8"))
      expect(checkpoint.content).toBe("original content")
    })

    it("should handle filePath from args.file_path key", async () => {
      const srcFile = join(projectDir, "from-file-path.ts")
      writeFileSync(srcFile, "content via file_path key", "utf-8")

      hook = createCheckpointUndoHook({ directory: projectDir })

      await hook["tool.execute.before"]!(
        { tool: "file_edit", sessionID: "sess-4", callID: "call-4" },
        { args: { file_path: "from-file-path.ts" } },
      )

      await hook["tool.execute.after"]!(
        { tool: "file_edit", sessionID: "sess-4", callID: "call-4" },
        { title: "Edit", output: "edited file from-file-path.ts", metadata: {} },
      )

      const checkpointsDir = join(projectDir, ".sisyphus", "checkpoints")
      const checkpoint = JSON.parse(readFileSync(join(checkpointsDir, "sess-4_call-4.json"), "utf-8"))
      expect(checkpoint.content).toBe("content via file_path key")
    })

    it("should handle absolute file paths in args", async () => {
      const srcFile = join(projectDir, "absolute.ts")
      writeFileSync(srcFile, "absolute path content", "utf-8")

      hook = createCheckpointUndoHook({ directory: projectDir })

      await hook["tool.execute.before"]!(
        { tool: "Edit", sessionID: "sess-abs", callID: "call-abs" },
        { args: { filePath: srcFile } },
      )

      await hook["tool.execute.after"]!(
        { tool: "Edit", sessionID: "sess-abs", callID: "call-abs" },
        { title: "Edit", output: "edited file", metadata: {} },
      )

      const checkpointsDir = join(projectDir, ".sisyphus", "checkpoints")
      const checkpoint = JSON.parse(readFileSync(join(checkpointsDir, "sess-abs_call-abs.json"), "utf-8"))
      expect(checkpoint.content).toBe("absolute path content")
      // filePath in checkpoint should be the absolute path
      expect(checkpoint.filePath).toBe(srcFile)
    })

    it("should fall back to output metadata for file path when args have none", async () => {
      const srcFile = join(projectDir, "meta-fallback.ts")
      writeFileSync(srcFile, "metadata fallback content", "utf-8")

      hook = createCheckpointUndoHook({ directory: projectDir })

      // No filePath in args
      await hook["tool.execute.before"]!(
        { tool: "hashline_edit", sessionID: "sess-meta", callID: "call-meta" },
        { args: {} },
      )

      await hook["tool.execute.after"]!(
        { tool: "hashline_edit", sessionID: "sess-meta", callID: "call-meta" },
        { title: "Edit", output: "done", metadata: { filePath: "meta-fallback.ts" } },
      )

      const checkpointsDir = join(projectDir, ".sisyphus", "checkpoints")
      const files = readdirSync(checkpointsDir)
      expect(files).toHaveLength(1)

      // Content should be empty since we didn't have the path at toolExecuteBefore time
      const checkpoint = JSON.parse(readFileSync(join(checkpointsDir, files[0]), "utf-8"))
      expect(checkpoint.filePath).toBe("meta-fallback.ts")
      expect(checkpoint.content).toBe("")
    })

    it("should fall back to output text parsing for file path", async () => {
      const srcFile = join(projectDir, "text-parse.ts")
      writeFileSync(srcFile, "text parsed path", "utf-8")

      hook = createCheckpointUndoHook({ directory: projectDir })

      // No filePath in args or metadata
      await hook["tool.execute.before"]!(
        { tool: "safe_write", sessionID: "sess-text", callID: "call-text" },
        { args: {} },
      )

      await hook["tool.execute.after"]!(
        { tool: "safe_write", sessionID: "sess-text", callID: "call-text" },
        { title: "Write", output: "wrote text-parse.ts", metadata: {} },
      )

      const checkpointsDir = join(projectDir, ".sisyphus", "checkpoints")
      const files = readdirSync(checkpointsDir)
      expect(files).toHaveLength(1)
    })

    it("should skip checkpoint when no file path found anywhere", async () => {
      hook = createCheckpointUndoHook({ directory: projectDir })

      await hook["tool.execute.before"]!(
        { tool: "hashline_edit", sessionID: "sess-nopath", callID: "call-nopath" },
        { args: {} },
      )

      await hook["tool.execute.after"]!(
        { tool: "hashline_edit", sessionID: "sess-nopath", callID: "call-nopath" },
        { title: "Edit", output: "done", metadata: {} },
      )

      const checkpointsDir = join(projectDir, ".sisyphus", "checkpoints")
      if (existsSync(checkpointsDir)) {
        expect(readdirSync(checkpointsDir)).toHaveLength(0)
      }
    })

    it("should enforce maxCheckpoints limit", async () => {
      hook = createCheckpointUndoHook({ directory: projectDir, maxCheckpoints: 3 })

      // Create 5 checkpoints
      for (let i = 1; i <= 5; i++) {
        const srcFile = join(projectDir, `file-${i}.ts`)
        writeFileSync(srcFile, `content-${i}`, "utf-8")

        await hook["tool.execute.before"]!(
          { tool: "Edit", sessionID: "sess-max", callID: `call-max-${i}` },
          { args: { filePath: `file-${i}.ts` } },
        )
        await hook["tool.execute.after"]!(
          { tool: "Edit", sessionID: "sess-max", callID: `call-max-${i}` },
          { title: "Edit", output: `edited file file-${i}.ts`, metadata: {} },
        )
      }

      // Only 3 should remain (the last 3)
      const checkpointsDir = join(projectDir, ".sisyphus", "checkpoints")
      const files = readdirSync(checkpointsDir).sort()
      expect(files).toHaveLength(3)

      // The remaining files should be the newest 3 (call-max-3, 4, 5)
      expect(files[0]).toBe("sess-max_call-max-3.json")
      expect(files[1]).toBe("sess-max_call-max-4.json")
      expect(files[2]).toBe("sess-max_call-max-5.json")
    })

    it("should delete checkpoint files on session.deleted", async () => {
      hook = createCheckpointUndoHook({ directory: projectDir })

      // Create a checkpoint
      const srcFile = join(projectDir, "deleteme.ts")
      writeFileSync(srcFile, "to be deleted", "utf-8")

      await hook["tool.execute.before"]!(
        { tool: "Edit", sessionID: "sess-del", callID: "call-del" },
        { args: { filePath: "deleteme.ts" } },
      )
      await hook["tool.execute.after"]!(
        { tool: "Edit", sessionID: "sess-del", callID: "call-del" },
        { title: "Edit", output: "edited file deleteme.ts", metadata: {} },
      )

      const checkpointsDir = join(projectDir, ".sisyphus", "checkpoints")
      expect(readdirSync(checkpointsDir)).toHaveLength(1)

      // Delete the session
      await hook.event!({ event: { type: "session.deleted", properties: { info: { id: "sess-del" } } } })

      // Checkpoint file should be deleted
      expect(readdirSync(checkpointsDir)).toHaveLength(0)
    })

    it("should only delete checkpoints for the deleted session", async () => {
      hook = createCheckpointUndoHook({ directory: projectDir })

      // Create checkpoints for two sessions
      for (const sess of ["sess-a", "sess-b"]) {
        const srcFile = join(projectDir, `${sess}.ts`)
        writeFileSync(srcFile, `content for ${sess}`, "utf-8")

        await hook["tool.execute.before"]!(
          { tool: "Edit", sessionID: sess, callID: "call-1" },
          { args: { filePath: `${sess}.ts` } },
        )
        await hook["tool.execute.after"]!(
          { tool: "Edit", sessionID: sess, callID: "call-1" },
          { title: "Edit", output: `edited file ${sess}.ts`, metadata: {} },
        )
      }

      const checkpointsDir = join(projectDir, ".sisyphus", "checkpoints")
      expect(readdirSync(checkpointsDir)).toHaveLength(2)

      // Delete sess-a
      await hook.event!({ event: { type: "session.deleted", properties: { info: { id: "sess-a" } } } })

      // Only sess-b's checkpoint should remain
      const remaining = readdirSync(checkpointsDir)
      expect(remaining).toHaveLength(1)
      expect(remaining[0]).toBe("sess-b_call-1.json")
    })

    it("should not delete sess-12 checkpoints when sess-1 is deleted (prefix safety)", async () => {
      hook = createCheckpointUndoHook({ directory: projectDir })

      for (const sess of ["sess-1", "sess-12"]) {
        const srcFile = join(projectDir, `${sess}.ts`)
        writeFileSync(srcFile, `content for ${sess}`, "utf-8")

        await hook["tool.execute.before"]!(
          { tool: "Edit", sessionID: sess, callID: "call-prefix" },
          { args: { filePath: `${sess}.ts` } },
        )
        await hook["tool.execute.after"]!(
          { tool: "Edit", sessionID: sess, callID: "call-prefix" },
          { title: "Edit", output: `edited file ${sess}.ts`, metadata: {} },
        )
      }

      // Delete sess-1
      await hook.event!({ event: { type: "session.deleted", properties: { info: { id: "sess-1" } } } })

      const checkpointsDir = join(projectDir, ".sisyphus", "checkpoints")
      const remaining = readdirSync(checkpointsDir)
      // sess-1 should be deleted, sess-12 should remain
      expect(remaining.some(f => f.startsWith("sess-12_"))).toBe(true)
      expect(remaining.some(f => f.startsWith("sess-1_") && !f.startsWith("sess-12_"))).toBe(false)
    })

    it("should use custom checkpointsDir when specified", async () => {
      hook = createCheckpointUndoHook({
        directory: projectDir,
        checkpointsDir: ".custom-checkpoints",
      })

      const srcFile = join(projectDir, "custom.ts")
      writeFileSync(srcFile, "custom dir content", "utf-8")

      await hook["tool.execute.before"]!(
        { tool: "Edit", sessionID: "sess-custom", callID: "call-custom" },
        { args: { filePath: "custom.ts" } },
      )
      await hook["tool.execute.after"]!(
        { tool: "Edit", sessionID: "sess-custom", callID: "call-custom" },
        { title: "Edit", output: "edited file custom.ts", metadata: {} },
      )

      const customDir = join(projectDir, ".custom-checkpoints")
      expect(existsSync(customDir)).toBe(true)
      expect(readdirSync(customDir)).toHaveLength(1)

      // Default dir should NOT exist
      expect(existsSync(join(projectDir, ".sisyphus", "checkpoints"))).toBe(false)
    })

    it("should handle multiple edits to the same file (each gets its own checkpoint)", async () => {
      hook = createCheckpointUndoHook({ directory: projectDir })

      const srcFile = join(projectDir, "multi-edit.ts")

      // First edit: file doesn't exist yet
      await hook["tool.execute.before"]!(
        { tool: "Write", sessionID: "sess-multi", callID: "call-1" },
        { args: { filePath: "multi-edit.ts" } },
      )
      writeFileSync(srcFile, "version-1", "utf-8") // Simulate the write
      await hook["tool.execute.after"]!(
        { tool: "Write", sessionID: "sess-multi", callID: "call-1" },
        { title: "Write", output: "wrote multi-edit.ts", metadata: {} },
      )

      // Second edit: file has "version-1"
      await hook["tool.execute.before"]!(
        { tool: "Edit", sessionID: "sess-multi", callID: "call-2" },
        { args: { filePath: "multi-edit.ts" } },
      )
      writeFileSync(srcFile, "version-2", "utf-8") // Simulate the edit
      await hook["tool.execute.after"]!(
        { tool: "Edit", sessionID: "sess-multi", callID: "call-2" },
        { title: "Edit", output: "edited file multi-edit.ts", metadata: {} },
      )

      // Third edit: file has "version-2"
      await hook["tool.execute.before"]!(
        { tool: "Edit", sessionID: "sess-multi", callID: "call-3" },
        { args: { filePath: "multi-edit.ts" } },
      )
      await hook["tool.execute.after"]!(
        { tool: "Edit", sessionID: "sess-multi", callID: "call-3" },
        { title: "Edit", output: "edited file multi-edit.ts", metadata: {} },
      )

      const checkpointsDir = join(projectDir, ".sisyphus", "checkpoints")
      const files = readdirSync(checkpointsDir).sort()
      expect(files).toHaveLength(3)

      // Check each checkpoint captures the content at the time of the edit
      const cp1 = JSON.parse(readFileSync(join(checkpointsDir, files[0]), "utf-8"))
      expect(cp1.content).toBe("") // File didn't exist yet

      const cp2 = JSON.parse(readFileSync(join(checkpointsDir, files[1]), "utf-8"))
      expect(cp2.content).toBe("version-1") // Captured before second edit

      const cp3 = JSON.parse(readFileSync(join(checkpointsDir, files[2]), "utf-8"))
      expect(cp3.content).toBe("version-2") // Captured before third edit
    })

    it("should handle large file content", async () => {
      const largeContent = "x".repeat(100_000)
      const srcFile = join(projectDir, "large.ts")
      writeFileSync(srcFile, largeContent, "utf-8")

      hook = createCheckpointUndoHook({ directory: projectDir })

      await hook["tool.execute.before"]!(
        { tool: "Edit", sessionID: "sess-large", callID: "call-large" },
        { args: { filePath: "large.ts" } },
      )
      await hook["tool.execute.after"]!(
        { tool: "Edit", sessionID: "sess-large", callID: "call-large" },
        { title: "Edit", output: "edited file large.ts", metadata: {} },
      )

      const checkpointsDir = join(projectDir, ".sisyphus", "checkpoints")
      const checkpoint = JSON.parse(readFileSync(join(checkpointsDir, "sess-large_call-large.json"), "utf-8"))
      expect(checkpoint.content).toBe(largeContent)
      expect(checkpoint.content.length).toBe(100_000)
    })

    it("should ignore non-edit tools", async () => {
      hook = createCheckpointUndoHook({ directory: projectDir })

      await hook["tool.execute.before"]!(
        { tool: "Read", sessionID: "sess-ignore", callID: "call-read" },
        { args: { filePath: "some-file.ts" } },
      )

      await hook["tool.execute.after"]!(
        { tool: "Read", sessionID: "sess-ignore", callID: "call-read" },
        { title: "Read", output: "file contents here", metadata: {} },
      )

      const checkpointsDir = join(projectDir, ".sisyphus", "checkpoints")
      if (existsSync(checkpointsDir)) {
        expect(readdirSync(checkpointsDir)).toHaveLength(0)
      }
    })
  })

  describe("without directory configured (no-op mode)", () => {
    let hook: ReturnType<typeof createCheckpointUndoHook>

    beforeEach(() => {
      hook = createCheckpointUndoHook() // No directory
    })

    it("should register pending snapshot but not write to disk", async () => {
      await hook["tool.execute.before"]!(
        { tool: "hashline_edit", sessionID: "sess-1", callID: "call-1" },
        { args: { filePath: "src/foo.ts" } },
      )

      await hook["tool.execute.after"]!(
        { tool: "hashline_edit", sessionID: "sess-1", callID: "call-1" },
        { title: "Edit result", output: "edited file src/foo.ts", metadata: {} },
      )

      // No error, no disk writes since no directory
    })

    it("should handle edit tool completion with file path from output text", async () => {
      await hook["tool.execute.before"]!(
        { tool: "Edit", sessionID: "sess-1", callID: "call-4" },
        { args: {} },
      )

      await hook["tool.execute.after"]!(
        { tool: "Edit", sessionID: "sess-1", callID: "call-4" },
        { title: "Edit result", output: "edited file src/bar.ts", metadata: {} },
      )
      // No error
    })

    it("should skip when no pending snapshot exists", async () => {
      await hook["tool.execute.after"]!(
        { tool: "Write", sessionID: "sess-1", callID: "call-no-pending" },
        { title: "Write result", output: "wrote file.ts", metadata: {} },
      )
      // No error = gracefully skipped
    })

    it("should skip when file path cannot be extracted", async () => {
      await hook["tool.execute.before"]!(
        { tool: "hashline_edit", sessionID: "sess-1", callID: "call-no-path" },
        { args: {} },
      )

      await hook["tool.execute.after"]!(
        { tool: "hashline_edit", sessionID: "sess-1", callID: "call-no-path" },
        { title: "Edit result", output: "done", metadata: {} },
      )
      // No error
    })
  })

  describe("event handler", () => {
    let tempDir: string
    let hook: ReturnType<typeof createCheckpointUndoHook>

    beforeEach(() => {
      tempDir = makeTempDir("events")
    })

    afterEach(() => {
      rmSync(tempDir, { recursive: true, force: true })
    })

    it("should clean up pending snapshots on session.deleted", async () => {
      hook = createCheckpointUndoHook({ directory: tempDir })

      await hook["tool.execute.before"]!(
        { tool: "hashline_edit", sessionID: "sess-del", callID: "call-del" },
        { args: { filePath: "test.ts" } },
      )

      await hook.event!({ event: { type: "session.deleted", properties: { info: { id: "sess-del" } } } })

      // Pending snapshot should be cleaned up (no error on subsequent after call)
      await hook["tool.execute.after"]!(
        { tool: "hashline_edit", sessionID: "sess-del", callID: "call-del" },
        { title: "Edit", output: "edited file test.ts", metadata: {} },
      )
      // No error = pending snapshot was cleaned up, after handler found no pending
    })

    it("should not clean up unrelated sessions (prefix collision check)", async () => {
      hook = createCheckpointUndoHook({ directory: tempDir })

      const src1 = join(tempDir, "sess-1.ts")
      const src12 = join(tempDir, "sess-12.ts")
      writeFileSync(src1, "content-1", "utf-8")
      writeFileSync(src12, "content-12", "utf-8")

      await hook["tool.execute.before"]!(
        { tool: "hashline_edit", sessionID: "sess-1", callID: "call-a" },
        { args: { filePath: "sess-1.ts" } },
      )
      await hook["tool.execute.before"]!(
        { tool: "hashline_edit", sessionID: "sess-12", callID: "call-b" },
        { args: { filePath: "sess-12.ts" } },
      )

      // Delete sess-1 — should NOT affect sess-12
      await hook.event!({ event: { type: "session.deleted", properties: { info: { id: "sess-1" } } } })

      // sess-12's pending snapshot should still work
      await hook["tool.execute.after"]!(
        { tool: "hashline_edit", sessionID: "sess-12", callID: "call-b" },
        { title: "Edit", output: "edited file sess-12.ts", metadata: {} },
      )

      // Verify sess-12 got its checkpoint
      const checkpointsDir = join(tempDir, ".sisyphus", "checkpoints")
      const files = readdirSync(checkpointsDir)
      expect(files).toHaveLength(1)
      expect(files[0]).toBe("sess-12_call-b.json")

      const cp = JSON.parse(readFileSync(join(checkpointsDir, files[0]), "utf-8"))
      expect(cp.content).toBe("content-12")
    })

    it("should ignore other event types", async () => {
      hook = createCheckpointUndoHook({ directory: tempDir })
      await hook.event!({ event: { type: "session.created", properties: {} } })
      // No error
    })

    it("should handle session.deleted with no session id gracefully", async () => {
      hook = createCheckpointUndoHook({ directory: tempDir })
      await hook.event!({ event: { type: "session.deleted", properties: {} } })
      // No error
    })
  })
})
