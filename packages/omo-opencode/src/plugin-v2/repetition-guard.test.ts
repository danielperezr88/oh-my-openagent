import { describe, expect, test } from "bun:test"
import type { Plugin } from "@opencode/plugin"
import {
  createRepetitionTracker,
  DEFAULT_REPETITION_GUARD_THRESHOLDS,
  fingerprintToolInput,
  registerRepetitionGuard,
  resolveRepetitionThresholds,
} from "./repetition-guard"

const RAPID_MS = 2_000
const MINUTE_MS = 60_000

function trackRead(tracker: ReturnType<typeof createRepetitionTracker>, at: number, path = "deploy/wol_wake.py") {
  return tracker.observe("read", "ses_a", { path }, at)
}

describe("resolveRepetitionThresholds", () => {
  describe("#given undefined members wired through from an absent config block", () => {
    test("#then every threshold falls back to the defaults instead of turning into NaN", () => {
      // given / when
      const thresholds = resolveRepetitionThresholds({
        minCalls: undefined,
        maxDistinctInputs: undefined,
        rapidIntervalMs: undefined,
        historySize: undefined,
      })

      // then
      expect(thresholds).toEqual(DEFAULT_REPETITION_GUARD_THRESHOLDS)
      expect(Number.isNaN(thresholds.minCalls)).toBe(false)
    })
  })

  describe("#given invalid numeric overrides", () => {
    test("#then each one is rejected in favor of the default", () => {
      // given / when
      const thresholds = resolveRepetitionThresholds({
        minCalls: 0,
        maxDistinctInputs: -1,
        rapidIntervalMs: Number.NaN,
        historySize: Number.POSITIVE_INFINITY,
      })

      // then
      expect(thresholds).toEqual(DEFAULT_REPETITION_GUARD_THRESHOLDS)
    })
  })

  describe("#given valid numeric overrides", () => {
    test("#then each one is honored", () => {
      // given / when
      const thresholds = resolveRepetitionThresholds({ minCalls: 9, rapidIntervalMs: 45_000 })

      // then
      expect(thresholds.minCalls).toBe(9)
      expect(thresholds.rapidIntervalMs).toBe(45_000)
      expect(thresholds.maxDistinctInputs).toBe(DEFAULT_REPETITION_GUARD_THRESHOLDS.maxDistinctInputs)
      expect(thresholds.historySize).toBe(DEFAULT_REPETITION_GUARD_THRESHOLDS.historySize)
    })
  })
})

describe("createRepetitionTracker", () => {
  describe("#given a rapid identical-call streak (the wol_wake read loop shape)", () => {
    test("#then calls below the threshold pass and the threshold call is blocked with guidance", () => {
      // given
      const tracker = createRepetitionTracker(DEFAULT_REPETITION_GUARD_THRESHOLDS)

      // when
      let reason: string | null = null
      for (let index = 0; index < 6; index += 1) {
        reason = trackRead(tracker, index * RAPID_MS)
      }

      // then
      expect(reason).not.toBeNull()
      expect(reason).toContain("Degenerate repetition blocked")
      expect(reason).toContain("'read'")
      expect(reason).toContain("6 times in a row")
      expect(reason).toContain("different arguments")
    })

    test("#then the five calls before the threshold all pass", () => {
      // given
      const tracker = createRepetitionTracker(DEFAULT_REPETITION_GUARD_THRESHOLDS)

      // when
      const reasons: (string | null)[] = []
      for (let index = 0; index < 5; index += 1) {
        reasons.push(trackRead(tracker, index * RAPID_MS))
      }

      // then
      expect(reasons).toEqual([null, null, null, null, null])
    })
  })

  describe("#given a two-cycle alternation (full read then offset read, alternating)", () => {
    test("#then the guard trips on the same schedule as the identical case", () => {
      // given
      const tracker = createRepetitionTracker(DEFAULT_REPETITION_GUARD_THRESHOLDS)

      // when
      let reason: string | null = null
      for (let index = 0; index < 6; index += 1) {
        const input = index % 2 === 0 ? { path: "deploy/wol_wake.py" } : { path: "deploy/wol_wake.py", offset: 20 }
        reason = tracker.observe("read", "ses_a", input, index * RAPID_MS)
      }

      // then
      expect(reason).not.toBeNull()
      expect(reason).toContain("'read'")
      expect(reason).toContain("6 times in a row")
    })
  })

  describe("#given slow deliberate polling (long sleep-and-check commands)", () => {
    test("#then five-minute polling never trips the guard", () => {
      // given
      const tracker = createRepetitionTracker(DEFAULT_REPETITION_GUARD_THRESHOLDS)

      // when
      let reason: string | null = null
      for (let index = 0; index < 13; index += 1) {
        reason = tracker.observe("bash", "ses_a", { command: "ping -n 300 127.0.0.1" }, index * 5 * MINUTE_MS)
      }

      // then
      expect(reason).toBeNull()
    })

    test("#then one-minute polling stays under the rapid budget as well", () => {
      // given
      const tracker = createRepetitionTracker(DEFAULT_REPETITION_GUARD_THRESHOLDS)

      // when
      let reason: string | null = null
      for (let index = 0; index < 8; index += 1) {
        reason = tracker.observe("bash", "ses_a", { command: "check-status" }, index * MINUTE_MS)
      }

      // then
      expect(reason).toBeNull()
    })
  })

  describe("#given varied inputs across the same tool", () => {
    test("#then no streak forms because the fingerprints differ", () => {
      // given
      const tracker = createRepetitionTracker(DEFAULT_REPETITION_GUARD_THRESHOLDS)

      // when
      let reason: string | null = null
      for (let index = 0; index < 8; index += 1) {
        reason = tracker.observe("read", "ses_a", { path: `src/file-${index}.ts` }, index * RAPID_MS)
      }

      // then
      expect(reason).toBeNull()
    })
  })

  describe("#given a different tool interleaved into the streak", () => {
    test("#then the streak restarts and no block fires", () => {
      // given
      const tracker = createRepetitionTracker(DEFAULT_REPETITION_GUARD_THRESHOLDS)
      for (let index = 0; index < 5; index += 1) {
        trackRead(tracker, index * RAPID_MS)
      }

      // when
      const afterBash = tracker.observe("bash", "ses_a", { command: "ls" }, 5 * RAPID_MS)
      const afterReadAgain = trackRead(tracker, 6 * RAPID_MS)

      // then
      expect(afterBash).toBeNull()
      expect(afterReadAgain).toBeNull()
    })
  })

  describe("#given a history window smaller than the threshold", () => {
    test("#then old calls drop off and the guard can never trip", () => {
      // given
      const tracker = createRepetitionTracker({
        ...DEFAULT_REPETITION_GUARD_THRESHOLDS,
        historySize: 4,
      })

      // when
      let reason: string | null = null
      for (let index = 0; index < 10; index += 1) {
        reason = trackRead(tracker, index * RAPID_MS)
      }

      // then
      expect(reason).toBeNull()
    })
  })

  describe("#given sessions tracked independently", () => {
    test("#then a streak in one session does not leak into another", () => {
      // given
      const tracker = createRepetitionTracker(DEFAULT_REPETITION_GUARD_THRESHOLDS)
      for (let index = 0; index < 5; index += 1) {
        trackRead(tracker, index * RAPID_MS)
      }

      // when
      const otherSession = tracker.observe("read", "ses_b", { path: "deploy/wol_wake.py" }, 5 * RAPID_MS)

      // then
      expect(otherSession).toBeNull()
    })
  })

  describe("#given a forgotten session", () => {
    test("#then its streak restarts from zero", () => {
      // given
      const tracker = createRepetitionTracker(DEFAULT_REPETITION_GUARD_THRESHOLDS)
      for (let index = 0; index < 6; index += 1) {
        trackRead(tracker, index * RAPID_MS)
      }
      tracker.forgetSession("ses_a")

      // when
      const reason = trackRead(tracker, 60 * RAPID_MS)

      // then
      expect(reason).toBeNull()
    })
  })
})

describe("fingerprintToolInput", () => {
  describe("#given the same input with different member order", () => {
    test("#then the fingerprints match", () => {
      // given
      const first = { path: "a.ts", offset: 3 }
      const second = { offset: 3, path: "a.ts" }

      // when / then
      expect(fingerprintToolInput(second)).toBe(fingerprintToolInput(first))
    })
  })

  describe("#given inputs with different values", () => {
    test("#then the fingerprints differ", () => {
      // given
      const first = { path: "a.ts" }
      const second = { path: "b.ts" }

      // when / then
      expect(fingerprintToolInput(second)).not.toBe(fingerprintToolInput(first))
    })
  })
})

describe("registerRepetitionGuard", () => {
  describe("#given a registered guard and a rapid identical stream of tool events", () => {
    test("#then the threshold event throws the corrective block reason", () => {
      // given
      let handler: ((event: { tool: string; sessionID: string; input: unknown }) => void) | undefined
      const ctx = {
        tool: {
          hook: (name: string, callback: (event: { tool: string; sessionID: string; input: unknown }) => void) => {
            if (name === "execute.before") handler = callback
          },
        },
      } as unknown as Plugin.Context
      registerRepetitionGuard(ctx)

      // when
      let thrown: unknown
      for (let index = 0; index < 6; index += 1) {
        try {
          handler?.({ tool: "read", sessionID: "ses_live", input: { path: "deploy/wol_wake.py" } })
        } catch (error) {
          thrown = error
        }
      }

      // then
      expect(thrown).toBeInstanceOf(Error)
      expect(String(thrown)).toContain("Degenerate repetition blocked")
      expect(String(thrown)).toContain("'read'")
    })
  })

  describe("#given undefined overrides wired through from an absent config block", () => {
    test("#then the defaults apply and the guard still requires a real streak (the incident regression)", () => {
      // given
      let handler: ((event: { tool: string; sessionID: string; input: unknown }) => void) | undefined
      const ctx = {
        tool: {
          hook: (name: string, callback: (event: { tool: string; sessionID: string; input: unknown }) => void) => {
            if (name === "execute.before") handler = callback
          },
        },
      } as unknown as Plugin.Context
      registerRepetitionGuard(ctx, {
        minCalls: undefined,
        maxDistinctInputs: undefined,
        rapidIntervalMs: undefined,
      })

      // when
      const outcomes: string[] = []
      for (let index = 0; index < 6; index += 1) {
        try {
          handler?.({ tool: "read", sessionID: "ses_incident", input: { path: "deploy/wol_wake.py" } })
          outcomes.push("pass")
        } catch (error) {
          outcomes.push(`blocked:${String(error).includes("6 times in a row") ? "streak6" : "wrong"}`)
        }
      }

      // then
      expect(outcomes.slice(0, 5)).toEqual(["pass", "pass", "pass", "pass", "pass"])
      expect(outcomes[5]).toBe("blocked:streak6")
    })
  })
})

describe("DEFAULT_REPETITION_GUARD_THRESHOLDS", () => {
  describe("#given the shipped defaults", () => {
    test("#then the contract matches the documented tuning", () => {
      expect(DEFAULT_REPETITION_GUARD_THRESHOLDS.minCalls).toBe(6)
      expect(DEFAULT_REPETITION_GUARD_THRESHOLDS.maxDistinctInputs).toBe(2)
      expect(DEFAULT_REPETITION_GUARD_THRESHOLDS.rapidIntervalMs).toBe(30_000)
      expect(DEFAULT_REPETITION_GUARD_THRESHOLDS.historySize).toBe(32)
    })
  })
})
