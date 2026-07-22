import type { Span } from "@opentelemetry/api";

const activeSpans = new Map<string, Span>();

export function spanKey(sessionID: string, callID: string): string {
  return `${sessionID}:${callID}`;
}

export function setActiveSpan(key: string, span: Span): void {
  activeSpans.set(key, span);
}

export function getActiveSpan(key: string): Span | undefined {
  return activeSpans.get(key);
}

export function removeActiveSpan(key: string): void {
  activeSpans.delete(key);
}
