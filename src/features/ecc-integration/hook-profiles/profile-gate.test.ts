import { describe, expect, it } from "bun:test"
import { isHookEnabledByProfile, resolveProfile } from "./profile-gate"
import { getHookProfile } from "./hook-profile-map"
import { DEFAULT_PROFILE, PROFILE_ORDER } from "./types"

describe("profile-gate", () => {
  describe("#given valid profile strings", () => {
    it("returns the matching profile when env is set", () => {
      // given + when
      const result = resolveProfile("strict", undefined)
      // then
      expect(result).toBe("strict")
    })

    it("prefers env over config", () => {
      // given + when
      const result = resolveProfile("minimal", "strict")
      // then
      expect(result).toBe("minimal")
    })

    it("falls back to config when env is unset", () => {
      // given + when
      const result = resolveProfile(undefined, "strict")
      // then
      expect(result).toBe("strict")
    })
  })

  describe("#given no profile specified", () => {
    it("returns the default profile", () => {
      // given + when
      const result = resolveProfile(undefined, undefined)
      // then
      expect(result).toBe(DEFAULT_PROFILE)
    })
  })

  describe("#given invalid profile string", () => {
    it("falls back to default", () => {
      // given + when
      const result = resolveProfile("invalid", undefined)
      // then
      expect(result).toBe(DEFAULT_PROFILE)
    })
  })
})

describe("isHookEnabledByProfile", () => {
  describe("#given a strict-profile hook", () => {
    const hookProfile = getHookProfile("fact-force-gate")

    it("is disabled on minimal", () => {
      // given + when
      const result = isHookEnabledByProfile("fact-force-gate", hookProfile, "minimal")
      // then
      expect(result).toBe(false)
    })

    it("is disabled on standard", () => {
      // given + when
      const result = isHookEnabledByProfile("fact-force-gate", hookProfile, "standard")
      // then
      expect(result).toBe(false)
    })

    it("is enabled on strict", () => {
      // given + when
      const result = isHookEnabledByProfile("fact-force-gate", hookProfile, "strict")
      // then
      expect(result).toBe(true)
    })
  })

  describe("#given a standard-profile hook", () => {
    const hookProfile = getHookProfile("comment-checker")

    it("is disabled on minimal", () => {
      // given + when
      const result = isHookEnabledByProfile("comment-checker", hookProfile, "minimal")
      // then
      expect(result).toBe(false)
    })

    it("is enabled on standard", () => {
      // given + when
      const result = isHookEnabledByProfile("comment-checker", hookProfile, "standard")
      // then
      expect(result).toBe(true)
    })

    it("is enabled on strict", () => {
      // given + when
      const result = isHookEnabledByProfile("comment-checker", hookProfile, "strict")
      // then
      expect(result).toBe(true)
    })
  })

  describe("#given a minimal-profile hook", () => {
    const hookProfile = getHookProfile("transcript-archival")

    it("is enabled on minimal", () => {
      // given + when
      const result = isHookEnabledByProfile("transcript-archival", hookProfile, "minimal")
      // then
      expect(result).toBe(true)
    })
  })
})

describe("PROFILE_ORDER consistency", () => {
  it("has ascending order minimal < standard < strict", () => {
    // given + when + then
    expect(PROFILE_ORDER.minimal).toBeLessThan(PROFILE_ORDER.standard)
    expect(PROFILE_ORDER.standard).toBeLessThan(PROFILE_ORDER.strict)
  })
})
