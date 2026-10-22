import type { Plugin } from "@opencode/plugin"
import { log } from "../shared/logger"
import { isRecord } from "../shared/record-type-guard"
import { detectErrorType, extractUnavailableToolName } from "../hooks/session-recovery/detect-error-type"
import { stripMediaPartsFromMessages } from "./session-recovery-strip"
import { injectMissingToolResults, summarizeToolPairs } from "./session-recovery-tool-results"
import { formatMessageInventory } from "./session-recovery-diagnostics"
import {
  emptyArmedRecovery,
  mergeArmedRecovery,
  resolveRecoveryAction,
  type ArmedRecovery,
} from "./session-recovery-strategies"

export interface SessionRecoveryOptions {
  readonly autoResume: boolean
}

export interface FailedSessionEvent {
  readonly sessionID: string
  readonly error: unknown
}

type EventSubscribe = (options?: { signal?: AbortSignal }) => AsyncIterable<unknown>

type RequestHookEvent = {
  sessionID?: unknown
  messages?: unknown
}

export function extractFailedSessionEvent(event: unknown): FailedSessionEvent | null {
  if (!isRecord(event)) return null
  if (event.type !== "session.execution.failed" && event.type !== "session.step.failed") return null
  if (!isRecord(event.data)) return null
  const sessionID = event.data.sessionID
  if (typeof sessionID !== "string" || sessionID.length === 0) return null
  return { sessionID, error: event.data.error }
}

function resolveEventSubscribe(domain: unknown): EventSubscribe | null {
  if (!isRecord(domain)) return null
  if (typeof domain.subscribe !== "function") return null
  return (domain.subscribe as EventSubscribe).bind(domain)
}

interface RecoveryState {
  readonly recoveringSessions: Map<string, ArmedRecovery>
  readonly handledErrorKeys: Set<string>
  readonly signal: AbortSignal
}

function createRequestTransformHandler(recoveringSessions: Map<string, ArmedRecovery>): (event: unknown) => void {
  const diagnosedSessions = new Set<string>()
  return (event) => {
    try {
      if (typeof event !== "object" || event === null) return
      const candidate = event as RequestHookEvent
      const sessionID = candidate.sessionID
      if (typeof sessionID !== "string" || !recoveringSessions.has(sessionID)) return
      const armed = recoveringSessions.get(sessionID)
      if (!armed) return
      const messages = candidate.messages
      if (!Array.isArray(messages)) {
        if (!diagnosedSessions.has(sessionID)) {
          diagnosedSessions.add(sessionID)
          log(`[plugin-v2/session-recovery] outgoing request for session ${sessionID} carried messages as ${typeof messages}`)
        }
        return
      }
      let transformed = false
      if (armed.stripMedia) {
        const stripped = stripMediaPartsFromMessages(messages)
        if (stripped > 0) {
          transformed = true
          log(
            `[plugin-v2/session-recovery] replaced ${stripped} media part(s) with placeholders in outgoing request for session ${sessionID}`,
          )
        }
      }
      if (armed.toolResultText !== null) {
        const injected = injectMissingToolResults(messages, armed.toolResultText)
        if (injected > 0) {
          transformed = true
          log(
            `[plugin-v2/session-recovery] injected ${injected} synthetic tool result(s) into outgoing request for session ${sessionID}`,
          )
        }
      }
      if (transformed || diagnosedSessions.has(sessionID)) return
      diagnosedSessions.add(sessionID)
      log(
        `[plugin-v2/session-recovery] no recoverable parts matched for session ${sessionID}; ` +
          `inventory: ${formatMessageInventory(messages)}; toolPairs: ${summarizeToolPairs(messages)}`,
      )
    } catch (error) {
      log(`[plugin-v2/session-recovery] request transform hook failed: ${String(error)}`)
    }
  }
}

async function handleBusEvent(
  ctx: Plugin.Context,
  options: SessionRecoveryOptions,
  state: RecoveryState,
  event: unknown,
): Promise<void> {
  const failed = extractFailedSessionEvent(event)
  if (failed === null) return
  const errorType = detectErrorType(failed.error)
  if (errorType === null) return
  const errorKey = `${failed.sessionID}:${errorType}`
  if (state.handledErrorKeys.has(errorKey)) return
  state.handledErrorKeys.add(errorKey)

  const action = resolveRecoveryAction(errorType)
  if (action === null) {
    log(`[plugin-v2/session-recovery] detected ${errorType} for session ${failed.sessionID}; no V2 strategy for this error yet`)
    return
  }

  const current = state.recoveringSessions.get(failed.sessionID) ?? emptyArmedRecovery()
  state.recoveringSessions.set(failed.sessionID, mergeArmedRecovery(current, action.armPatch))

  const unavailableToolName = errorType === "unavailable_tool" ? extractUnavailableToolName(failed.error) : null
  log(
    `[plugin-v2/session-recovery] ${errorType} failure detected for session ${failed.sessionID}` +
      `${unavailableToolName ? ` (unavailable tool '${unavailableToolName}')` : ""}; ` +
      `outgoing requests will apply ${errorType} recovery transforms`,
  )

  if (!options.autoResume) {
    log(`[plugin-v2/session-recovery] auto-resume disabled; session ${failed.sessionID} waits for the next user message`)
    return
  }

  try {
    await ctx.session.synthetic({ sessionID: failed.sessionID, text: action.resumeText })
    log(`[plugin-v2/session-recovery] resumed session ${failed.sessionID} after ${errorType} recovery`)
  } catch (error) {
    log(`[plugin-v2/session-recovery] failed to resume session ${failed.sessionID}: ${String(error)}`)
  }
}

async function runRecoveryEventLoop(
  ctx: Plugin.Context,
  options: SessionRecoveryOptions,
  state: RecoveryState,
): Promise<void> {
  const subscribe = resolveEventSubscribe(ctx.event)
  if (subscribe === null) {
    log("[plugin-v2/session-recovery] event subscription unavailable on this host; reactive recovery disabled")
    return
  }
  try {
    for await (const event of subscribe({ signal: state.signal })) {
      if (state.signal.aborted) return
      await handleBusEvent(ctx, options, state, event)
    }
  } catch (error) {
    if (!state.signal.aborted) {
      log(`[plugin-v2/session-recovery] event stream ended: ${String(error)}`)
    }
  }
}

export function registerSessionRecovery(ctx: Plugin.Context, options: SessionRecoveryOptions): () => void {
  const controller = new AbortController()
  const state: RecoveryState = {
    recoveringSessions: new Map(),
    handledErrorKeys: new Set(),
    signal: controller.signal,
  }
  const requestTransformHandler = createRequestTransformHandler(state.recoveringSessions)

  const requestHookRegistrations: ReadonlyArray<unknown> = [
    ctx.session.hook("context", requestTransformHandler),
    ctx.session.hook("compaction", requestTransformHandler),
    ctx.session.hook("generate", requestTransformHandler),
    ctx.session.hook("title", requestTransformHandler),
  ]
  for (const registration of requestHookRegistrations) {
    Promise.resolve(registration).catch((error: unknown) => {
      log(`[plugin-v2/session-recovery] session hook registration rejected: ${String(error)}`)
    })
  }

  void runRecoveryEventLoop(ctx, options, state)
  return () => controller.abort()
}
