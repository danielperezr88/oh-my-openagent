import { readFile, writeFile, mkdir, readdir, unlink } from "node:fs/promises"
import { isAbsolute, join } from "node:path"
import { log } from "../../shared/logger"

export interface CheckpointUndoOptions {
  /** Project root directory for storing checkpoints */
  directory?: string
  /** Directory name for checkpoints (default: .sisyphus/checkpoints) */
  checkpointsDir?: string
  /** Maximum checkpoints per session (default: 20) */
  maxCheckpoints?: number
}

interface Checkpoint {
  filePath: string
  content: string
  timestamp: number
  sessionID: string
  callID: string
}

const EDIT_TOOLS = new Set([
  "hashline_edit",
  "Write",
  "write",
  "Edit",
  "edit",
  "file_edit",
  "safe_write",
])

/**
 * Extract file path from tool arguments using the common key patterns.
 */
function getFilePathFromArgs(args: Record<string, unknown>): string | undefined {
  const filePath = args?.filePath ?? args?.path ?? args?.file_path
  return typeof filePath === "string" && filePath.length > 0 ? filePath : undefined
}

/**
 * Resolve a potentially relative path against a base directory.
 */
function resolveFilePath(baseDir: string, filePath: string): string {
  if (isAbsolute(filePath)) return filePath
  return join(baseDir, filePath)
}

/**
 * Checkpoint-based undo hook.
 *
 * Creates pre-edit file snapshots before file modifications, complementing
 * hashline's corruption prevention with a safety net for reverting valid
 * but incorrect edits. Snapshots are stored in .sisyphus/checkpoints/.
 *
 * Uses tool.execute.before to capture file state before edits,
 * and tool.execute.after to persist checkpoints to disk.
 */
export function createCheckpointUndoHook(options?: CheckpointUndoOptions) {
  const directory = options?.directory ?? ""
  const checkpointsDirName = options?.checkpointsDir ?? ".sisyphus/checkpoints"
  const maxCheckpoints = options?.maxCheckpoints ?? 20
  const pendingSnapshots = new Map<string, Checkpoint>()

  const getCheckpointsDir = () => directory ? join(directory, checkpointsDirName) : ""

  const toolExecuteBefore = async (
    input: { tool: string; sessionID: string; callID: string },
    output: { args: Record<string, unknown> },
  ) => {
    if (!EDIT_TOOLS.has(input.tool)) return

    const snapshotKey = `${input.sessionID}:${input.callID}`
    const filePath = getFilePathFromArgs(output.args)

    let content = ""
    if (filePath && directory) {
      const absolutePath = resolveFilePath(directory, filePath)
      try {
        content = await readFile(absolutePath, "utf-8")
      } catch {
        // File doesn't exist yet (new file being created) — that's fine,
        // empty content means "this file didn't exist before the edit"
        content = ""
      }
    }

    pendingSnapshots.set(snapshotKey, {
      filePath: filePath ?? "",
      content,
      timestamp: Date.now(),
      sessionID: input.sessionID,
      callID: input.callID,
    })
  }

  const toolExecuteAfter = async (
    input: { tool: string; sessionID: string; callID: string },
    output: { title: string; output: string; metadata: unknown },
  ) => {
    if (!EDIT_TOOLS.has(input.tool)) return

    const snapshotKey = `${input.sessionID}:${input.callID}`
    const pending = pendingSnapshots.get(snapshotKey)
    if (!pending) return
    pendingSnapshots.delete(snapshotKey)

    // If we already captured the file path from args in toolExecuteBefore, use it.
    // Otherwise, try to extract from output.
    let filePath: string | undefined = pending.filePath || undefined
    if (!filePath) {
      const metadata = output.metadata as Record<string, unknown> | undefined
      filePath = (metadata?.filePath ?? metadata?.file_path ?? metadata?.path) as string | undefined
        ?? extractFilePathFromOutput(output.output)
    }

    if (!filePath) return

    // Only save if we have a directory configured and captured pre-edit content
    if (!directory) {
      log("[checkpoint-undo] No directory configured, skipping checkpoint save", {
        sessionID: input.sessionID,
        filePath,
      })
      return
    }

    try {
      const checkpoint: Checkpoint = {
        filePath,
        content: pending.content,
        timestamp: pending.timestamp,
        sessionID: input.sessionID,
        callID: input.callID,
      }

      await saveCheckpoint(input.sessionID, checkpoint)
    } catch (error) {
      log("[checkpoint-undo] Failed to save checkpoint", {
        sessionID: input.sessionID,
        filePath,
        error: String(error),
      })
    }
  }

  const saveCheckpoint = async (sessionID: string, checkpoint: Checkpoint) => {
    const checkpointsDir = getCheckpointsDir()
    if (!checkpointsDir) return

    await mkdir(checkpointsDir, { recursive: true })

    const filename = `${sessionID}_${checkpoint.callID}.json`
    const checkpointPath = join(checkpointsDir, filename)

    await writeFile(checkpointPath, JSON.stringify({
      filePath: checkpoint.filePath,
      content: checkpoint.content,
      timestamp: checkpoint.timestamp,
      sessionID: checkpoint.sessionID,
      callID: checkpoint.callID,
    }, null, 2), "utf-8")

    log("[checkpoint-undo] Checkpoint saved", {
      sessionID,
      filePath: checkpoint.filePath,
      callID: checkpoint.callID,
      path: checkpointPath,
    })

    // Enforce max checkpoints per session
    await enforceMaxCheckpoints(sessionID)
  }

  const enforceMaxCheckpoints = async (sessionID: string) => {
    const checkpointsDir = getCheckpointsDir()
    if (!checkpointsDir) return

    try {
      const files = await readdir(checkpointsDir)
      const sessionFiles = files
        .filter(f => f.startsWith(`${sessionID}_`) && f.endsWith(".json"))
        .sort()

      if (sessionFiles.length > maxCheckpoints) {
        const toDelete = sessionFiles.slice(0, sessionFiles.length - maxCheckpoints)
        await Promise.all(
          toDelete.map(f => unlink(join(checkpointsDir, f)).catch(() => {}))
        )
        log("[checkpoint-undo] Cleaned up old checkpoints", {
          sessionID,
          removed: toDelete.length,
        })
      }
    } catch {
      // Directory might not exist yet — ignore
    }
  }

  const deleteSessionCheckpoints = async (sessionID: string) => {
    const checkpointsDir = getCheckpointsDir()
    if (!checkpointsDir) return

    try {
      const files = await readdir(checkpointsDir)
      const sessionFiles = files.filter(f => f.startsWith(`${sessionID}_`) && f.endsWith(".json"))
      await Promise.all(
        sessionFiles.map(f => unlink(join(checkpointsDir, f)).catch(() => {}))
      )
      if (sessionFiles.length > 0) {
        log("[checkpoint-undo] Deleted session checkpoints", {
          sessionID,
          count: sessionFiles.length,
        })
      }
    } catch {
      // Directory might not exist — ignore
    }
  }

  const eventHandler = async ({ event }: { event: { type: string; properties?: unknown } }) => {
    if (event.type === "session.deleted") {
      const props = event.properties as { info?: { id?: string } } | undefined
      const sessionId = props?.info?.id
      if (sessionId) {
        // Clean up pending snapshots for this session (exact match only)
        const prefix = `${sessionId}:`
        for (const key of pendingSnapshots.keys()) {
          if (key.startsWith(prefix)) {
            pendingSnapshots.delete(key)
          }
        }
        // Clean up checkpoint files for this session
        await deleteSessionCheckpoints(sessionId)
      }
    }
  }

  return {
    "tool.execute.before": toolExecuteBefore,
    "tool.execute.after": toolExecuteAfter,
    event: eventHandler,
  }
}

export function extractFilePathFromOutput(output: string): string | undefined {
  // Try common patterns in edit tool output
  const patterns = [
    /(?:edited|modified|wrote|updated)\s+(?:file\s+)?[`"]?([^\s`"]+)[`"]?/i,
    /(?:file|path):\s*([^\s\n]+)/i,
  ]

  for (const pattern of patterns) {
    const match = output.match(pattern)
    if (match?.[1]) return match[1]
  }

  return undefined
}
