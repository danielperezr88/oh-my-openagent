import { log } from "../shared/logger"
import { buildImagePlaceholderText } from "../hooks/session-recovery/recover-image-content"

type RequestPartLike = {
  type?: unknown
  mime?: unknown
  mediaType?: unknown
  mimeType?: unknown
}

export type RequestMessageLike = {
  id?: unknown
  content?: unknown
  parts?: unknown
}

function resolvePartMimeType(candidate: RequestPartLike): string {
  if (typeof candidate.mime === "string") return candidate.mime
  if (typeof candidate.mediaType === "string") return candidate.mediaType
  if (typeof candidate.mimeType === "string") return candidate.mimeType
  return ""
}

function partCarriesImageData(part: unknown): boolean {
  if (typeof part !== "object" || part === null) return false
  for (const value of Object.values(part as Record<string, unknown>)) {
    if (typeof value === "string" && value.toLowerCase().startsWith("data:image/")) return true
  }
  return false
}

export function isImageRequestPart(part: unknown): boolean {
  if (typeof part !== "object" || part === null) return false
  const candidate = part as RequestPartLike
  if (candidate.type === "image" || candidate.type === "image_url") return true
  if (resolvePartMimeType(candidate).toLowerCase().startsWith("image/")) return true
  return partCarriesImageData(part)
}

export function shouldStripRequestPart(part: unknown): boolean {
  if (typeof part !== "object" || part === null) return false
  if ((part as RequestPartLike).type === "media") return true
  return isImageRequestPart(part)
}

function buildPlaceholderText(messageID: string, image: boolean): string {
  if (image) return buildImagePlaceholderText(messageID)
  return `[media attachment removed: media content is not supported by the current model. It was attached in message ${messageID}. Continue with text only.]`
}

export function resolveRequestSegments(message: RequestMessageLike): unknown[] | null {
  if (Array.isArray(message.parts)) return message.parts
  if (Array.isArray(message.content)) return message.content
  return null
}

function resolveMessageLabel(message: RequestMessageLike): string {
  return typeof message.id === "string" && message.id.length > 0 ? message.id : "the originating message"
}

export function stripMediaPartsFromMessages(messages: ReadonlyArray<unknown>): number {
  let stripped = 0
  for (const message of messages) {
    if (typeof message !== "object" || message === null) continue
    const candidate = message as RequestMessageLike
    const segments = resolveRequestSegments(candidate)
    if (segments === null) continue
    const label = resolveMessageLabel(candidate)
    try {
      for (let index = segments.length - 1; index >= 0; index--) {
        const part = segments[index]
        if (!shouldStripRequestPart(part)) continue
        const placeholder = {
          type: "text",
          text: buildPlaceholderText(label, isImageRequestPart(part)),
        }
        segments.splice(index, 1, placeholder)
        stripped += 1
      }
    } catch (error) {
      log(`[plugin-v2/session-recovery] strip skipped for message ${label}: ${String(error)}`)
    }
  }
  return stripped
}
