import type { Message, Part } from "@opencode-ai/sdk"
import { log } from "../../shared/logger"

const DEFAULT_NAG_THRESHOLD = 4
const TASK_TOOLS = new Set([
  "task",
  "task_create",
  "task_list",
  "task_get",
  "task_update",
  "task_delete",
  "todo_write",
  "Todowrite",
])

const DEFAULT_NAG_MESSAGE =
  "<reminder>You haven't updated your task list in a while. Consider using task_update or task_create to reflect your current progress before continuing.</reminder>"

export interface TodoNagOptions {
  /** Number of tool calls without a task update before nagging (default: 4) */
  nagThreshold?: number
  /** Custom nag message to inject */
  nagMessage?: string
}

type TransformPart = Part | {
  type: string
  [key: string]: unknown
}

type TransformMessageInfo = Message | {
  role: "user"
  sessionID?: string
}

interface MessageWithParts {
  info: TransformMessageInfo
  parts: TransformPart[]
}

interface SessionNagState {
  roundsSinceTaskUpdate: number
  nagInjectedThisTurn: boolean
  lastNagAt?: number
}

export function createTodoNagHook(options?: TodoNagOptions) {
  const nagThreshold = options?.nagThreshold ?? DEFAULT_NAG_THRESHOLD
  const nagMessage = options?.nagMessage ?? DEFAULT_NAG_MESSAGE

  const sessionStates = new Map<string, SessionNagState>()

  const getState = (sessionID: string): SessionNagState => {
    let state = sessionStates.get(sessionID)
    if (!state) {
      state = { roundsSinceTaskUpdate: 0, nagInjectedThisTurn: false }
      sessionStates.set(sessionID, state)
    }
    return state
  }

  const toolExecuteAfter = async (
    input: { tool: string; sessionID: string; callID: string },
    _output: { title: string; output: string; metadata: unknown }
  ) => {
    const state = getState(input.sessionID)
    state.nagInjectedThisTurn = false

    if (TASK_TOOLS.has(input.tool)) {
      state.roundsSinceTaskUpdate = 0
    } else {
      state.roundsSinceTaskUpdate++
    }
  }

  const messagesTransform = async (
    _input: Record<string, never>,
    output: { messages: MessageWithParts[] }
  ) => {
    if (output.messages.length === 0) return

    // Find the session ID from the last message
    const lastMsg = output.messages[output.messages.length - 1]
    const sessionID = (lastMsg.info as Record<string, unknown>).sessionID as string | undefined
    if (!sessionID) return

    const state = getState(sessionID)
    if (state.nagInjectedThisTurn) return
    if (state.roundsSinceTaskUpdate < nagThreshold) return

    // Don't nag more than once every 2 minutes
    if (state.lastNagAt && Date.now() - state.lastNagAt < 120_000) return

    // Inject the reminder as a text part at the beginning of the last user message
    // If last message is not user, find the last user message
    let targetMsg: MessageWithParts | null = null
    for (let i = output.messages.length - 1; i >= 0; i--) {
      if (output.messages[i].info.role === "user") {
        targetMsg = output.messages[i]
        break
      }
    }

    if (!targetMsg) return

    // Check if nag already present to avoid duplicates
    for (const part of targetMsg.parts) {
      const candidate = part as Record<string, unknown>
      if (typeof candidate.text === "string" && candidate.text.includes("<reminder>")) {
        return
      }
    }

    targetMsg.parts.unshift({
      type: "text",
      text: nagMessage,
    } as TransformPart)

    state.nagInjectedThisTurn = true
    state.lastNagAt = Date.now()

    log("[todo-nag] Injected task reminder", {
      sessionID,
      roundsSinceTaskUpdate: state.roundsSinceTaskUpdate,
    })
  }

  const eventHandler = async ({ event }: { event: { type: string; properties?: unknown } }) => {
    if (event.type === "session.deleted") {
      const props = event.properties as { info?: { id?: string } } | undefined
      const sessionId = props?.info?.id
      if (sessionId) {
        sessionStates.delete(sessionId)
      }
    }
  }

  return {
    "tool.execute.after": toolExecuteAfter,
    "experimental.chat.messages.transform": messagesTransform,
    event: eventHandler,
  }
}
