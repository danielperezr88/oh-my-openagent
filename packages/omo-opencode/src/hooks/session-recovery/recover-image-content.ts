import type { createOpencodeClient } from "@opencode-ai/sdk"
import { normalizeSDKResponse } from "../../shared/normalize-sdk-response"
import { deletePart, patchPart } from "../../shared/opencode-http-api"
import { log } from "../../shared/logger"
import { generatePartId } from "../anthropic-context-window-limit-recovery/storage/part-id"
import type { MessageData } from "./types"

type Client = ReturnType<typeof createOpencodeClient>

type ImagePartCandidate = {
  type: string
  id?: string
  mime?: unknown
}

export type RecoverImageContentDeps = {
  normalizeMessages: (response: unknown) => MessageData[]
  patchPart: (
    client: Client,
    sessionID: string,
    messageID: string,
    partID: string,
    body: Record<string, unknown>,
  ) => Promise<boolean>
  deletePart: (client: Client, sessionID: string, messageID: string, partID: string) => Promise<boolean>
  generatePartId: () => string
  log: typeof log
}

const productionDeps: RecoverImageContentDeps = {
  normalizeMessages: (response) => normalizeSDKResponse(response, [] as MessageData[]),
  patchPart,
  deletePart,
  generatePartId,
  log,
}

export function isImagePart(part: ImagePartCandidate): boolean {
  if (part.type === "image") return true
  if (part.type !== "file") return false
  return typeof part.mime === "string" && part.mime.toLowerCase().startsWith("image/")
}

export function buildImagePlaceholderText(messageID: string): string {
  return `[image attachment removed: image content is not supported by the current model. It was attached in message ${messageID}. Continue with text only.]`
}

function buildPlaceholderPart(
  partID: string,
  sessionID: string,
  messageID: string,
): Record<string, unknown> {
  return {
    id: partID,
    sessionID,
    messageID,
    type: "text",
    text: buildImagePlaceholderText(messageID),
    synthetic: true,
  }
}

async function replaceImagePart(
  client: Client,
  sessionID: string,
  messageID: string,
  partID: string,
  deps: RecoverImageContentDeps,
): Promise<boolean> {
  const patched = await deps.patchPart(
    client,
    sessionID,
    messageID,
    partID,
    buildPlaceholderPart(partID, sessionID, messageID),
  )
  if (patched) {
    return true
  }

  const deleted = await deps.deletePart(client, sessionID, messageID, partID)
  if (!deleted) {
    return false
  }

  const replacementPartID = deps.generatePartId()
  return deps.patchPart(
    client,
    sessionID,
    messageID,
    replacementPartID,
    buildPlaceholderPart(replacementPartID, sessionID, messageID),
  )
}

export async function recoverImageContent(
  client: Client,
  sessionID: string,
  deps: RecoverImageContentDeps = productionDeps,
): Promise<boolean> {
  let response: unknown
  try {
    response = await client.session.messages({ path: { id: sessionID } })
  } catch (error) {
    if (!(error instanceof Error)) {
      throw error
    }
    deps.log("[session-recovery] recoverImageContent failed to fetch messages", { sessionID, error })
    return false
  }

  const messages = deps.normalizeMessages(response)
  let replaced = 0

  for (const message of messages) {
    const messageID = message.info?.id
    if (!messageID || !message.parts) continue

    for (const part of message.parts) {
      if (!part.id || !isImagePart(part)) continue

      if (await replaceImagePart(client, sessionID, messageID, part.id, deps)) {
        replaced += 1
      }
    }
  }

  if (replaced > 0) {
    deps.log("[session-recovery] Replaced image parts with text placeholders", { sessionID, replaced })
  }
  return replaced > 0
}
