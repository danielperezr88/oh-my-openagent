import type { Message, Part } from "@opencode-ai/sdk"
import { log } from "../../shared/logger"

const DEFAULT_KEEP_RECENT = 5
const DEFAULT_MIN_CONTENT_SIZE = 200

export interface MicroCompactOptions {
  /** Number of recent tool results to keep intact (default: 5) */
  keepRecent?: number
  /** Minimum content size in chars to trigger decay (default: 200) */
  minContentSize?: number
}

type ToolUsePart = {
  type: "tool_use"
  id: string
  name?: string
  [key: string]: unknown
}

type ToolPart = {
  type: "tool"
  callID?: string
  name?: string
  [key: string]: unknown
}

type ToolResultPart = {
  type: "tool_result"
  tool_use_id: string
  content: string
  [key: string]: unknown
}

type TransformPart = Part | ToolUsePart | ToolPart | ToolResultPart

type TransformMessageInfo = Message | {
  role: "user"
  sessionID?: string
}

interface MessageWithParts {
  info: TransformMessageInfo
  parts: TransformPart[]
}

type MessagesTransformHook = {
  "experimental.chat.messages.transform"?: (
    input: Record<string, never>,
    output: { messages: MessageWithParts[] }
  ) => Promise<void>
}

function getToolUseInfo(part: TransformPart): { id: string; name: string } | null {
  const candidate = part as Record<string, unknown>

  // Anthropic-style tool_use
  if (candidate.type === "tool_use" && typeof candidate.id === "string" && typeof candidate.name === "string") {
    return { id: candidate.id, name: candidate.name }
  }

  // OpenAI-style tool call
  if (candidate.type === "tool" && typeof candidate.callID === "string" && typeof candidate.name === "string") {
    return { id: candidate.callID, name: candidate.name }
  }

  return null
}

function getToolResultInfo(part: TransformPart): { toolUseID: string; content: string } | null {
  const candidate = part as Record<string, unknown>
  if (
    candidate.type === "tool_result" &&
    typeof candidate.tool_use_id === "string" &&
    typeof candidate.content === "string"
  ) {
    return { toolUseID: candidate.tool_use_id, content: candidate.content }
  }
  return null
}

interface ToolResultEntry {
  toolUseID: string
  toolName: string
  content: string
  messageIndex: number
  partIndex: number
}

/**
 * Create a micro-compact hook that silently decays old tool_result content.
 *
 * Replaces large tool results that are older than the N most recent ones
 * with a short placeholder like "[Previous: used grep]".
 * This runs on every messages.transform call (before each LLM turn),
 * with no LLM invocation of its own.
 */
export function createMicroCompactHook(options?: MicroCompactOptions): MessagesTransformHook {
  const keepRecent = options?.keepRecent ?? DEFAULT_KEEP_RECENT
  const minContentSize = options?.minContentSize ?? DEFAULT_MIN_CONTENT_SIZE

  return {
    "experimental.chat.messages.transform": async (_input, output) => {
      const { messages } = output
      if (messages.length === 0) return

      // Phase 1: Build tool_use_id → tool_name map
      const toolNameMap = new Map<string, string>()
      for (const msg of messages) {
        for (const part of msg.parts) {
          const info = getToolUseInfo(part)
          if (info) {
            toolNameMap.set(info.id, info.name)
          }
        }
      }

      // Phase 2: Collect all tool_result entries in order
      const toolResults: ToolResultEntry[] = []
      for (let msgIdx = 0; msgIdx < messages.length; msgIdx++) {
        for (let partIdx = 0; partIdx < messages[msgIdx].parts.length; partIdx++) {
          const result = getToolResultInfo(messages[msgIdx].parts[partIdx])
          if (result) {
            toolResults.push({
              toolUseID: result.toolUseID,
              toolName: toolNameMap.get(result.toolUseID) ?? "tool",
              content: result.content,
              messageIndex: msgIdx,
              partIndex: partIdx,
            })
          }
        }
      }

      if (toolResults.length <= keepRecent) return

      // Phase 3: Decay old results (all except the most recent keepRecent)
      const decayThreshold = toolResults.length - keepRecent
      let decayed = 0

      for (let i = 0; i < decayThreshold; i++) {
        const entry = toolResults[i]
        if (entry.content.length <= minContentSize) continue

        const placeholder = `[Previous: used ${entry.toolName}]`
        // Only replace if actually shorter (saves tokens)
        if (placeholder.length >= entry.content.length) continue

        const part = messages[entry.messageIndex].parts[entry.partIndex] as Record<string, unknown>
        part.content = placeholder
        decayed++
      }

      if (decayed > 0) {
        log("[micro-compact] Decayed tool results", {
          total: toolResults.length,
          decayed,
          kept: toolResults.length - decayThreshold,
        })
      }
    },
  }
}
