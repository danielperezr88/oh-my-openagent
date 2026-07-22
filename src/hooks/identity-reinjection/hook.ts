import type { Message, Part } from "@opencode-ai/sdk"
import { log } from "../../shared/logger"
import { getSessionAgent, subagentSessions } from "../../features/claude-code-session-state/state"

type TransformPart = Part | {
  type: string
  [key: string]: unknown
}

type TransformMessageInfo = Message | {
  role: "user" | "assistant"
  sessionID?: string
  [key: string]: unknown
}

interface MessageWithParts {
  info: TransformMessageInfo
  parts: TransformPart[]
}

interface IdentityState {
  lastInjectedAt?: number
}

const INJECTION_COOLDOWN_MS = 60_000

/**
 * Identity re-injection hook for subagent sessions post-compaction.
 *
 * After compaction, subagent sessions can lose their behavioral grounding.
 * This hook detects compacted subagent sessions and injects identity anchor
 * messages to re-establish the agent's role and context.
 *
 * Uses experimental.chat.messages.transform to inject identity right after
 * compaction events, when the message count is low (<= 5 messages).
 */
export function createIdentityReinjectionHook() {
  const sessionStates = new Map<string, IdentityState>()
  const compactedSubagents = new Set<string>()

  const eventHandler = async ({ event }: { event: { type: string; properties?: unknown } }) => {
    const props = event.properties as Record<string, unknown> | undefined

    if (event.type === "session.compacted") {
      const sessionID = (props?.sessionID ?? (props?.info as { id?: string } | undefined)?.id) as string | undefined
      if (sessionID && subagentSessions.has(sessionID)) {
        compactedSubagents.add(sessionID)
        log("[identity-reinjection] Marked compacted subagent for identity injection", { sessionID })
      }
      return
    }

    if (event.type === "session.deleted") {
      const sessionID = (props?.info as { id?: string } | undefined)?.id
      if (sessionID) {
        sessionStates.delete(sessionID)
        compactedSubagents.delete(sessionID)
      }
    }
  }

  const messagesTransform = async (
    _input: Record<string, never>,
    output: { messages: MessageWithParts[] }
  ) => {
    if (output.messages.length === 0) return

    // Only inject right after compaction (few messages)
    if (output.messages.length > 5) {
      // Clear any pending injections if session has grown
      for (const msg of output.messages) {
        const sessionID = (msg.info as Record<string, unknown>).sessionID as string | undefined
        if (sessionID) {
          compactedSubagents.delete(sessionID)
        }
      }
      return
    }

    // Collect unique compacted subagent session IDs to avoid duplicate injection
    const pendingSessions = new Set<string>()
    for (const msg of output.messages) {
      const sessionID = (msg.info as Record<string, unknown>).sessionID as string | undefined
      if (sessionID && compactedSubagents.has(sessionID)) {
        pendingSessions.add(sessionID)
      }
    }

    for (const sessionID of pendingSessions) {
      // Check cooldown
      const state = sessionStates.get(sessionID) ?? {}
      if (state.lastInjectedAt && Date.now() - state.lastInjectedAt < INJECTION_COOLDOWN_MS) {
        compactedSubagents.delete(sessionID)
        continue
      }

      const agentName = getSessionAgent(sessionID)
      if (!agentName) {
        compactedSubagents.delete(sessionID)
        continue
      }

      // Find the last user message to inject identity before it
      let lastUserIdx = -1
      for (let i = output.messages.length - 1; i >= 0; i--) {
        if (output.messages[i].info.role === "user") {
          lastUserIdx = i
          break
        }
      }
      if (lastUserIdx === -1) {
        compactedSubagents.delete(sessionID)
        continue
      }

      const identityText = `<identity>You are '${agentName}', a specialized agent in the oh-my-openagent orchestration. This session was compacted. Continue your assigned task with full authority.</identity>`

      output.messages[lastUserIdx].parts.unshift({
        type: "text",
        text: identityText,
      } as TransformPart)

      state.lastInjectedAt = Date.now()
      sessionStates.set(sessionID, state)
      compactedSubagents.delete(sessionID)

      log("[identity-reinjection] Injected identity anchor", { sessionID, agentName })
    }
  }

  return {
    event: eventHandler,
    "experimental.chat.messages.transform": messagesTransform,
  }
}
