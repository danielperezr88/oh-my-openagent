import type { Message, Part } from "@opencode-ai/sdk"
import { log } from "../../shared/logger"
import type { BackgroundManager } from "../../features/background-agent"

const DEFAULT_MAX_INJECTION_LENGTH = 500

export interface BackgroundResultInjectionOptions {
  /** Max chars for injected result snippet (default: 500). Full result still available via background_output() */
  maxInjectionLength?: number
}

type TransformPart = Part | {
  type: string
  [key: string]: unknown
}

type TransformMessageInfo = Message | {
  role: "user"
  sessionID?: string
  [key: string]: unknown
}

interface MessageWithParts {
  info: TransformMessageInfo
  parts: TransformPart[]
}

/**
 * Injects structured <background-result> blocks from completed background tasks
 * into the message stream before the next LLM call.
 *
 * Complements the existing chat.message injection by providing clearly delimited
 * XML-formatted results that the model can parse more reliably.
 */
export function createBackgroundResultInjectionHook(
  backgroundManager: BackgroundManager,
  options?: BackgroundResultInjectionOptions,
) {
  const maxLength = options?.maxInjectionLength ?? DEFAULT_MAX_INJECTION_LENGTH

  return {
    "experimental.chat.messages.transform": async (
      _input: Record<string, never>,
      output: { messages: MessageWithParts[] },
    ) => {
      if (output.messages.length === 0) return

      // Find the session ID from the last message
      const lastMsg = output.messages[output.messages.length - 1]
      const sessionID = (lastMsg.info as Record<string, unknown>).sessionID as string | undefined
      if (!sessionID) return

      // Get completed background tasks for this parent session
      const completedTasks = backgroundManager.getPendingNotifications(sessionID)
      if (completedTasks.length === 0) return

      // Build structured result blocks
      const resultBlocks: string[] = []
      for (const task of completedTasks) {
        if (task.status !== "completed") continue

        const outputText = task.result ?? ""
        const truncated = outputText.length > maxLength
          ? outputText.slice(0, maxLength) + "...[truncated, use background_output(task_id=\"" + task.id + "\") for full result]"
          : outputText

        resultBlocks.push(`[bg:${task.id}] ${task.description ?? "Background task"}\n${truncated}`)
      }

      if (resultBlocks.length === 0) return

      const injectionText = `<background-results>\n${resultBlocks.join("\n")}\n</background-results>`

      // Find last user message to inject into
      for (let i = output.messages.length - 1; i >= 0; i--) {
        if (output.messages[i].info.role === "user") {
          output.messages[i].parts.unshift({
            type: "text",
            text: injectionText,
          } as TransformPart)

          log("[background-result-injection] Injected structured results", {
            sessionID,
            resultCount: resultBlocks.length,
          })

          // Clear notifications so they aren't re-injected on the next LLM call
          backgroundManager.clearNotifications(sessionID)
          break
        }
      }
    },
  }
}
