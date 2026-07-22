import type { Hooks } from "@opencode-ai/plugin"
import { log } from "../../../../shared/logger"
import type { Observation } from "../types"
import { scrubAndTruncate } from "./scrubber"
import { appendObservation, purgeOldObservations } from "./storage"
import { resolveProjectHash } from "../instinct-store/project-resolver"

const TRUNCATE_CHARS = 2000
const PURGE_INTERVAL_MS = 6 * 60 * 60 * 1000
let lastPurge = 0

type ToolExecuteInput = { tool: string; sessionID: string; callID: string }
type ToolExecuteBeforeOutput = { args: Record<string, unknown> }
type ToolExecuteAfterInput = { tool: string; sessionID: string; callID: string; args: unknown }
type ToolExecuteAfterOutput = { title: string; output: string; metadata: unknown }
type EventInput = { event: { type: string; properties?: unknown } }

export function createObservationRecorderHook(): Hooks {
  const sessionProjectCache = new Map<string, string>()

  function getProjectHash(sessionID: string): string {
    let hash = sessionProjectCache.get(sessionID)
    if (!hash) {
      hash = resolveProjectHash()
      sessionProjectCache.set(sessionID, hash)
    }
    return hash
  }

  function maybePurge(projectHash: string): void {
    const now = Date.now()
    if (now - lastPurge < PURGE_INTERVAL_MS) return
    lastPurge = now
    try {
      purgeOldObservations(projectHash, 30)
    } catch (e) {
      log(`[observation-recorder] Purge failed: ${String(e)}`)
    }
  }

  return {
    "tool.execute.before": async (
      input: ToolExecuteInput,
      output: ToolExecuteBeforeOutput,
    ) => {
      const projectHash = getProjectHash(input.sessionID)
      const observation: Observation = {
        timestamp: new Date().toISOString(),
        event: "tool_start",
        tool: input.tool,
        session: input.sessionID,
        projectHash,
        input: scrubAndTruncate(
          typeof output.args === "object" ? JSON.stringify(output.args) : String(output.args),
          TRUNCATE_CHARS,
        ),
      }
      try {
        appendObservation(projectHash, observation)
        maybePurge(projectHash)
      } catch (e) {
        log(`[observation-recorder] Failed to record tool_start: ${String(e)}`)
      }
    },
    "tool.execute.after": async (
      input: ToolExecuteAfterInput,
      output: ToolExecuteAfterOutput,
    ) => {
      const projectHash = getProjectHash(input.sessionID)
      const argsStr = typeof input.args === "object" ? JSON.stringify(input.args) : String(input.args)
      const observation: Observation = {
        timestamp: new Date().toISOString(),
        event: "tool_complete",
        tool: input.tool,
        session: input.sessionID,
        projectHash,
        input: scrubAndTruncate(argsStr, TRUNCATE_CHARS),
        output: scrubAndTruncate(output.output, TRUNCATE_CHARS),
      }
      try {
        appendObservation(projectHash, observation)
      } catch (e) {
        log(`[observation-recorder] Failed to record tool_complete: ${String(e)}`)
      }
    },
    event: async (input: EventInput) => {
      if (input.event.type === "session.deleted") {
        const props = input.event.properties as { info?: { id?: string } } | undefined
        const sessionID = props?.info?.id
        if (sessionID) sessionProjectCache.delete(sessionID)
      }
    },
  }
}
