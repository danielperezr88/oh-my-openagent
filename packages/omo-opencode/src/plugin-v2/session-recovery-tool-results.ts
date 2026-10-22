import { resolveRequestSegments, type RequestMessageLike } from "./session-recovery-strip"

export const CANCELLED_TOOL_RESULT_TEXT = "Operation cancelled by user (ESC pressed)"
export const UNAVAILABLE_TOOL_RESULT_TEXT = "Tool not available. Please continue without this tool."

export type ToolCallInfo = {
  readonly id: string
  readonly name: string
  readonly namespace?: string
}

type ToolPartLike = {
  type?: unknown
  id?: unknown
  name?: unknown
  namespace?: unknown
}

export function isToolCallRequestPart(part: unknown): boolean {
  if (typeof part !== "object" || part === null) return false
  const candidate = part as ToolPartLike
  if (candidate.type !== "tool-call" && candidate.type !== "tool_use") return false
  return typeof candidate.id === "string" && candidate.id.length > 0 && typeof candidate.name === "string"
}

export function isToolResultRequestPart(part: unknown): boolean {
  if (typeof part !== "object" || part === null) return false
  const candidate = part as ToolPartLike
  if (candidate.type !== "tool-result" && candidate.type !== "tool_result") return false
  return typeof candidate.id === "string" && candidate.id.length > 0
}

export function buildSyntheticToolResultPart(call: ToolCallInfo, resultText: string): Record<string, unknown> {
  const part: Record<string, unknown> = {
    type: "tool-result",
    id: call.id,
    name: call.name,
    result: { type: "error", value: resultText },
  }
  if (typeof call.namespace === "string" && call.namespace.length > 0) part.namespace = call.namespace
  return part
}

function extractToolCallInfo(part: unknown): ToolCallInfo | null {
  if (!isToolCallRequestPart(part)) return null
  const candidate = part as ToolPartLike
  const namespace = typeof candidate.namespace === "string" ? candidate.namespace : undefined
  return { id: candidate.id as string, name: candidate.name as string, namespace }
}

function collectToolResultIds(messages: ReadonlyArray<unknown>): Set<string> {
  const ids = new Set<string>()
  for (const message of messages) {
    if (typeof message !== "object" || message === null) continue
    const segments = resolveRequestSegments(message as RequestMessageLike)
    if (segments === null) continue
    for (const part of segments) {
      if (isToolResultRequestPart(part)) ids.add((part as ToolPartLike).id as string)
    }
  }
  return ids
}

function isToolRoleMessage(message: unknown): boolean {
  if (typeof message !== "object" || message === null) return false
  return (message as { role?: unknown }).role === "tool"
}

export function summarizeToolPairs(messages: ReadonlyArray<unknown>): string {
  const calls: string[] = []
  let results = 0
  for (const message of messages) {
    if (typeof message !== "object" || message === null) continue
    const segments = resolveRequestSegments(message as RequestMessageLike)
    if (segments === null) continue
    for (const part of segments) {
      if (isToolCallRequestPart(part)) {
        const candidate = part as ToolPartLike
        calls.push(`${candidate.id}:${candidate.name}`)
      } else if (isToolResultRequestPart(part)) {
        results += 1
      }
    }
  }
  return `toolCalls=${calls.length}[${calls.slice(0, 6).join("|")}] toolResults=${results}`
}

export function injectMissingToolResults(messages: ReadonlyArray<unknown>, resultText: string): number {
  const resultIds = collectToolResultIds(messages)
  const orphansByMessage = new Map<number, ToolCallInfo[]>()
  for (let index = 0; index < messages.length; index += 1) {
    const message = messages[index]
    if (typeof message !== "object" || message === null) continue
    const segments = resolveRequestSegments(message as RequestMessageLike)
    if (segments === null) continue
    const calls: ToolCallInfo[] = []
    for (const part of segments) {
      const call = extractToolCallInfo(part)
      if (call === null || resultIds.has(call.id)) continue
      calls.push(call)
    }
    if (calls.length > 0) orphansByMessage.set(index, calls)
  }
  if (orphansByMessage.size === 0) return 0

  let injected = 0
  const mutable = messages as unknown[]
  for (const [index, calls] of [...orphansByMessage.entries()].sort((a, b) => b[0] - a[0])) {
    const parts = calls.map((call) => buildSyntheticToolResultPart(call, resultText))
    injected += parts.length
    const following = mutable[index + 1]
    const followingSegments =
      isToolRoleMessage(following) && typeof following === "object"
        ? resolveRequestSegments(following as RequestMessageLike)
        : null
    if (followingSegments !== null) {
      followingSegments.push(...parts)
    } else {
      mutable.splice(index + 1, 0, { role: "tool", content: parts })
    }
  }
  return injected
}
