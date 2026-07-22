import { log } from "../../shared/logger"
import { extractPlatformErrorCode } from "../../shared/model-error-classifier"

type TransformPart = { type: string; [key: string]: unknown }

interface MessageWithParts {
  info: { role?: string; error?: unknown; [key: string]: unknown }
  parts: TransformPart[]
}

type MessagesTransformHook = {
  "experimental.chat.messages.transform"?: (
    input: Record<string, never>,
    output: { messages: MessageWithParts[] },
  ) => Promise<void>
}

/**
 * Filters z.ai platform error messages (codes 1234, 1305, 1308, 1312) from the
 * chat display and LLM context. These are infrastructure-level errors that don't
 * indicate agent mistakes — they're temporary provider issues that pollute the
 * conversation without actionable value.
 *
 * The errors are still logged to file and telemetry; this hook only removes them
 * from the message array sent to the UI and the LLM.
 */
export function createPlatformErrorFilterHook(): MessagesTransformHook {
  return {
    "experimental.chat.messages.transform": async (
      _input,
      output,
    ) => {
      if (output.messages.length === 0) return

      let removed = 0
      for (let i = output.messages.length - 1; i >= 0; i--) {
        const msg = output.messages[i]
        if (msg.info.role !== "assistant" || !msg.info.error) continue

        const code = extractPlatformErrorCode(msg.info.error)
        if (code !== null) {
          log("[platform-error-filter] Removing platform error message from context", {
            code,
            messageID: (msg.info as Record<string, unknown>).id as string | undefined,
          })
          output.messages.splice(i, 1)
          removed++
        }
      }

      if (removed > 0) {
        log("[platform-error-filter] Filtered platform error messages", { removed })
      }
    },
  }
}
