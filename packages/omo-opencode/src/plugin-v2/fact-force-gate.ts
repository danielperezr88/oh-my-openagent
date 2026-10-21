import type { Plugin } from "@opencode/plugin"
import { existsSync } from "fs"
import { isAbsolute, resolve } from "path"
import { log } from "../shared/logger"

const READ_TOOLS = new Set(["read", "glob", "grep"])
const EDIT_TOOLS = new Set(["edit", "write", "hashline_edit", "file_edit", "safe_write"])
const MAX_TRACKED_SESSIONS = 512

export function extractFilePath(args: Record<string, unknown>): string | undefined {
  const raw = args.filePath ?? args.path ?? args.file_path ?? args.file
  return typeof raw === "string" && raw.length > 0 ? raw : undefined
}

/**
 * Tracks which files each session has read, and reports edits to unread files.
 * Extracted from the V1 fact-force-gate hook so the policy is unit-testable
 * without a plugin context.
 */
export function createReadTracker() {
  const readFiles = new Map<string, Set<string>>()

  function sessionSet(sessionID: string): Set<string> {
    let set = readFiles.get(sessionID)
    if (!set) {
      if (readFiles.size >= MAX_TRACKED_SESSIONS) {
        const oldest = readFiles.keys().next().value
        if (oldest) readFiles.delete(oldest)
      }
      set = new Set()
      readFiles.set(sessionID, set)
    }
    return set
  }

  function forgetSession(sessionID: string): void {
    readFiles.delete(sessionID)
  }

  function observe(tool: string, sessionID: string, filePath: string | undefined, fileExists: boolean): string | null {
    if (READ_TOOLS.has(tool)) {
      if (filePath) sessionSet(sessionID).add(filePath)
      return null
    }
    if (!EDIT_TOOLS.has(tool)) return null
    if (!filePath) return null
    if (!fileExists) return null

    const seen = readFiles.get(sessionID)
    if (!seen || !seen.has(filePath)) {
      return `Read ${filePath} before editing. Understand the context first.`
    }
    return null
  }

  return { observe, forgetSession }
}

export function registerFactForceGate(ctx: Plugin.Context): void {
  const tracker = createReadTracker()
  const projectDirectory = ctx.location.directory

  void ctx.tool.hook("execute.before", (event) => {
    const input = event.input as Record<string, unknown> | undefined
    const filePath = input ? extractFilePath(input) : undefined
    const absolute = filePath ? (isAbsolute(filePath) ? filePath : resolve(projectDirectory, filePath)) : undefined
    const reason = tracker.observe(event.tool, event.sessionID, filePath, absolute ? existsSync(absolute) : false)
    if (reason) {
      log(`[plugin-v2/fact-force-gate] Blocked edit to ${filePath} without prior read`)
      throw new Error(reason)
    }
  })
}
