import type { Plugin } from "@opencode/plugin"
import { log } from "../shared/logger"
import { listAllInstincts } from "../features/ecc-integration/continuous-learning/instinct-store/storage"
import { selectTopInstincts } from "../features/ecc-integration/continuous-learning/injection/relevance-matcher"

export interface InstinctInjectionOptions {
  readonly projectHash: string
  readonly maxInstincts: number
  readonly minConfidence: number
}

type MessageLike = {
  readonly role?: string
  readonly content?: ReadonlyArray<{ readonly type: string; readonly text?: string }>
  readonly parts?: ReadonlyArray<{ readonly type: string; readonly text?: string }>
}

export function extractLastUserText(messages: ReadonlyArray<unknown>): string {
  let latest = ""
  for (const message of messages) {
    const candidate = message as MessageLike
    if (candidate.role !== "user") continue
    const segments = candidate.content ?? candidate.parts ?? []
    const joined = segments
      .filter((segment) => segment.type === "text")
      .map((segment) => segment.text ?? "")
      .join(" ")
      .trim()
    if (joined) latest = joined
  }
  return latest
}

function confidenceBar(confidence: number): string {
  const clamped = Math.min(Math.max(confidence, 0), 1)
  const filled = Math.round(clamped * 10)
  return `[${"=".repeat(filled)}${"-".repeat(10 - filled)}]`
}

function extractAction(content: string): string {
  const match = content.match(/## Action\s*\n([^\n#]+)/i)
  return match ? match[1].trim() : content.slice(0, 100).trim()
}

export function formatInstinctsForSystem(
  top: ReadonlyArray<{
    readonly instinct: { readonly confidence: number; readonly trigger: string; readonly content: string }
  }>,
): string {
  const lines = top.map(({ instinct }) => {
    return `- ${confidenceBar(instinct.confidence)} (${instinct.confidence.toFixed(2)}) ${instinct.trigger}\n  Action: ${extractAction(instinct.content)}`
  })
  return `[Learned Patterns - ${top.length} active]\n${lines.join("\n")}`
}

export function registerInstinctInjection(ctx: Plugin.Context, options: InstinctInjectionOptions): void {
  void ctx.session.hook("context", (event) => {
    try {
      const taskText = extractLastUserText(event.messages)
      if (taskText.length < 5) return

      const all = listAllInstincts(options.projectHash)
      if (all.length === 0) return

      const top = selectTopInstincts(all, taskText, options.maxInstincts, options.minConfidence)
      if (top.length === 0) return

      event.system.push({ type: "text", text: formatInstinctsForSystem(top) })
    } catch (e) {
      log(`[plugin-v2/instincts] injection failed: ${String(e)}`)
    }
  })
}
