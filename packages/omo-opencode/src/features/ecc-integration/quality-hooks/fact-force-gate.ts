import type { Hooks } from "@opencode-ai/plugin"
import { log } from "../../../shared/logger"

type ToolExecuteInput = { tool: string; sessionID: string; callID: string }
type ToolExecuteBeforeOutput = { args: Record<string, unknown> }

const READ_TOOLS = ["read", "glob", "grep"]
const EDIT_TOOLS = ["edit", "write", "ast_grep_replace"]
const MAX_TRACKED = 512

export function createFactForceGateHook(): Hooks {
  const readFiles = new Map<string, Set<string>>()

  function getSessionSet(sessionID: string): Set<string> {
    let set = readFiles.get(sessionID)
    if (!set) {
      if (readFiles.size >= MAX_TRACKED) {
        const oldest = readFiles.keys().next().value
        if (oldest) readFiles.delete(oldest)
      }
      set = new Set()
      readFiles.set(sessionID, set)
    }
    return set
  }

  function extractFilePath(args: Record<string, unknown>): string | undefined {
    const raw = args.filePath ?? args.path ?? args.file_path ?? args.file
    return typeof raw === "string" ? raw : undefined
  }

  return {
    "tool.execute.before": async (input: ToolExecuteInput, output: ToolExecuteBeforeOutput) => {
      if (READ_TOOLS.includes(input.tool)) {
        const filePath = extractFilePath(output.args)
        if (filePath) {
          getSessionSet(input.sessionID).add(filePath)
        }
        return
      }

      if (!EDIT_TOOLS.includes(input.tool)) return

      const filePath = extractFilePath(output.args)
      if (!filePath) return

      const sessionSet = readFiles.get(input.sessionID)
      if (!sessionSet || !sessionSet.has(filePath)) {
        log(`[fact-force-gate] Blocked edit to ${filePath} without prior read`)
        output.args.__blocked = true
        output.args.__block_reason = `Read ${filePath} before editing. Understand the context first.`
      }
    },
    event: async ({ event }: { event: { type: string; properties?: unknown } }) => {
      if (event.type !== "session.deleted") return
      const props = event.properties as { info?: { id?: string } } | undefined
      const sessionID = props?.info?.id
      if (sessionID) readFiles.delete(sessionID)
    },
  }
}
