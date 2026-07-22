import { getTracer } from "./tracer"

let globalToolNames: string[] = []

export function setGlobalToolNames(names: string[]): void {
  globalToolNames = names
}

export function trackToolResolution(
  sessionID: string,
  agent: string,
  restrictions: Record<string, boolean>,
): void {
  const tracer = getTracer()
  if (!tracer) return

  const span = tracer.startSpan("tool.resolution")

  span.setAttribute("openinference.span.kind", "TOOL")
  span.setAttribute("session.id", sessionID)
  span.setAttribute("agent.name", agent)

  // Record the restrictions map
  const denied = Object.entries(restrictions)
    .filter(([, v]) => v === false)
    .map(([k]) => k)
  const allowed = Object.entries(restrictions)
    .filter(([, v]) => v === true)
    .map(([k]) => k)

  span.setAttribute("tool.restrictions.denied", JSON.stringify(denied))
  span.setAttribute("tool.restrictions.allowed_explicit", JSON.stringify(allowed))

  // Compute the resolved tool set (global minus denied)
  const resolved = globalToolNames.filter(
    (name) => restrictions[name] !== false,
  )
  span.setAttribute("tool.resolved_count", resolved.length)
  span.setAttribute("tool.resolved_names", JSON.stringify(resolved))

  // Doc-store visibility check
  const docStoreTools = resolved.filter((name) =>
    name.startsWith("doc_store_"),
  )
  span.setAttribute("tool.doc_store_count", docStoreTools.length)
  span.setAttribute("tool.doc_store_names", JSON.stringify(docStoreTools))
  span.setAttribute("tool.doc_store_present", docStoreTools.length === 7)

  span.setStatus({ code: 1 })
  span.end()
}
