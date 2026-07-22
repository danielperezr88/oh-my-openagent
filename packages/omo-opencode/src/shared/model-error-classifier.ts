import {
  getNextFallback,
  hasMoreFallbacks,
  isRetryableModelError,
  selectFallbackProviderWithCache,
} from "@oh-my-opencode/model-core"
import type { ErrorInfo } from "@oh-my-opencode/model-core"
import * as connectedProvidersCache from "./connected-providers-cache"

export type { ErrorInfo }
export {
  isRetryableModelError,
  getNextFallback,
  hasMoreFallbacks,
  selectFallbackProviderWithCache,
}

export function selectFallbackProvider(
  providers: string[],
  preferredProviderID?: string,
): string {
  return selectFallbackProviderWithCache(
    providers,
    connectedProvidersCache,
    preferredProviderID,
  )
}

/**
 * Determines if an error should trigger a fallback retry.
 * Wraps the upstream classifier with z.ai-specific handling:
 * 1. z.ai platform overload codes (1308 etc.) are always retryable
 * 2. z.ai temporary "Usage limit reached for X hour" with reset time is retryable
 * 3. Generic "usage limit has been reached" without reset time is non-retryable (STOP)
 */
export function shouldRetryError(error: ErrorInfo): boolean {
  const msg = (error.message ?? "").toLowerCase()

  // z.ai platform error codes (1308 etc.) are always retryable
  if (isProviderOverloadedError(error)) {
    return true
  }

  // z.ai "Usage limit reached for X hour. Your limit will reset at..." is retryable
  // (upstream STOP pattern "usage limit reached for" incorrectly catches this)
  if (msg.includes("usage limit reached for") && msg.includes("limit will reset at")) {
    return true
  }

  // Generic "usage limit has been reached" without reset time is non-retryable
  // (upstream RETRYABLE pattern "usage limit has been reached" incorrectly catches this)
  if (msg.includes("usage limit has been reached") && !msg.includes("limit will reset at")) {
    return false
  }

  return isRetryableModelError(error)
}

// --- z.ai / platform-specific error detection ---

/** Platform error codes that indicate provider-wide issues (affects ALL models on that provider). */
const PROVIDER_OVERLOAD_CODES = new Set(["1234", "1305", "1308", "1312"])

/**
 * Parse a platform error code (e.g. "1305") from the nested responseBody JSON.
 * z.ai returns errors like: {"error":{"code":"1305","message":"..."}}
 * These get wrapped inside the SDK's AI_TypeValidationError responseBody.
 */
export function extractPlatformErrorCode(error: unknown): string | null {
  if (!error || typeof error !== "object") return null

  const errObj = error as Record<string, unknown>
  const data = errObj.data as Record<string, unknown> | undefined

  const candidates: string[] = []
  if (typeof data?.responseBody === "string") candidates.push(data.responseBody)
  if (typeof data?.message === "string") candidates.push(data.message)
  if (typeof errObj.message === "string") candidates.push(errObj.message)

  for (const text of candidates) {
    const codeMatch = text.match(/"code"\s*:\s*"(\d+)"/)
    if (codeMatch) return codeMatch[1]
  }

  return null
}

/**
 * True for provider-level overload errors that affect ALL models on that provider.
 * These should trigger provider-wide cooldown, not just model-level fallback.
 */
export function isProviderOverloadedError(error: unknown): boolean {
  const code = extractPlatformErrorCode(error)
  return code !== null && PROVIDER_OVERLOAD_CODES.has(code)
}

/** Known hostname → provider ID mappings for error URL detection. */
const ERROR_URL_PROVIDER_MAP: Record<string, string> = {
  "api.z.ai": "zai-coding-plan",
}

/**
 * Map an error's metadata.url hostname to a provider ID.
 * E.g. "https://api.z.ai/api/anthropic/v1/messages" → "zai-coding-plan"
 */
export function extractProviderFromErrorUrl(error: unknown): string | null {
  if (!error || typeof error !== "object") return null

  const errObj = error as Record<string, unknown>
  const data = errObj.data as Record<string, unknown> | undefined
  const metadata = data?.metadata as Record<string, unknown> | undefined
  const url = metadata?.url as string | undefined

  if (!url) return null

  try {
    const hostname = new URL(url).hostname.toLowerCase()
    return ERROR_URL_PROVIDER_MAP[hostname] ?? null
  } catch {
    return null
  }
}
