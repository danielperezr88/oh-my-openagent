import type { Plugin } from "@opencode/plugin"
import { log } from "../shared/logger"
import { isRecord } from "../shared/record-type-guard"
import { emptyArmedRecovery, mergeArmedRecovery, type ArmedRecovery } from "./session-recovery-strategies"

type StorageDomain = Plugin.Context["storage"]

/** Keys under this prefix store `{ sessionID, stripMedia: true }` for sessions whose arming must survive restarts. */
const ARMED_STORAGE_PREFIX = "omo/session-recovery/armed/"

const MAX_SCAN_PAGES = 100

export function armedRecoveryStorageKey(sessionID: string): string {
  return `${ARMED_STORAGE_PREFIX}${sessionID}`
}

export function resolveStorageDomain(ctx: Plugin.Context): StorageDomain | null {
  const domain = (ctx as { storage?: unknown }).storage
  if (!isRecord(domain)) return null
  if (
    typeof domain.get !== "function" ||
    typeof domain.set !== "function" ||
    typeof domain.remove !== "function" ||
    typeof domain.scan !== "function"
  ) {
    return null
  }
  return {
    get: domain.get as StorageDomain["get"],
    set: domain.set as StorageDomain["set"],
    remove: domain.remove as StorageDomain["remove"],
    scan: domain.scan as StorageDomain["scan"],
  }
}

function parsePersistedArming(value: unknown): { sessionID: string; stripMedia: boolean } | null {
  if (!isRecord(value)) return null
  const sessionID = value.sessionID
  if (typeof sessionID !== "string" || sessionID.length === 0) return null
  return { sessionID, stripMedia: value.stripMedia === true }
}

export async function loadPersistedRecoveryArming(
  storage: StorageDomain,
  recoveringSessions: Map<string, ArmedRecovery>,
): Promise<void> {
  let after: string | undefined
  let restored = 0
  try {
    for (let page = 0; page < MAX_SCAN_PAGES; page += 1) {
      const result = await storage.scan({ prefix: ARMED_STORAGE_PREFIX, after })
      for (const entry of result.entries) {
        const armed = parsePersistedArming(entry.value)
        if (armed === null) continue
        const current = recoveringSessions.get(armed.sessionID) ?? emptyArmedRecovery()
        recoveringSessions.set(armed.sessionID, mergeArmedRecovery(current, { stripMedia: armed.stripMedia }))
        restored += 1
      }
      if (typeof result.next !== "string" || result.next.length === 0) break
      after = result.next
    }
  } catch (error) {
    log(`[plugin-v2/session-recovery] failed to load persisted recovery arming: ${String(error)}`)
    return
  }
  if (restored > 0) {
    log(`[plugin-v2/session-recovery] restored ${restored} persisted recovery arming(s) after restart`)
  }
}

export function persistRecoveryArming(storage: StorageDomain, sessionID: string, armed: ArmedRecovery): void {
  if (!armed.stripMedia) return
  const key = armedRecoveryStorageKey(sessionID)
  const value = { sessionID, stripMedia: true }
  void storage
    .set(key, value)
    .then(() => {
      log(`[plugin-v2/session-recovery] persisted strip-media arming for session ${sessionID}`)
    })
    .catch((error: unknown) => {
      log(`[plugin-v2/session-recovery] failed to persist strip-media arming for session ${sessionID}: ${String(error)}`)
    })
}
