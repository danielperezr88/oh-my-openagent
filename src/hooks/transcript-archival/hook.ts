import { mkdir, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { log } from "../../shared/logger"

export interface TranscriptArchivalOptions {
  /** Base directory for transcript storage (default: .sisyphus/transcripts) */
  transcriptsDir?: string
}

interface TranscriptMessage {
  role: string
  content: string
  timestamp?: string
  [key: string]: unknown
}

/**
 * Save a transcript of messages to disk before compaction.
 * Each message is written as a JSON line in a JSONL file.
 * File naming: transcript_{sessionId}_{timestamp}.jsonl
 */
export function createTranscriptArchivalHook(options?: TranscriptArchivalOptions) {
  const transcriptsDirName = options?.transcriptsDir ?? ".sisyphus/transcripts"

  return {
    saveTranscript: async (
      directory: string,
      sessionID: string,
      messages: TranscriptMessage[]
    ): Promise<void> => {
      if (!directory || !sessionID || messages.length === 0) return

      try {
        const transcriptsDir = join(directory, transcriptsDirName)
        await mkdir(transcriptsDir, { recursive: true })

        const timestamp = new Date().toISOString().replace(/[:.]/g, "-")
        const filename = `transcript_${sessionID.slice(0, 8)}_${timestamp}.jsonl`
        const filepath = join(transcriptsDir, filename)

        const lines = messages.map((msg) => JSON.stringify({
          role: msg.role,
          content: typeof msg.content === "string" ? msg.content.slice(0, 10000) : String(msg.content).slice(0, 10000),
          timestamp: msg.timestamp ?? new Date().toISOString(),
        }))

        await writeFile(filepath, lines.join("\n") + "\n", "utf-8")

        log("[transcript-archival] Saved transcript", {
          sessionID,
          messageCount: messages.length,
          filepath,
        })
      } catch (error) {
        log("[transcript-archival] Failed to save transcript", {
          sessionID,
          error: String(error),
        })
      }
    },
  }
}

/**
 * Creates a compaction handler that archives the transcript before compaction.
 * Extracts the inline archival logic from src/index.ts into a reusable handler.
 */
export function createTranscriptArchivalCompactionHandler(archival: {
  saveTranscript: (directory: string, sessionID: string, messages: TranscriptMessage[]) => Promise<void>
}) {
  return async (
    ctx: { directory: string; client: { session: { messages: (args: { path: { id: string } }) => Promise<unknown> } } },
    input: { sessionID: string },
  ): Promise<void> => {
    try {
      const messagesResp = await ctx.client.session.messages({ path: { id: input.sessionID } })
      const messages = (messagesResp as { data?: unknown[] })?.data ?? []
      if (Array.isArray(messages)) {
        await archival.saveTranscript(ctx.directory, input.sessionID, messages as TranscriptMessage[])
      }
    } catch (err) {
      log("[transcript-archival] Failed to save before compaction", { sessionID: input.sessionID, error: String(err) })
    }
  }
}
