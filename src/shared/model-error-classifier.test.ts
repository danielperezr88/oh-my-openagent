declare const require: (name: string) => any
const { describe, expect, test, beforeEach, afterEach, mock, spyOn } = require("bun:test")
import * as connectedProvidersCache from "./connected-providers-cache"

let readConnectedProvidersCacheSpy: ReturnType<typeof spyOn> | undefined
const { shouldRetryError, selectFallbackProvider, extractPlatformErrorCode, isProviderOverloadedError, extractProviderFromErrorUrl } = await import("./model-error-classifier")

describe("model-error-classifier", () => {
  beforeEach(() => {
    readConnectedProvidersCacheSpy?.mockRestore()
    readConnectedProvidersCacheSpy = spyOn(connectedProvidersCache, "readConnectedProvidersCache").mockReturnValue(null)
  })

  afterEach(() => {
    readConnectedProvidersCacheSpy?.mockRestore()
    readConnectedProvidersCacheSpy = undefined
  })

  test("treats overloaded retry messages as retryable", () => {
    //#given
    const error = { message: "Provider is overloaded" }

    //#when
    const result = shouldRetryError(error)

    //#then
    expect(result).toBe(true)
  })

  test("treats cooling-down auto-retry messages as retryable", () => {
    //#given
    const error = {
      message:
        "All credentials for model claude-opus-4-6-thinking are cooling down [retrying in ~5 days attempt #1]",
    }

    //#when
    const result = shouldRetryError(error)

    //#then
    expect(result).toBe(true)
  })

  test("selectFallbackProvider prefers first connected provider in preference order", () => {
    //#given
    readConnectedProvidersCacheSpy?.mockReturnValue(["anthropic", "nvidia"])

    //#when
    const provider = selectFallbackProvider(["anthropic", "nvidia"], "nvidia")

    //#then
    expect(provider).toBe("anthropic")
  })

  test("selectFallbackProvider falls back to next connected provider when first is disconnected", () => {
    //#given
    readConnectedProvidersCacheSpy?.mockReturnValue(["nvidia"])

    //#when
    const provider = selectFallbackProvider(["anthropic", "nvidia"])

    //#then
    expect(provider).toBe("nvidia")
  })

  test("selectFallbackProvider uses provider preference order when cache is missing", () => {
    //#given - no cache file

    //#when
    const provider = selectFallbackProvider(["anthropic", "nvidia"], "nvidia")

    //#then
    expect(provider).toBe("anthropic")
  })

  test("selectFallbackProvider uses connected preferred provider when fallback providers are unavailable", () => {
    //#given
    readConnectedProvidersCacheSpy?.mockReturnValue(["provider-x"])

    //#when
    const provider = selectFallbackProvider(["provider-y"], "provider-x")

    //#then
    expect(provider).toBe("provider-x")
  })

  test("treats QuotaExceededError (PascalCase name) as non-retryable STOP error", () => {
    //#given
    const error = { name: "QuotaExceededError" }

    //#when
    const result = shouldRetryError(error)

    //#then
    expect(result).toBe(false)
  })

  test("treats quotaexceedederror (lowercase name) as non-retryable STOP error", () => {
    //#given
    const error = { name: "quotaexceedederror" }

    //#when
    const result = shouldRetryError(error)

    //#then
    expect(result).toBe(false)
  })

  test("treats InsufficientCreditsError (PascalCase name) as non-retryable STOP error", () => {
    //#given
    const error = { name: "InsufficientCreditsError" }

    //#when
    const result = shouldRetryError(error)

    //#then
    expect(result).toBe(false)
  })

  test("treats insufficientcreditserror (lowercase name) as non-retryable STOP error", () => {
    //#given
    const error = { name: "insufficientcreditserror" }

    //#when
    const result = shouldRetryError(error)

    //#then
    expect(result).toBe(false)
  })

  test("treats FreeUsageLimitError (PascalCase name) as non-retryable STOP error", () => {
    //#given
    const error = { name: "FreeUsageLimitError" }

    //#when
    const result = shouldRetryError(error)

    //#then
    expect(result).toBe(false)
  })

  test("treats freeusagelimiterror (lowercase name) as non-retryable STOP error", () => {
    //#given
    const error = { name: "freeusagelimiterror" }

    //#when
    const result = shouldRetryError(error)

    //#then
    expect(result).toBe(false)
  })

  test("treats quota reset message as non-retryable STOP error (no error name)", () => {
    //#given
    const error = { message: "quota will reset after 1 hour" }

    //#when
    const result = shouldRetryError(error)

    //#then
    expect(result).toBe(false)
  })

  test("treats quota exceeded message as non-retryable STOP error (no error name)", () => {
    //#given
    const error = { message: "quota exceeded for this billing period" }

    //#when
    const result = shouldRetryError(error)

    //#then
    expect(result).toBe(false)
  })

  test("treats usage limit reached message as non-retryable STOP error (no error name)", () => {
    //#given
    const error = { message: "usage limit has been reached for your account" }

    //#when
    const result = shouldRetryError(error)

    //#then
    expect(result).toBe(false)
  })

  test("treats insufficient credits message as non-retryable STOP error (no error name)", () => {
    //#given
    const error = { message: "insufficient credits to complete this request" }

    //#when
    const result = shouldRetryError(error)

    //#then
    expect(result).toBe(false)
  })

  test("treats 'bad request' message as retryable (GitHub Copilot rolling update)", () => {
    //#given
    const error = { message: "400 Bad Request" }

    //#when
    const result = shouldRetryError(error)

    //#then
    expect(result).toBe(true)
  })

  test("treats 'bad request' lowercase as retryable", () => {
    //#given
    const error = { message: "bad request: model temporarily unavailable" }

    //#when
    const result = shouldRetryError(error)

    //#then
    expect(result).toBe(true)
  })

  test("treats subscription quota message as non-retryable", () => {
    //#given
    const error = { message: "Subscription quota exceeded. You can continue using free models." }

    //#when
    const result = shouldRetryError(error)

    //#then
    expect(result).toBe(false)
  })

  test("treats z.ai usage limit reached as retryable", () => {
    //#given
    const error = { message: "Usage limit reached for 5 hour. Your limit will reset at 2026-04-14 20:00:33" }

    //#when
    const result = shouldRetryError(error)

    //#then
    expect(result).toBe(true)
  })

  test("treats z.ai 1308 error via Type validation wrapper as retryable", () => {
    //#given
    const error = { name: "APIError", message: 'Type validation failed: Value: {"error":{"code":"1308","message":"Usage limit reached for 5 hour. Your limit will reset at 2026-04-14 20:00:33"}}' }

    //#when
    const result = shouldRetryError(error)

    //#then
    expect(result).toBe(true)
  })

  test("treats HTTP 429 rate limit message as retryable", () => {
    //#given
    const error = { message: "429 Too Many Requests: rate limit reached" }

    //#when
    const result = shouldRetryError(error)

    //#then
    expect(result).toBe(true)
  })

  describe("extractPlatformErrorCode", () => {
    test("extracts z.ai error code from responseBody", () => {
      //#given
      const error = {
        name: "APIError",
        data: {
          message: "Type validation failed",
          responseBody: '{"name":"AI_TypeValidationError","value":{"error":{"code":"1305","message":"The service may be temporarily overloaded"}}}',
        },
      }

      //#when
      const code = extractPlatformErrorCode(error)

      //#then
      expect(code).toBe("1305")
    })

    test("extracts error code from data.message when responseBody is missing", () => {
      //#given
      const error = {
        data: {
          message: 'Type validation failed: Value: {"error":{"code":"1234","message":"Network error"}}',
        },
      }

      //#when
      const code = extractPlatformErrorCode(error)

      //#then
      expect(code).toBe("1234")
    })

    test("returns null for errors without a code", () => {
      //#given
      const error = { message: "something went wrong" }

      //#when
      const code = extractPlatformErrorCode(error)

      //#then
      expect(code).toBeNull()
    })

    test("returns null for null/undefined error", () => {
      //#when
      expect(extractPlatformErrorCode(null)).toBeNull()
      expect(extractPlatformErrorCode(undefined)).toBeNull()
    })
  })

  describe("isProviderOverloadedError", () => {
    test("returns true for code 1305 (overloaded)", () => {
      //#given
      const error = {
        data: { responseBody: '{"error":{"code":"1305","message":"overloaded"}}' },
      }

      //#when
      const result = isProviderOverloadedError(error)

      //#then
      expect(result).toBe(true)
    })

    test("returns true for code 1312 (excessive traffic)", () => {
      //#given
      const error = {
        data: { responseBody: '{"error":{"code":"1312","message":"excessive traffic"}}' },
      }

      //#when
      const result = isProviderOverloadedError(error)

      //#then
      expect(result).toBe(true)
    })

    test("returns true for code 1308 (usage limit reached)", () => {
      //#given
      const error = {
        data: { responseBody: '{"error":{"code":"1308","message":"Usage limit reached for 5 hour. Your limit will reset at 2026-04-14 20:00:33"}}' },
      }

      //#when
      const result = isProviderOverloadedError(error)

      //#then
      expect(result).toBe(true)
    })

    test("returns true for code 1234 (network error)", () => {
      //#given
      const error = {
        data: { responseBody: '{"error":{"code":"1234","message":"Network error"}}' },
      }

      //#when
      const result = isProviderOverloadedError(error)

      //#then
      expect(result).toBe(true)
    })

    test("returns false for non-platform errors", () => {
      //#given
      const error = { message: "rate limit reached" }

      //#when
      const result = isProviderOverloadedError(error)

      //#then
      expect(result).toBe(false)
    })
  })

  describe("extractProviderFromErrorUrl", () => {
    test("maps api.z.ai to zai-coding-plan", () => {
      //#given
      const error = {
        data: {
          metadata: { url: "https://api.z.ai/api/anthropic/v1/messages" },
        },
      }

      //#when
      const provider = extractProviderFromErrorUrl(error)

      //#then
      expect(provider).toBe("zai-coding-plan")
    })

    test("returns null for unknown hostnames", () => {
      //#given
      const error = {
        data: {
          metadata: { url: "https://api.example.com/v1/messages" },
        },
      }

      //#when
      const provider = extractProviderFromErrorUrl(error)

      //#then
      expect(provider).toBeNull()
    })

    test("returns null when metadata.url is missing", () => {
      //#given
      const error = { data: { message: "something" } }

      //#when
      const provider = extractProviderFromErrorUrl(error)

      //#then
      expect(provider).toBeNull()
    })

    test("returns null for null/undefined error", () => {
      //#when
      expect(extractProviderFromErrorUrl(null)).toBeNull()
      expect(extractProviderFromErrorUrl(undefined)).toBeNull()
    })
  })
})

export {}
