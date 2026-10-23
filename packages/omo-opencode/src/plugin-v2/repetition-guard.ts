import type { Plugin } from "@opencode/plugin"
import { log } from "../shared/logger"

export interface RepetitionGuardThresholds {
  /** Trailing same-tool streak length that trips the guard. */
  readonly minCalls: number
  /** Distinct input fingerprints tolerated inside the streak; 2 catches A/B alternation. */
  readonly maxDistinctInputs: number
  /** The streak only counts while the average interval between calls stays under this. */
  readonly rapidIntervalMs: number
  /** Bounded per-session history length in tracked calls. */
  readonly historySize: number
}

export const DEFAULT_REPETITION_GUARD_THRESHOLDS: RepetitionGuardThresholds = {
  minCalls: 6,
  maxDistinctInputs: 2,
  rapidIntervalMs: 30_000,
  historySize: 32,
}

const MAX_TRACKED_SESSIONS = 128

interface TrackedCall {
  readonly tool: string
  readonly fingerprint: string
  readonly at: number
}

function positiveFinite(value: number | undefined, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : fallback
}

/**
 * Merges partial overrides onto the defaults. Explicit undefined members (an
 * absent config key wired through as undefined) and invalid numbers are
 * rejected; a plain spread would let undefined win over the defaults and turn
 * every threshold comparison into NaN.
 */
export function resolveRepetitionThresholds(overrides?: Partial<RepetitionGuardThresholds>): RepetitionGuardThresholds {
  const defaults = DEFAULT_REPETITION_GUARD_THRESHOLDS
  return {
    minCalls: positiveFinite(overrides?.minCalls, defaults.minCalls),
    maxDistinctInputs: positiveFinite(overrides?.maxDistinctInputs, defaults.maxDistinctInputs),
    rapidIntervalMs: positiveFinite(overrides?.rapidIntervalMs, defaults.rapidIntervalMs),
    historySize: positiveFinite(overrides?.historySize, defaults.historySize),
  }
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") {
    const text = JSON.stringify(value)
    return text === undefined ? "undefined" : text
  }
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`
  const record = value as Record<string, unknown>
  const keys = Object.keys(record).sort()
  return `{${keys.map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`).join(",")}}`
}

/** Stable fingerprint of a tool input; member order differences normalize away. */
export function fingerprintToolInput(input: unknown): string {
  const text = stableStringify(input)
  let hash = 5381
  for (let index = 0; index < text.length; index += 1) {
    hash = ((hash << 5) + hash + text.charCodeAt(index)) | 0
  }
  return `h${hash}`
}

export interface RepetitionTracker {
  observe(tool: string, sessionID: string, input: unknown, now: number): string | null
  forgetSession(sessionID: string): void
}

/**
 * Detects compulsive tool repetition inside one session: a trailing streak of
 * same-tool calls whose distinct inputs stay under maxDistinctInputs while the
 * average interval between them stays under rapidIntervalMs. Slow deliberate
 * polling (a long-running call re-issued every few minutes) never trips it.
 * A different tool breaks the streak; a different session never shares one.
 */
export function createRepetitionTracker(thresholds: RepetitionGuardThresholds): RepetitionTracker {
  const history = new Map<string, TrackedCall[]>()

  function tracked(sessionID: string): TrackedCall[] {
    let calls = history.get(sessionID)
    if (!calls) {
      if (history.size >= MAX_TRACKED_SESSIONS) {
        const oldest = history.keys().next().value
        if (oldest !== undefined) history.delete(oldest)
      }
      calls = []
      history.set(sessionID, calls)
    }
    return calls
  }

  function observe(tool: string, sessionID: string, input: unknown, now: number): string | null {
    const calls = tracked(sessionID)
    calls.push({ tool, fingerprint: fingerprintToolInput(input), at: now })
    if (calls.length > thresholds.historySize) calls.splice(0, calls.length - thresholds.historySize)

    let start = calls.length - 1
    while (start > 0 && calls[start - 1].tool === tool) start -= 1
    const streak = calls.length - start
    if (streak < thresholds.minCalls) return null

    const streakCalls = calls.slice(start)
    const distinct = new Set(streakCalls.map((call) => call.fingerprint))
    if (distinct.size > thresholds.maxDistinctInputs) return null

    const spanMs = now - streakCalls[0].at
    if (spanMs > streak * thresholds.rapidIntervalMs) return null

    const spanSeconds = Math.round(spanMs / 1000)
    return (
      `Degenerate repetition blocked: '${tool}' was called ${streak} times in a row with ` +
      `near-identical arguments over ${spanSeconds}s. The results are already in the conversation; ` +
      `repeating will not add anything. Change approach: use different arguments, a different tool, ` +
      `or stop and summarize what you already have.`
    )
  }

  function forgetSession(sessionID: string): void {
    history.delete(sessionID)
  }

  return { observe, forgetSession }
}

/** Registers the degenerate-repetition guard on the v2 tool execute.before hook. */
export function registerRepetitionGuard(
  ctx: Plugin.Context,
  overrides?: Partial<RepetitionGuardThresholds>,
): void {
  const thresholds = resolveRepetitionThresholds(overrides)
  const tracker = createRepetitionTracker(thresholds)
  void ctx.tool.hook("execute.before", (event) => {
    const reason = tracker.observe(event.tool, event.sessionID, event.input, Date.now())
    if (reason) {
      log(
        `[plugin-v2/repetition-guard] blocked '${event.tool}' streak >= ${thresholds.minCalls} ` +
          `in session ${event.sessionID}`,
      )
      throw new Error(reason)
    }
  })
}
