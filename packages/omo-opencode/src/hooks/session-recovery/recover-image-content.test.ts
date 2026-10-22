/// <reference types="bun-types" />
import { describe, expect, it } from "bun:test"

import {
  buildImagePlaceholderText,
  isImagePart,
  recoverImageContent,
  type RecoverImageContentDeps,
} from "./recover-image-content"
import type { MessageData } from "./types"

type Client = Parameters<typeof recoverImageContent>[0]

type PatchCall = {
  sessionID: string
  messageID: string
  partID: string
  body: Record<string, unknown>
}

type DeleteCall = { sessionID: string; messageID: string; partID: string }

type PartLiteral = { type: string; id?: string; mime?: string; text?: string }

function toMessages(
  rows: Array<{ id: string; role: string; parts: PartLiteral[] }>,
): MessageData[] {
  return rows.map((row) => ({
    info: { id: row.id, role: row.role },
    parts: row.parts as unknown as MessageData["parts"],
  }))
}

function createMockClient(messages: MessageData[]): Client {
  return {
    session: {
      messages: async () => ({ data: messages }),
    },
  } as never as Client
}

function createFailingMessagesClient(): Client {
  return {
    session: {
      messages: async () => {
        throw new Error("network down")
      },
    },
  } as never as Client
}

function createDeps(options?: { patchResults?: boolean[]; deleteResult?: boolean }): {
  deps: RecoverImageContentDeps
  patchCalls: PatchCall[]
  deleteCalls: DeleteCall[]
} {
  const patchCalls: PatchCall[] = []
  const deleteCalls: DeleteCall[] = []
  const patchResults = options?.patchResults ?? [true]
  const deleteResult = options?.deleteResult ?? true
  let patchCallIndex = 0

  const deps: RecoverImageContentDeps = {
    normalizeMessages: (response) => (response as { data: MessageData[] }).data,
    patchPart: async (_client, sessionID, messageID, partID, body) => {
      patchCalls.push({ sessionID, messageID, partID, body })
      const result = patchResults[patchCallIndex] ?? patchResults[patchResults.length - 1]
      patchCallIndex += 1
      return result ?? false
    },
    deletePart: async (_client, sessionID, messageID, partID) => {
      deleteCalls.push({ sessionID, messageID, partID })
      return deleteResult
    },
    generatePartId: () => "prt_generated_1",
    log: () => {},
  }

  return { deps, patchCalls, deleteCalls }
}

describe("isImagePart", () => {
  it("#given a file part with an image mime #when checking #then is an image part", () => {
    expect(isImagePart({ type: "file", mime: "image/png" })).toBe(true)
  })

  it("#given an image type part #when checking #then is an image part", () => {
    expect(isImagePart({ type: "image" })).toBe(true)
  })

  it("#given a file part with a pdf mime #when checking #then is not an image part", () => {
    expect(isImagePart({ type: "file", mime: "application/pdf" })).toBe(false)
  })

  it("#given a text part #when checking #then is not an image part", () => {
    expect(isImagePart({ type: "text" })).toBe(false)
  })
})

describe("recoverImageContent", () => {
  it("#given a session history with an image file part #when recovering #then patches it into a text placeholder", async () => {
    //#given
    const messages = toMessages([
      { id: "msg_user_1", role: "user", parts: [{ type: "file", id: "prt_img_1", mime: "image/png" }] },
      { id: "msg_asst_1", role: "assistant", parts: [{ type: "text", id: "prt_txt_1", text: "hello" }] },
    ])
    const client = createMockClient(messages)
    const { deps, patchCalls, deleteCalls } = createDeps()

    //#when
    const result = await recoverImageContent(client, "ses_1", deps)

    //#then
    expect(result).toBe(true)
    expect(patchCalls.length).toBe(1)
    expect(patchCalls[0]?.partID).toBe("prt_img_1")
    expect(patchCalls[0]?.messageID).toBe("msg_user_1")
    expect(patchCalls[0]?.body.type).toBe("text")
    expect(patchCalls[0]?.body.text).toContain("[image attachment removed")
    expect(patchCalls[0]?.body.synthetic).toBe(true)
    expect(deleteCalls.length).toBe(0)
  })

  it("#given multiple image parts across messages #when recovering #then replaces every image part", async () => {
    //#given
    const messages = toMessages([
      { id: "msg_user_1", role: "user", parts: [{ type: "file", id: "prt_img_1", mime: "image/jpeg" }] },
      { id: "msg_user_2", role: "user", parts: [{ type: "file", id: "prt_img_2", mime: "image/webp" }] },
    ])
    const client = createMockClient(messages)
    const { deps, patchCalls } = createDeps()

    //#when
    const result = await recoverImageContent(client, "ses_2", deps)

    //#then
    expect(result).toBe(true)
    expect(patchCalls.length).toBe(2)
    expect(patchCalls[0]?.partID).toBe("prt_img_1")
    expect(patchCalls[1]?.partID).toBe("prt_img_2")
  })

  it("#given a session history without image parts #when recovering #then returns false without patching", async () => {
    //#given
    const messages = toMessages([
      { id: "msg_user_1", role: "user", parts: [{ type: "text", id: "prt_txt_1", text: "plain" }] },
    ])
    const client = createMockClient(messages)
    const { deps, patchCalls, deleteCalls } = createDeps()

    //#when
    const result = await recoverImageContent(client, "ses_3", deps)

    //#then
    expect(result).toBe(false)
    expect(patchCalls.length).toBe(0)
    expect(deleteCalls.length).toBe(0)
  })

  it("#given a failed patch #when recovering #then falls back to delete plus a fresh text part", async () => {
    //#given
    const messages = toMessages([
      { id: "msg_user_1", role: "user", parts: [{ type: "file", id: "prt_img_1", mime: "image/png" }] },
    ])
    const client = createMockClient(messages)
    const { deps, patchCalls, deleteCalls } = createDeps({ patchResults: [false, true] })

    //#when
    const result = await recoverImageContent(client, "ses_4", deps)

    //#then
    expect(result).toBe(true)
    expect(deleteCalls.length).toBe(1)
    expect(deleteCalls[0]?.partID).toBe("prt_img_1")
    expect(patchCalls.length).toBe(2)
    expect(patchCalls[0]?.partID).toBe("prt_img_1")
    expect(patchCalls[1]?.partID).toBe("prt_generated_1")
    expect(patchCalls[1]?.body.type).toBe("text")
    expect(patchCalls[1]?.body.text).toContain("[image attachment removed")
  })

  it("#given a failed patch and a failed delete #when recovering #then returns false", async () => {
    //#given
    const messages = toMessages([
      { id: "msg_user_1", role: "user", parts: [{ type: "file", id: "prt_img_1", mime: "image/png" }] },
    ])
    const client = createMockClient(messages)
    const { deps, patchCalls, deleteCalls } = createDeps({ patchResults: [false], deleteResult: false })

    //#when
    const result = await recoverImageContent(client, "ses_5", deps)

    //#then
    expect(result).toBe(false)
    expect(patchCalls.length).toBe(1)
    expect(deleteCalls.length).toBe(1)
  })

  it("#given a messages fetch failure #when recovering #then returns false without patching", async () => {
    //#given
    const client = createFailingMessagesClient()
    const { deps, patchCalls } = createDeps()

    //#when
    const result = await recoverImageContent(client, "ses_6", deps)

    //#then
    expect(result).toBe(false)
    expect(patchCalls.length).toBe(0)
  })
})

describe("buildImagePlaceholderText", () => {
  it("#given a message id #when building the placeholder #then mentions the message and continues in text", () => {
    const text = buildImagePlaceholderText("msg_user_9")
    expect(text).toContain("msg_user_9")
    expect(text).toContain("image")
    expect(text).toContain("text")
  })
})
