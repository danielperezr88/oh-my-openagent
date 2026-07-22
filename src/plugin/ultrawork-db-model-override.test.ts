import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test"
import { Database } from "bun:sqlite"
import { mkdtempSync, mkdirSync, rmSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"

// Module-level mocks — validated pattern for Windows Bun
// mock() creates tracked mock functions; mock.module() replaces module factories.
// Must be declared BEFORE the await import() so they take effect.
const mockGetDataDir = mock(() => "")
const mockLog = mock((..._args: unknown[]) => {})

mock.module("../shared/data-path", () => ({
  getDataDir: mockGetDataDir,
}))

mock.module("../shared", () => ({
  log: mockLog,
}))

// Module-level import (no cache busting — validated pattern for Windows Bun)
const { scheduleDeferredModelOverride } = await import("./ultrawork-db-model-override")

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

function formatLogCalls(calls: readonly (readonly unknown[])[]): string {
  return calls.map((call: readonly unknown[]) => `${String(call[0])} ${JSON.stringify(call[1])}`).join("\n")
}

describe("scheduleDeferredModelOverride", () => {
  let tempDir: string
  let dbPath: string

  beforeEach(async () => {
    mockGetDataDir.mockClear()
    mockLog.mockClear()

    tempDir = mkdtempSync(join(tmpdir(), "ultrawork-db-test-"))
    const opencodePath = join(tempDir, "opencode")
    mkdirSync(opencodePath, { recursive: true })
    dbPath = join(opencodePath, "opencode.db")

    const db = new Database(dbPath)
    db.run(`
      CREATE TABLE IF NOT EXISTS message (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        time_created TEXT NOT NULL DEFAULT (datetime('now')),
        time_updated TEXT NOT NULL DEFAULT (datetime('now')),
        data TEXT NOT NULL DEFAULT '{}'
      )
    `)
    db.close()

    mockGetDataDir.mockImplementation(() => tempDir)
    mockLog.mockImplementation(() => {})
  })

  afterEach(async () => {
    // Allow any pending microtasks/setTimeout from scheduleDeferredModelOverride to settle
    await new Promise<void>((resolve) => setTimeout(resolve, 20))
    try {
      rmSync(tempDir, { recursive: true, force: true })
    } catch {
      // EBUSY on Windows — temp dir locked by SQLite or Bun
    }
  })

  function insertMessage(id: string, model: { providerID: string; modelID: string }) {
    const db = new Database(dbPath)
    db.run(
      `INSERT INTO message (id, session_id, data) VALUES (?, ?, ?)`,
      [id, "ses_test", JSON.stringify({ model })],
    )
    db.close()
  }

  function readMessageModel(id: string): { providerID: string; modelID: string } | null {
    const db = new Database(dbPath)
    const row = db.query(`SELECT data FROM message WHERE id = ?`).get(id) as
      | { data: string }
      | null
    db.close()
    if (!row) return null
    const parsed = JSON.parse(row.data)
    return parsed.model ?? null
  }

  function readMessageField(id: string, field: string): unknown {
    const db = new Database(dbPath)
    const row = db.query(`SELECT data FROM message WHERE id = ?`).get(id) as
      | { data: string }
      | null
    db.close()
    if (!row) return null
    return JSON.parse(row.data)[field] ?? null
  }

  async function waitForLogCall(
    description: string,
    predicate: (message: unknown, metadata: unknown) => boolean,
  ): Promise<void> {
    const deadline = Date.now() + 2_000
    while (Date.now() < deadline) {
      if (mockLog.mock.calls.some((call: readonly unknown[]) => predicate(call[0], call[1]))) {
        return
      }
      await new Promise<void>((resolve) => setTimeout(resolve, 5))
    }

    throw new Error(`Timed out waiting for log call: ${description}\n${formatLogCalls(mockLog.mock.calls)}`)
  }

  test("should update model in DB after microtask flushes", async () => {
    //#given
    insertMessage("msg_001", { providerID: "anthropic", modelID: "claude-sonnet-4-6" })

    //#when
    scheduleDeferredModelOverride(
      "msg_001",
      { providerID: "anthropic", modelID: "claude-opus-4-7" },
    )
    // scheduleDeferredModelOverride uses queueMicrotask + async importBunSqlite(),
    // so the DB update needs event loop ticks to settle
    await new Promise<void>((resolve) => setTimeout(resolve, 20))

    //#then
    const model = readMessageModel("msg_001")
    expect(model).toEqual({ providerID: "anthropic", modelID: "claude-opus-4-7" })
  })

  test("should update variant and thinking fields when variant provided", async () => {
    //#given
    insertMessage("msg_002", { providerID: "anthropic", modelID: "claude-sonnet-4-6" })

    //#when
    scheduleDeferredModelOverride(
      "msg_002",
      { providerID: "anthropic", modelID: "claude-opus-4-7" },
      "max",
    )
    await new Promise<void>((resolve) => setTimeout(resolve, 20))

    //#then
    expect(readMessageField("msg_002", "variant")).toBe("max")
    expect(readMessageField("msg_002", "thinking")).toBe("max")
  })

  test("should fall back to setTimeout when message never appears", async () => {
    //#given no message inserted

    //#when
    scheduleDeferredModelOverride(
      "msg_nonexistent",
      { providerID: "anthropic", modelID: "claude-opus-4-7" },
    )
    await waitForLogCall("setTimeout fallback failure for msg_nonexistent", (message, metadata) => (
      typeof message === "string"
      && message.includes("setTimeout fallback failed")
      && isRecord(metadata)
      && metadata.messageId === "msg_nonexistent"
    ))

    //#then
    const fallbackFailureCall = mockLog.mock.calls.find((call: readonly unknown[]) => {
      const message = call[0]
      const metadata = call[1]
      return (
        typeof message === "string"
        && message.includes("setTimeout fallback failed")
        && isRecord(metadata)
        && metadata.messageId === "msg_nonexistent"
      )
    })
    expect(fallbackFailureCall).toBeDefined()
  })

  test("should log when microtask retries are exhausted before setTimeout fallback", async () => {
    //#given no message inserted

    //#when
    scheduleDeferredModelOverride(
      "msg_retry_exhausted",
      { providerID: "anthropic", modelID: "claude-opus-4-7" },
    )
    await waitForLogCall("microtask retry exhaustion for msg_retry_exhausted", (message, metadata) => (
      message === "[ultrawork-db-override] Exhausted microtask retries, falling back to setTimeout"
      && isRecord(metadata)
      && metadata.messageId === "msg_retry_exhausted"
      && metadata.attempt === 10
    ))

    //#then
    const retryExhaustedCall = mockLog.mock.calls.find((call: readonly unknown[]) => {
      const message = call[0]
      const metadata = call[1]
      return (
        message === "[ultrawork-db-override] Exhausted microtask retries, falling back to setTimeout"
        && isRecord(metadata)
        && metadata.messageId === "msg_retry_exhausted"
        && metadata.attempt === 10
      )
    })
    expect(retryExhaustedCall).toBeDefined()
  })

  test("should not update variant fields when variant is undefined", async () => {
    //#given
    insertMessage("msg_003", { providerID: "anthropic", modelID: "claude-sonnet-4-6" })

    //#when
    scheduleDeferredModelOverride(
      "msg_003",
      { providerID: "anthropic", modelID: "claude-opus-4-7" },
    )
    await new Promise<void>((resolve) => setTimeout(resolve, 20))

    //#then
    const model = readMessageModel("msg_003")
    expect(model).toEqual({ providerID: "anthropic", modelID: "claude-opus-4-7" })
    expect(readMessageField("msg_003", "variant")).toBeNull()
    expect(readMessageField("msg_003", "thinking")).toBeNull()
  })

  test("should not crash when DB path does not exist", async () => {
    //#given
    mockGetDataDir.mockImplementation(() => "/nonexistent/path/that/does/not/exist")

    //#when
    scheduleDeferredModelOverride(
      "msg_004",
      { providerID: "anthropic", modelID: "claude-opus-4-7" },
    )
    await waitForLogCall("DB not found for msg_004", (message, _metadata) => (
      typeof message === "string"
      && message.includes("DB not found")
    ))

    //#then
    const dbNotFoundCall = mockLog.mock.calls.find((call: readonly unknown[]) =>
      typeof call[0] === "string" && call[0].includes("DB not found"),
    )
    expect(dbNotFoundCall).toBeDefined()
  })

  test("should log a DB failure when DB file exists but is corrupted", async () => {
    //#given
    const { chmodSync, writeFileSync } = await import("node:fs")
    const corruptedDbPath = join(tempDir, "opencode", "opencode.db")
    writeFileSync(corruptedDbPath, "this is not a valid sqlite database file")
    try {
      chmodSync(corruptedDbPath, 0o000)
    } catch {
      // chmod may throw EPERM on Windows — file content is already invalid for SQLite
    }

    //#when
    scheduleDeferredModelOverride(
      "msg_corrupt",
      { providerID: "anthropic", modelID: "claude-opus-4-7" },
    )
    await waitForLogCall("DB open failure for msg_corrupt", (message, metadata) => (
      typeof message === "string"
      && (
        message.includes("Failed to open DB")
        || message.includes("Deferred DB update failed with error")
      )
      && isRecord(metadata)
      && metadata.messageId === "msg_corrupt"
    ))

    //#then
    const failureCall = mockLog.mock.calls.find((call: readonly unknown[]) => {
      const message = call[0]
      const metadata = call[1]
      return (
        typeof message === "string"
        && (
          message.includes("Failed to open DB")
          || message.includes("Deferred DB update failed with error")
        )
        && isRecord(metadata)
        && metadata.messageId === "msg_corrupt"
      )
    })

    expect(failureCall).toBeDefined()
  })
})