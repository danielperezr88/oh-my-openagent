import type { createOpencodeClient } from "@opencode-ai/sdk"
import { log } from "../../shared/logger"

type Client = ReturnType<typeof createOpencodeClient>

type RecoveryMessageData = {
  info?: { id?: string; role?: string }
  parts?: Array<{ type: string; text?: string }>
}

/**
 * Recovery for DeepSeek's "reasoning_content must be passed back" error.
 *
 * Root cause: OpenCode occasionally fails to persist `reasoning_content` from
 * DeepSeek's intermediate assistant messages (those with tool_calls). DeepSeek
 * requires ALL intermediate assistant messages to include `reasoning_content`
 * if any earlier message had it.
 *
 * Recovery strategy: Find the assistant message missing reasoning (root cause),
 * then insert a reasoning part directly into the database via SQLite.
 */
export async function recoverDeepSeekReasoningContent(
  client: Client,
  sessionID: string,
  _failedAssistantMsg: RecoveryMessageData,
  allMessages?: RecoveryMessageData[],
): Promise<boolean> {
  if (!allMessages || allMessages.length === 0) {
    log("[session-recovery] recoverDeepSeekReasoningContent: no messages to scan", { sessionID })
    return false
  }

  // Walk messages in reverse to find the last assistant message that has
  // tool parts but is missing a reasoning part — that's the root cause.
  let rootCauseID: string | undefined

  for (let i = allMessages.length - 1; i >= 0; i--) {
    const msg = allMessages[i]
    if (msg.info?.role !== "assistant") continue

    const parts = msg.parts ?? []
    const hasTool = parts.some(
      (p: { type: string }) => p.type === "tool" || p.type === "tool_use",
    )
    if (!hasTool) continue

    const hasReasoning = parts.some((p: { type: string }) => p.type === "reasoning")
    if (!hasReasoning) {
      rootCauseID = msg.info?.id
      break
    }
  }

  if (!rootCauseID) {
    log("[session-recovery] recoverDeepSeekReasoningContent: could not find root cause message", { sessionID })
    return false
  }

  log("[session-recovery] recoverDeepSeekReasoningContent: patching root cause message", {
    sessionID,
    rootCauseID,
  })

  try {
    // Fetch full message history from SDK to find fallback reasoning text.
    const messagesResp = await client.session.messages({
      path: { id: sessionID },
    })
    const msgs = (messagesResp as { data?: Array<{ info?: { id?: string; role?: string }; parts?: Array<{ type: string; text?: string }> }> }).data ?? []

    let fallbackReasoningText: string | undefined
    for (const m of msgs) {
      if (m.info?.id === rootCauseID) continue
      if (m.info?.role !== "assistant") continue
      const reasoningPart = m.parts?.find((p) => p.type === "reasoning")
      if (reasoningPart?.text) {
        fallbackReasoningText = reasoningPart.text
        break
      }
    }

    // DeepSeek just needs reasoning_content to be present — use a placeholder if no real text found
    if (!fallbackReasoningText) {
      fallbackReasoningText = "[reasoning preserved for API compatibility]"
      log("[session-recovery] recoverDeepSeekReasoningContent: using placeholder reasoning text", { sessionID, rootCauseID })
    }

    // Insert reasoning part via direct SQLite with retry.
    // SQLITE_MISUSE can happen when OpenCode has the DB locked during active operations.
    const inserted = await insertReasoningPartWithRetry(sessionID, rootCauseID, fallbackReasoningText)

    if (!inserted) {
      log("[session-recovery] recoverDeepSeekReasoningContent: all SQLite attempts failed", { sessionID, rootCauseID })
      return false
    }

    log("[session-recovery] recoverDeepSeekReasoningContent: reasoning part inserted", {
      sessionID,
      rootCauseID,
      reasoningLength: fallbackReasoningText.length,
    })
    return true
  } catch (error) {
    log("[session-recovery] recoverDeepSeekReasoningContent: failed", {
      sessionID,
      rootCauseID,
      error: String(error),
    })
    return false
  }
}

const MAX_RETRIES = 3
const RETRY_DELAY_MS = 500

async function insertReasoningPartWithRetry(
  sessionID: string,
  messageID: string,
  text: string,
): Promise<boolean> {
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      return insertReasoningPart(sessionID, messageID, text)
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error)
      log("[session-recovery] recoverDeepSeekReasoningContent: SQLite attempt failed", {
        attempt,
        messageID,
        error: msg,
      })
      if (attempt < MAX_RETRIES) {
        await new Promise((r) => setTimeout(r, RETRY_DELAY_MS * attempt))
      }
    }
  }
  return false
}

function insertReasoningPart(
  sessionID: string,
  messageID: string,
  text: string,
): boolean {
  // Dynamic import to avoid bundling issues
  const { Database } = require("bun:sqlite") as typeof import("bun:sqlite")
  const { homedir } = require("os") as typeof import("os")
  const dbPath = homedir() + "/.local/share/opencode/opencode.db"

  const db = new Database(dbPath)

  try {
    const now = Date.now()
    const partID = "prt_rcvry_" + Math.random().toString(36).substring(2, 15)
    const partData = JSON.stringify({
      type: "reasoning",
      text,
      time: { start: now, end: now },
    })

    db.prepare(
      "INSERT INTO part (id, message_id, session_id, time_created, time_updated, data) VALUES (?, ?, ?, ?, ?, ?)"
    ).run(partID, messageID, sessionID, now, now, partData)

    log("[session-recovery] recoverDeepSeekReasoningContent: inserted part", {
      partID,
      messageID,
      length: text.length,
    })
    return true
  } finally {
    db.close()
  }
}
