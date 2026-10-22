type RequestPartLike = {
  type?: unknown
  mime?: unknown
  mediaType?: unknown
  mimeType?: unknown
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

function previewValue(value: unknown): string {
  if (typeof value === "string") return value.slice(0, 50)
  try {
    const encoded = JSON.stringify(value)
    return typeof encoded === "string" ? encoded.slice(0, 50) : typeof value
  } catch {
    return typeof value
  }
}

export function formatMessageInventory(messages: ReadonlyArray<unknown>): string {
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
