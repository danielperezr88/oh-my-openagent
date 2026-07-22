import type { Hooks } from "@opencode-ai/plugin"
import { contextCollector } from "../../../context-injector"
import { log } from "../../../../shared/logger"
import { DEFAULT_CL_CONFIG } from "../types"
import { listAllInstincts } from "../instinct-store/storage"
import { selectTopInstincts } from "./relevance-matcher"

const MAX_INSTINCTS = 5
const MIN_CONFIDENCE = 0.5

type MessageTransformInput = unknown
type MessageTransformOutput = {
  messages: Array<{
    info: { role: string }
    parts: Array<{ type: string; text?: string }>
  }>
}

let injectedSessions = new Set<string>()

export function createInstinctInjectorHook(): Hooks {
  return {
    "experimental.chat.messages.transform": async (
      _input: MessageTransformInput,
      output: MessageTransformOutput,
    ) => {
      const messages = output.messages
      if (messages.length === 0) return

      const firstUser = messages.find((m) => m.info.role === "user")
      if (!firstUser) return

      const taskText = firstUser.parts
        .filter((p) => p.type === "text")
        .map((p) => p.text ?? "")
        .join(" ")

      if (taskText.length < 5) return

      try {
        const allInstincts = listAllInstincts()
        if (allInstincts.length === 0) return

        const top = selectTopInstincts(
          allInstincts,
          taskText,
          MAX_INSTINCTS,
          MIN_CONFIDENCE,
        )

        if (top.length === 0) return

        const content = formatInstinctsForInjection(top)

        const sessionID = `cl-${Date.now()}`
        contextCollector.register(sessionID, {
          id: "continuous-learning-instincts",
          source: "custom",
          content,
          priority: "low",
          metadata: {
            instinctCount: top.length,
            instinctIds: top.map((t) => t.instinct.id),
          },
        })

        log(`[instinct-injector] Injected ${top.length} instincts into context`)
      } catch (e) {
        log(`[instinct-injector] Failed: ${String(e)}`)
      }
    },
  }
}

function formatInstinctsForInjection(
  top: Array<{ instinct: import("../types").Instinct; score: number; matchedKeywords: string[] }>,
): string {
  const lines = top.map((entry) => {
    const instinct = entry.instinct
    const confidenceBar = `[${"=".repeat(Math.round(instinct.confidence * 10))}${"-".repeat(10 - Math.round(instinct.confidence * 10))}]`
    return `- ${confidenceBar} (${instinct.confidence.toFixed(2)}) ${instinct.trigger}\n  Action: ${extractAction(instinct.content)}`
  })

  return `[Learned Patterns - ${top.length} active]\n${lines.join("\n")}`
}

function extractAction(content: string): string {
  const match = content.match(/## Action\s*\n([^\n#]+)/i)
  return match ? match[1].trim() : content.slice(0, 100).trim()
}
