import type { Hooks } from "@opencode-ai/plugin"
import { log } from "../../../shared/logger"
import { createToolCallRecord, detectToolLoop } from "./loop-detector"
import { detectScopeDrift } from "./scope-detector"
import {
  DEFAULT_DRIFT_CONFIG,
  DEFAULT_LOOP_CONFIG,
  type ToolCallRecord,
} from "./types"

const MAX_RECORDS = 200

export function createContextMonitorHook(): Hooks {
  const toolCallRecords: ToolCallRecord[] = []
  const originalTasks = new Map<string, string>()
  const warnedLoops = new Set<string>()
  const warnedDrift = new Set<string>()

  return {
    "tool.execute.before": async (
      input: { tool: string; sessionID: string },
      output: { args: Record<string, unknown> },
    ) => {
      const record = createToolCallRecord(input.tool, output.args)
      toolCallRecords.push(record)
      if (toolCallRecords.length > MAX_RECORDS) toolCallRecords.shift()

      const loopResult = detectToolLoop(toolCallRecords, DEFAULT_LOOP_CONFIG)
      if (loopResult.detected && !warnedLoops.has(loopResult.tool!)) {
        warnedLoops.add(loopResult.tool!)
        log(`[context-monitor] Tool loop detected: ${loopResult.tool} called ${loopResult.count} times`, {
          sessionID: input.sessionID,
        })
      }
    },
    "experimental.chat.messages.transform": async (
      _input: unknown,
      output: { messages: Array<{ info: { role: string; content?: string }; parts: Array<{ type: string; text?: string }> }> },
    ) => {
      const messages = output.messages
      if (messages.length === 0) return

      const firstUser = messages.find((m) => m.info.role === "user")
      if (!firstUser) return

      const firstUserText = firstUser.parts
        .filter((p) => p.type === "text")
        .map((p) => p.text ?? "")
        .join(" ")

      if (firstUserText.length > 10 && !originalTasks.has("task")) {
        originalTasks.set("task", firstUserText)
      }

      const task = originalTasks.get("task")
      if (!task) return

      const recentMessages = messages
        .slice(-DEFAULT_DRIFT_CONFIG.maxMessagesTracked)
        .map((m) =>
          m.parts
            .filter((p) => p.type === "text")
            .map((p) => p.text ?? "")
            .join(" "),
        )
        .filter((t) => t.length > 0)

      const driftResult = detectScopeDrift(task, recentMessages, DEFAULT_DRIFT_CONFIG)
      if (driftResult.drifting && !warnedDrift.has("drift")) {
        warnedDrift.add("drift")
        log(`[context-monitor] Possible scope drift detected (similarity: ${driftResult.similarity.toFixed(2)})`, {})
      }
    },
  }
}
