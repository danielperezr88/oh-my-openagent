import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { mkdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { resolveFilePath, resolveFileReferencesInText } from "./file-reference-resolver"

const isWindows = process.platform === "win32"

/** Normalize path separators and strip Windows drive prefixes for cross-platform assertions */
function normalizePath(p: string): string {
  return p.replace(/\\/g, "/").replace(/[A-Za-z]:(?=\/)/g, "")
}

describe("resolveFilePath", () => {
  const cwd = "/skills/gsd"
  const originalHome = process.env.HOME
  const homeDir = process.env.HOME ?? process.env.USERPROFILE ?? ""

  beforeAll(() => {
    // On Windows, HOME is not set by default; alias it to USERPROFILE
    if (!process.env.HOME && process.env.USERPROFILE) {
      process.env.HOME = process.env.USERPROFILE
    }
  })

  afterAll(() => {
    // Restore original HOME value
    if (originalHome === undefined) {
      delete process.env.HOME
    } else {
      process.env.HOME = originalHome
    }
  })

  test("expands bare environment variables before resolving absolute paths", () => {
    //#given
    const home = process.env.HOME ?? process.env.USERPROFILE ?? ""
    if (!home) {
      throw new Error("HOME or USERPROFILE must be set for file reference resolver tests")
    }

    //#when
    const resolved = resolveFilePath("$HOME/foo.md", cwd)

    //#then
    expect(normalizePath(resolved)).toBe(normalizePath(resolve(home, "foo.md")))
  })

  test("expands braced environment variables before resolving absolute paths", () => {
    //#given
    const home = process.env.HOME ?? process.env.USERPROFILE ?? ""
    if (!home) {
      throw new Error("HOME or USERPROFILE must be set for file reference resolver tests")
    }

    //#when
    const resolved = resolveFilePath("${HOME}/foo.md", cwd)

    //#then
    expect(normalizePath(resolved)).toBe(normalizePath(resolve(home, "foo.md")))
  })

  test("keeps absolute paths absolute", () => {
    //#given
    const absolutePath = "/abs/path.md"

    //#when
    const resolved = resolveFilePath(absolutePath, cwd)

    //#then
    expect(normalizePath(resolved)).toBe(normalizePath(resolve(absolutePath)))
  })

  test("resolves relative paths from cwd", () => {
    //#given
    const relativePath = "relative/path.md"

    //#when
    const resolved = resolveFilePath(relativePath, cwd)

    //#then
    expect(normalizePath(resolved)).toBe(normalizePath(resolve(cwd, relativePath)))
  })
})

describe.skipIf(isWindows)("resolveFileReferencesInText", () => {
  const fixtureRoot = join(tmpdir(), `file-reference-resolver-${Date.now()}`)
  const workspaceDir = join(fixtureRoot, "workspace")
  const notesDir = join(workspaceDir, "notes")
  const allowedFilePath = join(notesDir, "allowed.txt")
  const linkedSecretPath = join(notesDir, "linked-secret.txt")
  const outsideFilePath = join(fixtureRoot, "secret.txt")

  beforeAll(() => {
    mkdirSync(notesDir, { recursive: true })
    writeFileSync(allowedFilePath, "allowed-content", "utf8")
    writeFileSync(outsideFilePath, "secret-content", "utf8")
    symlinkSync(outsideFilePath, linkedSecretPath)
  })

  afterAll(() => {
    rmSync(fixtureRoot, { recursive: true, force: true })
  })

  test("resolves file references within cwd", async () => {
    //#given
    const input = "Read @notes/allowed.txt before continuing"

    //#when
    const resolved = await resolveFileReferencesInText(input, workspaceDir)

    //#then
    expect(resolved).toContain("allowed-content")
  })

  test("rejects traversal references that escape cwd", async () => {
    //#given
    const input = "Read @../secret.txt before continuing"

    //#when
    const resolved = await resolveFileReferencesInText(input, workspaceDir)

    //#then
    expect(resolved).toContain("[path rejected:")
    expect(resolved).not.toContain("secret-content")
  })

  test("rejects absolute references outside cwd", async () => {
    //#given
    const input = `Read @${outsideFilePath} before continuing`

    //#when
    const resolved = await resolveFileReferencesInText(input, workspaceDir)

    //#then
    expect(resolved).toContain("[path rejected:")
    expect(resolved).not.toContain("secret-content")
  })

  test("rejects symlink references that escape cwd", async () => {
    //#given
    const input = "Read @notes/linked-secret.txt before continuing"

    //#when
    const resolved = await resolveFileReferencesInText(input, workspaceDir)

    //#then
    expect(resolved).toContain("[path rejected:")
    expect(resolved).not.toContain("secret-content")
  })
})
