import type { Plugin } from "@opencode/plugin"
import { log } from "../shared/logger"
import { isRecord } from "../shared/record-type-guard"
import { detectErrorType } from "../hooks/session-recovery/detect-error-type"
import { stripMediaPartsFromMessages } from "./session-recovery-strip"

export interface SessionRecoveryOptions {
  readonly autoResume: boolean
}

export interface FailedSessionEvent {
  readonly sessionID: string
  readonly error: unknown
}

type EventSubscribe = (options?: { signal?: AbortSignal }) => AsyncIterable<unknown>

type RequestPartLike = {
  type?: unknown
  mime?: unknown
  mediaType?: unknown
  mimeType?: unknown
}

type StripHookEvent = {
  sessionID?: unknown
  messages?: unknown
}

const RESUME_TEXT =
  "[session recovery] The previous request failed because the active model only accepts text content. " +
  "Image attachments in the conversation history are now replaced with text placeholders in outgoing requests. " +
  "Continue the user's task from where it stopped, using text content only."

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

function formatPartKind(part: unknown): string {
  if (typeof part !== "object" || part === null) return typeof part
  const candidate = part as RequestPartLike
  const mimeType =
    typeof candidate.mime === "string"
      ? candidate.mime
      : typeof candidate.mediaType === "string"
        ? candidate.mediaType
        : typeof candidate.mimeType === "string"
          ? candidate.mimeType
          : ""
  const type = String(candidate.type ?? "?")
  return mimeType.length > 0 ? `${type}(${mimeType})` : type
}

function formatMessageInventory(messages: ReadonlyArray<unknown>): string {
  const descriptions: string[] = []
  for (const message of messages) {
    if (typeof message !== "object" || message === null) {
      descriptions.push(typeof message)
    } else {
      const candidate = message as { role?: unknown; parts?: unknown; content?: unknown }
      const segments = Array.isArray(candidate.parts)
        ? candidate.parts
        : Array.isArray(candidate.content)
          ? candidate.content
          : null
      const role = String(candidate.role ?? "?")
      if (segments === null) {
        descriptions.push(`${role}:content=${typeof candidate.content}`)
      } else {
        const kinds = segments.slice(0, 10).map((part) => formatPartKind(part)).join(",")
        const overflow = segments.length > 10 ? `,+${segments.length - 10}more` : ""
        descriptions.push(`${role}[${kinds}${overflow}]`)
      }
    }
    if (descriptions.length >= 8) break
  }
  return descriptions.join(" ")
}

function previewValue(value: unknown): string {
  if (typeof value === "string") return value.slice(0, 50)
  try {
    const encoded = JSON.stringify(value)
    return typeof encoded === "string" ? encoded.slice(0, 50) : typeof value
  } catch {
    return typeof value
  }
}

function formatFirstNonTextPart(messages: ReadonlyArray<unknown>): string {
  for (const message of messages) {
    if (typeof message !== "object" || message === null) continue
    const candidate = message as { parts?: unknown; content?: unknown }
    const segments = Array.isArray(candidate.parts)
      ? candidate.parts
      : Array.isArray(candidate.content)
        ? candidate.content
        : null
    if (segments === null) continue
    for (const part of segments) {
      if (typeof part !== "object" || part === null) continue
      if ((part as RequestPartLike).type === "text") continue
      return Object.entries(part as Record<string, unknown>)
        .map(([key, value]) => `${key}=${previewValue(value)}`)
        .join(" ")
    }
  }
  return "none"
}

function createStripHandler(recoveringSessions: Set<string>): (event: unknown) => void {
  const diagnosedSessions = new Set<string>()
  return (event) => {
    try {
      if (typeof event !== "object" || event === null) return
      const candidate = event as StripHookEvent
      const sessionID = candidate.sessionID
      if (typeof sessionID !== "string" || !recoveringSessions.has(sessionID)) return
      const messages = candidate.messages
      if (!Array.isArray(messages)) {
        if (!diagnosedSessions.has(sessionID)) {
          diagnosedSessions.add(sessionID)
          log(`[plugin-v2/session-recovery] outgoing request for session ${sessionID} carried messages as ${typeof messages}`)
        }
        return
      }
      const stripped = stripMediaPartsFromMessages(messages)
      if (stripped > 0) {
        log(
          `[plugin-v2/session-recovery] replaced ${stripped} media part(s) with placeholders in outgoing request for session ${sessionID}`,
        )
        return
      }
      if (!diagnosedSessions.has(sessionID)) {
        diagnosedSessions.add(sessionID)
        log(
          `[plugin-v2/session-recovery] no media parts matched for session ${sessionID}; request inventory: ${formatMessageInventory(messages)}; firstNonTextPart: ${formatFirstNonTextPart(messages)}`,
        )
      }
    } catch (error) {
      log(`[plugin-v2/session-recovery] strip hook failed: ${String(error)}`)
    }
  }
}

interface RecoveryState {
  readonly recoveringSessions: Set<string>
  readonly handledErrorKeys: Set<string>
  readonly signal: AbortSignal
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

  if (errorType !== "image_content_invalid") {
    log(`[plugin-v2/session-recovery] detected ${errorType} for session ${failed.sessionID}; no V2 strategy for this error yet`)
    return
  }

  state.recoveringSessions.add(failed.sessionID)
  log(
    `[plugin-v2/session-recovery] image-content failure detected for session ${failed.sessionID}; outgoing requests will replace image parts with placeholders`,
  )

  if (!options.autoResume) {
    log(`[plugin-v2/session-recovery] auto-resume disabled; session ${failed.sessionID} waits for the next user message`)
    return
  }

  try {
    await ctx.session.synthetic({ sessionID: failed.sessionID, text: RESUME_TEXT })
    log(`[plugin-v2/session-recovery] resumed session ${failed.sessionID} after image-content recovery`)
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
    recoveringSessions: new Set<string>(),
    handledErrorKeys: new Set<string>(),
    signal: controller.signal,
  }
  const stripHandler = createStripHandler(state.recoveringSessions)

  const stripHookRegistrations: ReadonlyArray<unknown> = [
    ctx.session.hook("context", stripHandler),
    ctx.session.hook("compaction", stripHandler),
    ctx.session.hook("generate", stripHandler),
    ctx.session.hook("title", stripHandler),
  ]
  for (const registration of stripHookRegistrations) {
    Promise.resolve(registration).catch((error: unknown) => {
      log(`[plugin-v2/session-recovery] session hook registration rejected: ${String(error)}`)
    })
  }

  void runRecoveryEventLoop(ctx, options, state)
  return () => controller.abort()
}
