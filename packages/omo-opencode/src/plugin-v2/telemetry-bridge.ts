import type { Plugin } from "@opencode/plugin"
import type { Span } from "@opentelemetry/api"
import { flushTracer, getTracer, initTelemetry } from "../telemetry"
import { trackMessageEvent, trackPartEvent } from "../telemetry/llm-span-tracker"
import { endTurnSpan, startTurnSpan } from "../telemetry/interaction-tracker"
import { setCurrentSessionID } from "../telemetry/session-context"
import { log } from "../shared/logger"

type EventLike = {
  readonly type: string
  readonly data?: unknown
  readonly properties?: unknown
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : null
}

function eventPayload(event: EventLike): Record<string, unknown> | null {
  return asRecord(event.data ?? event.properties)
}

function nestedInfo(payload: Record<string, unknown> | null): Record<string, unknown> | null {
  return asRecord(payload?.info) ?? payload
}

export interface TelemetryBridgeOptions {
  readonly endpoint?: string
  readonly project?: string
}

/**
 * Bridges V2 events and tool hooks onto the fork's OTel telemetry
 * (Phoenix OTLP exporter). Mirrors the V1 wiring: turn spans per user
 * message, LLM spans per assistant message, tool spans per execution.
 */
export function registerTelemetryBridge(ctx: Plugin.Context, options: TelemetryBridgeOptions): (() => void) {
  if (options.endpoint) process.env.PHOENIX_ENDPOINT = options.endpoint
  if (options.project) process.env.PHOENIX_PROJECT = options.project

  initTelemetry()
  if (!getTracer()) {
    log("[plugin-v2/telemetry] tracer unavailable, bridge idle")
    return () => {}
  }

  const openToolSpans = new Map<string, Span[]>()

  function toolSpanKey(sessionID: string, tool: string): string {
    return `${sessionID}:${tool}`
  }

  void ctx.tool.hook("execute.before", (event) => {
    setCurrentSessionID(event.sessionID)
    const tracer = getTracer()
    if (!tracer) return
    const key = toolSpanKey(event.sessionID, event.tool)
    const queue = openToolSpans.get(key) ?? []
    queue.push(tracer.startSpan(`tool.${event.tool}`, {
      attributes: {
        "openinference.span.kind": "TOOL",
        "session.id": event.sessionID,
        "tool.name": event.tool,
      },
    }))
    openToolSpans.set(key, queue)
  })

  void ctx.tool.hook("execute.after", (event) => {
    const key = toolSpanKey(event.sessionID, event.tool)
    const queue = openToolSpans.get(key)
    const span = queue?.shift()
    if (queue && queue.length === 0) openToolSpans.delete(key)
    if (!span) return

    if (event.status === "error") {
      span.setStatus({ code: 2, message: event.error.message })
    } else {
      span.setStatus({ code: 1 })
    }
    span.end()
  })

  const controller = new AbortController()
  consumeEventStream(ctx, controller)

  return () => {
    controller.abort()
    void flushTracer()
  }
}

function consumeEventStream(ctx: Plugin.Context, controller: AbortController): void {
  void (async () => {
    try {
      for await (const event of ctx.event.subscribe({ signal: controller.signal })) {
        const candidate = event as EventLike

        if (candidate.type === "message.updated") {
          const info = nestedInfo(eventPayload(candidate))
          if (!info) continue
          const role = info.role
          if (role === "user") {
            startTurnSpan(String(info.sessionID ?? ""), String(info.agent ?? "unknown"))
          }
          if (role === "assistant" && (info.finish !== undefined || info.error !== undefined)) {
            endTurnSpan(String(info.sessionID ?? ""))
          }
          trackMessageEvent(info)
          continue
        }

        if (candidate.type === "message.part.updated") {
          const part = eventPayload(candidate)
          if (part) trackPartEvent(part)
        }
      }
    } catch {
      // stream aborted on plugin teardown
    }
  })()
}
