import { describe, it, expect, beforeEach, afterEach } from "bun:test"
import { mkdir, readFile, rm } from "node:fs/promises"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { createTranscriptArchivalHook } from "./hook"

describe("createTranscriptArchivalHook", () => {
  let testDir: string

  beforeEach(async () => {
    testDir = join(tmpdir(), `transcript-test-${Date.now()}`)
    await mkdir(testDir, { recursive: true })
  })

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true }).catch(() => {})
  })

  it("should save transcript as JSONL file", async () => {
    const hook = createTranscriptArchivalHook()
    const messages = [
      { role: "user", content: "Hello" },
      { role: "assistant", content: "Hi there" },
      { role: "user", content: "Do something" },
    ]

    await hook.saveTranscript(testDir, "sess-abc123def", messages)

    const transcriptsDir = join(testDir, ".sisyphus/transcripts")
    const { readdir } = await import("node:fs/promises")
    const files = await readdir(transcriptsDir)

    expect(files.length).toBe(1)
    expect(files[0]).toMatch(/^transcript_sess-abc_.*\.jsonl$/)

    const content = await readFile(join(transcriptsDir, files[0]), "utf-8")
    const lines = content.trim().split("\n")
    expect(lines.length).toBe(3)

    const first = JSON.parse(lines[0])
    expect(first.role).toBe("user")
    expect(first.content).toBe("Hello")
  })

  it("should use custom transcripts directory", async () => {
    const hook = createTranscriptArchivalHook({ transcriptsDir: ".custom/transcripts" })
    const messages = [{ role: "user", content: "test" }]

    await hook.saveTranscript(testDir, "sess-xyz", messages)

    const customDir = join(testDir, ".custom/transcripts")
    const { readdir } = await import("node:fs/promises")
    const files = await readdir(customDir)
    expect(files.length).toBe(1)
  })

  it("should truncate long content to 10000 chars", async () => {
    const hook = createTranscriptArchivalHook()
    const longContent = "x".repeat(15000)
    const messages = [{ role: "user", content: longContent }]

    await hook.saveTranscript(testDir, "sess-long", messages)

    const transcriptsDir = join(testDir, ".sisyphus/transcripts")
    const { readdir } = await import("node:fs/promises")
    const files = await readdir(transcriptsDir)
    const content = await readFile(join(transcriptsDir, files[0]), "utf-8")
    const first = JSON.parse(content.trim())
    expect(first.content.length).toBe(10000)
  })

  it("should handle empty messages gracefully", async () => {
    const hook = createTranscriptArchivalHook()
    await hook.saveTranscript(testDir, "sess-empty", [])

    const transcriptsDir = join(testDir, ".sisyphus/transcripts")
    const { readdir } = await import("node:fs/promises")
    // Should not create directory or file for empty messages
    const files = await readdir(transcriptsDir).catch(() => [])
    expect(files.length).toBe(0)
  })

  it("should handle missing directory gracefully", async () => {
    const hook = createTranscriptArchivalHook()
    // Should not throw
    await hook.saveTranscript("", "sess-1", [{ role: "user", content: "test" }])
    await hook.saveTranscript(testDir, "", [{ role: "user", content: "test" }])
  })
})
