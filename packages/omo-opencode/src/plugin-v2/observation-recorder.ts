import type { Plugin } from "@opencode/plugin"
import { log } from "../shared/logger"
import { scrubAndTruncate } from "../features/ecc-integration/continuous-learning/observation/scrubber"
import {
  appendObservation,
  purgeOldObservations,
} from "../features/ecc-integration/continuous-learning/observation/storage"
import type { Observation } from "../features/ecc-integration/continuous-learning/types"

const TRUNCATE_CHARS = 2000
const PURGE_INTERVAL_MS = 6 * 60 * 60 * 1000
const RETENTION_DAYS = 30

function stringifyValue(value: unknown): string {
  if (typeof value === "string") return value
  try {
    return JSON.stringify(value) ?? String(value)
  } catch {
    return "[unserializable]"
  }
}

function resultToText(result: unknown): string {
  if (typeof result === "string") return result
  if (result && typeof result === "object" && "content" in result) {
    const content = (result as { content: unknown }).content
    if (typeof content === "string") return content
  }
  return stringifyValue(result)
}

export function registerObservationRecorder(ctx: Plugin.Context, projectHash: string): void {
  let lastPurge = 0

  function maybePurge(): void {
    const now = Date.now()
    if (now - lastPurge < PURGE_INTERVAL_MS) return
    lastPurge = now
    try {
      purgeOldObservations(projectHash, RETENTION_DAYS)
    } catch (e) {
      log(`[plugin-v2/observation] purge failed: ${String(e)}`)
    }
  }

  function record(observation: Observation, kind: string): void {
    try {
      appendObservation(projectHash, observation)
      maybePurge()
    } catch (e) {
      log(`[plugin-v2/observation] failed to record ${kind}: ${String(e)}`)
    }
  }

  void ctx.tool.hook("execute.before", (event) => {
    record(
      {
        timestamp: new Date().toISOString(),
        event: "tool_start",
        tool: event.tool,
        session: event.sessionID,
        projectHash,
        input: scrubAndTruncate(stringifyValue(event.input), TRUNCATE_CHARS),
      },
      "tool_start",
    )
  })

  void ctx.tool.hook("execute.after", (event) => {
    const output =
      event.status === "completed"
        ? scrubAndTruncate(resultToText(event.result), TRUNCATE_CHARS)
        : scrubAndTruncate(`error: ${event.error.message}`, TRUNCATE_CHARS)
    record(
      {
        timestamp: new Date().toISOString(),
        event: "tool_complete",
        tool: event.tool,
        session: event.sessionID,
        projectHash,
        input: scrubAndTruncate(stringifyValue(event.input), TRUNCATE_CHARS),
        output,
      },
      "tool_complete",
    )
  })
}
