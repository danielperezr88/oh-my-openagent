import { describe, expect, it } from "bun:test"
import { calculateCost, getPricing } from "./pricing-table"
import { getAccumulatedCost, recordTokenUsage, getSessionTotal } from "./tracker"

describe("pricing-table", () => {
  describe("#given a known model", () => {
    it("returns the correct pricing", () => {
      // given + when
      const pricing = getPricing("claude-sonnet-4-6")
      // then
      expect(pricing.inputPer1M).toBe(3)
      expect(pricing.outputPer1M).toBe(15)
    })
  })

  describe("#given an unknown model", () => {
    it("returns default pricing", () => {
      // given + when
      const pricing = getPricing("some-unknown-model-xyz")
      // then
      expect(pricing.inputPer1M).toBeGreaterThan(0)
      expect(pricing.outputPer1M).toBeGreaterThan(0)
    })
  })

  describe("#given a partial model name match", () => {
    it("matches by substring", () => {
      // given + when
      const pricing = getPricing("litellm/claude-sonnet-4-6")
      // then
      expect(pricing.inputPer1M).toBe(3)
    })
  })
})

describe("calculateCost", () => {
  it("calculates cost for known model", () => {
    // given: 100k input + 50k output on sonnet ($3/$15 per 1M)
    // when
    const cost = calculateCost("claude-sonnet-4-6", 100_000, 50_000)
    // then: (100000/1M * 3) + (50000/1M * 15) = 0.3 + 0.75 = 1.05
    expect(cost).toBe(1.05)
  })

  it("returns 0 for zero tokens", () => {
    const cost = calculateCost("gpt-5.4", 0, 0)
    expect(cost).toBe(0)
  })
})

describe("tracker", () => {
  describe("#given token usage recorded", () => {
    it("accumulates per session", () => {
      // given
      const sessionID = `test-${Date.now()}`
      // when
      recordTokenUsage(sessionID, "gpt-5.4", 10_000, 5_000)
      recordTokenUsage(sessionID, "gpt-5.4", 20_000, 10_000)
      // then
      const total = getSessionTotal(sessionID)
      expect(total.inputTokens).toBe(30_000)
      expect(total.outputTokens).toBe(15_000)
      expect(total.estimatedCost).toBeGreaterThan(0)
    })
  })

  describe("#given multiple sessions", () => {
    it("accumulates across sessions in getAccumulatedCost", () => {
      // given
      const sid1 = `test-acc-1-${Date.now()}`
      const sid2 = `test-acc-2-${Date.now()}`
      // when
      recordTokenUsage(sid1, "gpt-5.4", 100_000, 50_000)
      recordTokenUsage(sid2, "gpt-5.4", 200_000, 100_000)
      const total = getAccumulatedCost()
      // then
      expect(total.totalInputTokens).toBeGreaterThanOrEqual(300_000)
      expect(total.totalOutputTokens).toBeGreaterThanOrEqual(150_000)
      expect(total.sessions).toBeGreaterThanOrEqual(2)
    })
  })
})
