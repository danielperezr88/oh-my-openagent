import type { Span, SpanContext } from "@opentelemetry/api";
import { getTracer } from "./tracer";
import { log } from "../shared/logger";

// Per-session active root span (one per conversation turn)
const activeTurnSpans = new Map<string, Span>();

// Maps child session ID → root session ID for cross-trace grouping
const sessionRootMap = new Map<string, string>();

export function startTurnSpan(sessionID: string, agent: string): void {
  const tracer = getTracer();
  if (!tracer) return;

  endTurnSpan(sessionID);

  const span = tracer.startSpan(`turn`, {
    attributes: {
      "openinference.span.kind": "CHAIN",
      "session.id": sessionID,
      "agent.name": agent,
    },
  });
  activeTurnSpans.set(sessionID, span);
}

export function endTurnSpan(sessionID: string): void {
  const span = activeTurnSpans.get(sessionID);
  if (span) {
    span.end();
    activeTurnSpans.delete(sessionID);
  }
}

export function getActiveTurnContext(sessionID: string): SpanContext | undefined {
  return activeTurnSpans.get(sessionID)?.spanContext();
}

export function registerSessionRoot(sessionID: string, rootSessionID: string): void {
  sessionRootMap.set(sessionID, rootSessionID);
}

export function getSessionRootID(sessionID: string): string | undefined {
  return sessionRootMap.get(sessionID);
}

export function deleteSessionRoot(sessionID: string): void {
  sessionRootMap.delete(sessionID);
}

const DELEGATION_TRUNCATE_LIMIT = 10240;

export function trackAgentDelegation(
  parentSessionID: string,
  childSessionID: string,
  agent: string,
  prompt: string,
  rootSessionID?: string,
): void {
  const tracer = getTracer();
  log("[telemetry] trackAgentDelegation called", {
    agent,
    parentSessionID: parentSessionID.slice(0, 12),
    childSessionID: childSessionID.slice(0, 12),
    hasTracer: !!tracer,
    hasRootID: !!rootSessionID,
  });
  if (!tracer) {
    log("[telemetry] trackAgentDelegation SKIPPED: no tracer", { agent });
    return;
  }

  const parentCtx = getActiveTurnContext(parentSessionID);
  log("[telemetry] trackAgentDelegation parentCtx", {
    hasParentCtx: !!parentCtx,
    parentCtxTraceID: parentCtx?.traceId?.slice(0, 12),
  });
  const span = tracer.startSpan("agent.delegation", {
    ...(parentCtx ? { links: [{ context: parentCtx }] } : {}),
  });

  span.setAttribute("openinference.span.kind", "AGENT");
  span.setAttribute("session.id", parentSessionID);
  span.setAttribute("agent.delegation.child_session_id", childSessionID);
  span.setAttribute("agent.delegation.agent", agent);
  if (rootSessionID) {
    span.setAttribute("session.root_id", rootSessionID);
  }
  span.setAttribute("input.value", prompt.length > DELEGATION_TRUNCATE_LIMIT ? prompt.slice(0, DELEGATION_TRUNCATE_LIMIT) + "..." : prompt);
  span.setStatus({ code: 1 });
  span.end();
  log("[telemetry] trackAgentDelegation span ended", { agent, spanContext: span.spanContext()?.spanId?.slice(0, 12) });

  if (rootSessionID) {
    registerSessionRoot(childSessionID, rootSessionID);
  }
}
