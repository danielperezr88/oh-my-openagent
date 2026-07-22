import type { Message, Part } from "@opencode-ai/sdk"
import { log, normalizeSDKResponse } from "../../shared"

interface MessageWithParts {
  info: Message
  parts: Part[]
}

type MessagesTransformHook = {
  "experimental.chat.messages.transform"?: (
    input: Record<string, never>,
    output: { messages: MessageWithParts[] },
  ) => Promise<void>
}

type SDKClient = {
  session: {
    messages: (args: { path: { id: string } }) => Promise<unknown>
  }
}

function getPartType(part: Part): string {
  return (part as { type?: string }).type ?? ""
}

function getMsgRole(msg: MessageWithParts): string {
  return msg.info?.role ?? ""
}

function hasReasoningPartsInHistory(messages: MessageWithParts[]): boolean {
  return messages.some(
    (m) =>
      m.info?.role === "assistant" &&
      m.parts?.some((p) => getPartType(p) === "reasoning"),
  )
}

function isAssistantMissingReasoning(msg: MessageWithParts): boolean {
  if (msg.info?.role !== "assistant") return false
  if (!msg.parts || msg.parts.length === 0) return false

  const hasContent = msg.parts.some((p) => {
    const type = getPartType(p)
    return type === "tool" || type === "tool_use" || type === "text"
  })
  if (!hasContent) return false

  const hasReasoning = msg.parts.some((p) => getPartType(p) === "reasoning")
  return !hasReasoning
}

/**
 * Proactive hook that preserves DeepSeek reasoning_content across the
 * conversation history.
 *
 * DeepSeek V4 Pro (and similar models) require `reasoning_content` to be
 * present on every intermediate assistant message when thinking mode is active.
 * OpenCode occasionally fails to persist `ReasoningPart` objects for some
 * intermediate tool-call messages. When the API request is built without these
 * parts, DeepSeek returns:
 *
 *   "The `reasoning_content` in the thinking mode must be passed back to the API."
 *
 * This hook runs BEFORE every API call and:
 *  1. Detects `reasoning` type parts in the message history (=> thinking model).
 *  2. Finds intermediate assistant messages that are missing their reasoning parts.
 *  3. Tries to fetch the original reasoning content from the SDK database.
 *  4. If the SDK also lacks reasoning for a message (OpenCode never stored it),
 *     copies reasoning from the nearest previous assistant message that has one.
 *  5. Injects it back into the Part arrays so OpenCode includes it in the request.
 */
export function createReasoningContentPreserverHook(client: SDKClient): MessagesTransformHook {
  return {
    "experimental.chat.messages.transform": async (_input, output) => {
      const { messages } = output
      if (!messages || messages.length === 0) return

      // Fast path: skip entirely if no reasoning parts in history.
      if (!hasReasoningPartsInHistory(messages)) return

      // Find assistant messages that have content but are missing reasoning parts.
      const messagesNeedingRepair = messages.filter(isAssistantMissingReasoning)
      if (messagesNeedingRepair.length === 0) return

      const sessionID = messages[0]?.info?.sessionID
      if (!sessionID) return

      const missingIDs = messagesNeedingRepair.map((m) => m.info?.id)
      log("[reasoning-content-preserver] Injecting missing reasoning parts", {
        sessionID,
        missingCount: messagesNeedingRepair.length,
        missingIDs,
      })

      try {
        // Fetch the full message history from the SDK — the reasoning parts
        // are stored in the database even when the transform hook doesn't
        // receive them for intermediate messages.
        const response = await client.session.messages({ path: { id: sessionID } })
        const sdkMessages = normalizeSDKResponse(response, [] as MessageWithParts[], {
          preferResponseOnMissingData: true,
        })

        // Build a lookup: messageID -> reasoning parts from the database.
        const reasoningPartsMap = new Map<string, Part[]>()
        for (const msg of sdkMessages) {
          const typed = msg as MessageWithParts
          if (typed.info?.role !== "assistant" || !typed.info?.id) continue

          const reasoningParts =
            typed.parts?.filter((p) => getPartType(p) === "reasoning") ?? []
          if (reasoningParts.length > 0) {
            reasoningPartsMap.set(typed.info.id, reasoningParts)
          }
        }

        log("[reasoning-content-preserver] SDK lookup result", {
          sessionID,
          sdkAssistantCount: sdkMessages.filter(
            (m) => (m as MessageWithParts).info?.role === "assistant",
          ).length,
          sdkWithReasoning: reasoningPartsMap.size,
          sdkReasoningIDs: [...reasoningPartsMap.keys()],
        })

        // Build a fallback: find the last reasoning part in the transform
        // messages array (before each missing message) to use as a synthetic
        // replacement when the SDK has no data for that message.
        const fallbackReasoning = new Map<string, Part>()
        for (const msg of messages) {
          if (getMsgRole(msg) === "assistant" && msg.parts) {
            for (const p of msg.parts) {
              if (getPartType(p) === "reasoning") {
                fallbackReasoning.set("__latest__", p)
              }
            }
          }
        }

        // Inject missing reasoning parts into the transform output.
        let injected = 0
        let fallbackUsed = 0
        for (const msg of messagesNeedingRepair) {
          const messageID = msg.info?.id
          if (!messageID) continue

          let reasoningParts = reasoningPartsMap.get(messageID)

          if (reasoningParts && reasoningParts.length > 0) {
            // SDK has the original reasoning — use it directly.
            msg.parts = [...reasoningParts, ...(msg.parts ?? [])]
            injected++
          } else {
            // SDK doesn't have reasoning for this message (OpenCode never
            // stored it). Use the nearest available reasoning part as a
            // synthetic substitute — DeepSeek just needs SOME reasoning_content
            // to be present on every intermediate message.
            const synthetic = fallbackReasoning.get("__latest__")
            if (synthetic) {
              msg.parts = [synthetic, ...(msg.parts ?? [])]
              fallbackUsed++
              log("[reasoning-content-preserver] Using fallback reasoning", {
                sessionID,
                messageID,
                fallbackFrom: "previous assistant message",
              })
            }
          }
        }

        log("[reasoning-content-preserver] Injection result", {
          sessionID,
          injected,
          fallbackUsed,
          targetCount: messagesNeedingRepair.length,
        })
      } catch (error) {
        log("[reasoning-content-preserver] Failed to fetch reasoning parts", {
          sessionID,
          error: String(error),
        })
      }
    },
  }
}
