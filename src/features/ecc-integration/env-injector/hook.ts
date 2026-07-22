import type { Hooks, PluginInput } from "@opencode-ai/plugin"
import { contextCollector } from "../../../features/context-injector"
import { detectStack } from "../../../features/ecc-integration/stack-detector"
import { log } from "../../../shared/logger"

const INJECTED_SESSIONS = new Set<string>()
const CONTEXT_ID = "ecc-env-injector"

export function createEnvInjectorHook(ctx: PluginInput): Hooks {
  return {
    "chat.message": async (input: { sessionID?: string }) => {
      const sessionID = input.sessionID
      if (!sessionID || INJECTED_SESSIONS.has(sessionID)) return

      INJECTED_SESSIONS.add(sessionID)

      try {
        const stack = detectStack(ctx.directory)
        if (stack.languages.length === 0 && stack.frameworks.length === 0) return

        const lines: string[] = ["[Project Environment]"]
        if (stack.languages.length > 0) {
          lines.push(`Detected languages: ${stack.languages.join(", ")}`)
        }
        if (stack.frameworks.length > 0) {
          lines.push(`Detected frameworks: ${stack.frameworks.join(", ")}`)
        }
        if (stack.packageManager) {
          lines.push(`Package manager: ${stack.packageManager}`)
        }
        if (stack.testFramework) {
          lines.push(`Test framework: ${stack.testFramework}`)
        }
        if (stack.runtime) {
          lines.push(`Runtime: ${stack.runtime}`)
        }

        contextCollector.register(sessionID, {
          id: CONTEXT_ID,
          source: "custom",
          content: lines.join("\n"),
          priority: "high",
        })

        log(`[env-injector] Injected stack info for session ${sessionID}`, {
          languages: stack.languages,
          frameworks: stack.frameworks,
        })
      } catch (error) {
        log(`[env-injector] Failed to detect stack`, { error })
      }
    },
  }
}
