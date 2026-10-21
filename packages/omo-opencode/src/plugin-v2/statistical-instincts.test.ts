import { describe, expect, test } from "bun:test"
import type { Instinct, Observation } from "../features/ecc-integration/continuous-learning/types"
import { parseInstinctFile } from "../features/ecc-integration/continuous-learning/instinct-store/instinct-parser"
import { computeCoOccurrence } from "../features/ecc-integration/continuous-learning/pattern-engine/co-occurrence"
import {
  buildStatisticalPatterns,
  computeSequenceFrequency,
  computeToolFrequency,
} from "../features/ecc-integration/continuous-learning/pattern-engine/frequency-counter"
import {
  buildStatisticalInstincts,
  confidenceFromCount,
  makeInstinct,
  shouldRunConsolidation,
  type StatisticalAnalysis,
} from "./statistical-instincts"
import { extractInstinctBlocks } from "./instinct-consolidation"

const PROJECT_HASH = "abc123"

function observation(tool: string, session: string, index: number): Observation {
  return {
    timestamp: new Date(2026, 0, 1, 0, 0, index).toISOString(),
    event: "tool_start",
    tool,
    session,
    projectHash: PROJECT_HASH,
  }
}

function analysisFixture(overrides: Partial<StatisticalAnalysis> = {}): StatisticalAnalysis {
  return {
    patterns: { toolFrequency: {}, sequenceFrequency: {}, coOccurrence: {} },
    topSequences: [],
    anomalyCheck: { anomalous: false, reasons: [] },
    ...overrides,
  }
}

describe("confidenceFromCount", () => {
  test("maps observation counts onto confidence bands", () => {
    // given // when // then
    expect(confidenceFromCount(0)).toBe(0)
    expect(confidenceFromCount(-3)).toBe(0)
    expect(confidenceFromCount(1)).toBe(0.3)
    expect(confidenceFromCount(2)).toBe(0.3)
    expect(confidenceFromCount(3)).toBe(0.5)
    expect(confidenceFromCount(5)).toBe(0.5)
    expect(confidenceFromCount(6)).toBe(0.7)
    expect(confidenceFromCount(10)).toBe(0.7)
    expect(confidenceFromCount(11)).toBe(0.85)
    expect(confidenceFromCount(50)).toBe(0.85)
  })
})

describe("makeInstinct", () => {
  test("builds a project-scoped statistical instinct with banded confidence and timestamps", () => {
    // given
    const before = Date.now()
    // when
    const instinct = makeInstinct("seq-a-to-b", "when pairing tools", "workflow", 4, PROJECT_HASH, "  follow the flow  ")
    const after = Date.now()
    // then
    expect(instinct.id).toBe("seq-a-to-b")
    expect(instinct.trigger).toBe("when pairing tools")
    expect(instinct.confidence).toBe(0.5)
    expect(instinct.domain).toBe("workflow")
    expect(instinct.source).toBe("statistical")
    expect(instinct.scope).toBe("project")
    expect(instinct.projectHash).toBe(PROJECT_HASH)
    expect(instinct.observationCount).toBe(4)
    expect(instinct.content).toBe("follow the flow")
    expect(new Date(instinct.createdAt).getTime()).toBeGreaterThanOrEqual(before)
    expect(new Date(instinct.createdAt).getTime()).toBeLessThanOrEqual(after)
    expect(instinct.lastConfirmed).toBe(instinct.createdAt)
  })
})

describe("buildStatisticalInstincts", () => {
  test("emits at most five workflow instincts from top sequences", () => {
    // given
    const topSequences = Array.from({ length: 7 }, (_, i) => ({ sequence: `read->edit->step${i}`, count: 10 - i }))
    // when
    const instincts = buildStatisticalInstincts(analysisFixture({ topSequences }), PROJECT_HASH)
    // then
    const seqInstincts = instincts.filter((i) => i.id.startsWith("seq-"))
    expect(seqInstincts).toHaveLength(5)
    expect(seqInstincts[0]!.id).toBe("seq-read-to-edit-to-step0")
    expect(seqInstincts[0]!.confidence).toBe(confidenceFromCount(10))
    expect(seqInstincts[0]!.content).toContain("Observed 10 times")
    expect(seqInstincts.every((i) => i.domain === "workflow")).toBe(true)
  })

  test("emits a prefer instinct only when the top tool exceeds thirty percent share", () => {
    // given // when
    const dominant = buildStatisticalInstincts(
      analysisFixture({ patterns: { toolFrequency: { read: 8, edit: 2 }, sequenceFrequency: {}, coOccurrence: {} } }),
      PROJECT_HASH,
    )
    const balanced = buildStatisticalInstincts(
      analysisFixture({ patterns: { toolFrequency: { a: 3, b: 3, c: 3, d: 1 }, sequenceFrequency: {}, coOccurrence: {} } }),
      PROJECT_HASH,
    )
    // then
    const prefer = dominant.find((i) => i.id === "prefer-read")
    expect(prefer).toBeDefined()
    expect(prefer!.confidence).toBe(0.7)
    expect(prefer!.content).toContain("Used 8 times out of 10 total tool calls")
    expect(balanced.some((i) => i.id.startsWith("prefer-"))).toBe(false)
  })

  test("emits after-X instincts only for transitions with three-plus counts above half share", () => {
    // given
    const coOccurrence = {
      read: { edit: 3, test: 1 },
      write: { plan: 2, edit: 2 },
      glob: { grep: 2 },
    }
    // when
    const instincts = buildStatisticalInstincts(
      analysisFixture({ patterns: { toolFrequency: {}, sequenceFrequency: {}, coOccurrence } }),
      PROJECT_HASH,
    )
    // then
    const after = instincts.find((i) => i.id === "after-read-then-edit")
    expect(after).toBeDefined()
    expect(after!.content).toContain("3 out of 4 transitions")
    // write->plan and write->edit sit at exactly 50%, below the strict threshold
    expect(instincts.some((i) => i.id.startsWith("after-write"))).toBe(false)
    // glob->grep holds 100% share but only 2 observations
    expect(instincts.some((i) => i.id.startsWith("after-glob"))).toBe(false)
  })

  test("emits a debugging instinct when the anomaly check flags the session", () => {
    // given // when
    const instincts = buildStatisticalInstincts(
      analysisFixture({
        topSequences: [{ sequence: "a->b->c", count: 4 }],
        anomalyCheck: { anomalous: true, reasons: ["Tool diversity above baseline", "Sequence count spike"] },
      }),
      PROJECT_HASH,
    )
    // then
    const anomaly = instincts.find((i) => i.id === "anomalous-session-detected")
    expect(anomaly).toBeDefined()
    expect(anomaly!.domain).toBe("debugging")
    expect(anomaly!.source).toBe("session-observation")
    expect(anomaly!.content).toContain("- Tool diversity above baseline")
    expect(anomaly!.content).toContain("- Sequence count spike")
  })

  test("returns an empty list for a quiet analysis", () => {
    // given // when // then
    expect(buildStatisticalInstincts(analysisFixture(), PROJECT_HASH)).toEqual([])
  })
})

describe("shouldRunConsolidation", () => {
  test("idle requires the configured observation minimum", () => {
    // given // when // then
    expect(shouldRunConsolidation({ trigger: "idle", observationCount: 19, minObservations: 20 }).shouldTrigger).toBe(false)
    expect(shouldRunConsolidation({ trigger: "idle", observationCount: 20, minObservations: 20 }).shouldTrigger).toBe(true)
  })

  test("session_end triggers on any observation and skips an empty log", () => {
    // given // when // then
    expect(shouldRunConsolidation({ trigger: "session_end", observationCount: 1, minObservations: 20 }).shouldTrigger).toBe(true)
    const empty = shouldRunConsolidation({ trigger: "session_end", observationCount: 0, minObservations: 20 })
    expect(empty.shouldTrigger).toBe(false)
    expect(empty.reason).toContain("No observations")
  })
})

describe("pattern-engine sanity (V1 modules consumed by consolidation)", () => {
  test("tool frequency counts starts only", () => {
    // given
    const observations: Observation[] = [
      observation("read", "s1", 0),
      { ...observation("read", "s1", 1), event: "tool_complete" },
      observation("edit", "s1", 2),
    ]
    // when // then
    expect(computeToolFrequency(observations)).toEqual({ read: 1, edit: 1 })
  })

  test("sequence frequency slides a window of three over per-session starts", () => {
    // given
    const observations = ["a", "b", "c", "a", "b", "c"].map((tool, i) => observation(tool, "s1", i))
    // when
    const freq = computeSequenceFrequency(observations)
    // then
    expect(freq["a->b->c"]).toBe(2)
    expect(freq["b->c->a"]).toBe(1)
    expect(freq["c->a->b"]).toBe(1)
    expect(Object.values(freq).reduce((sum, count) => sum + count, 0)).toBe(4)
  })

  test("co-occurrence tracks transitions per session and skips repeats of the same tool", () => {
    // given
    const s1 = ["a", "b", "a"].map((tool, i) => observation(tool, "s1", i))
    const s2 = ["a", "b"].map((tool, i) => observation(tool, "s2", i))
    // when
    const matrix = computeCoOccurrence([...s1, ...s2])
    // then
    expect(matrix.a!.b).toBe(2)
    expect(matrix.b!.a).toBe(1)
    expect(matrix.a!.a).toBeUndefined()
  })

  test("buildStatisticalPatterns aggregates counters and unique session count", () => {
    // given
    const observations = [
      observation("read", "s1", 0),
      observation("edit", "s1", 1),
      observation("read", "s2", 2),
    ]
    // when
    const patterns = buildStatisticalPatterns(observations)
    // then
    expect(patterns.toolFrequency).toEqual({ read: 2, edit: 1 })
    expect(patterns.sessionCount).toBe(2)
    expect(patterns.lastUpdated).toBeTruthy()
  })
})

describe("extractInstinctBlocks", () => {
  test("parses yaml-fenced instinct blocks round-trip through the instinct parser", () => {
    // given
    const text = [
      "Here is what I found:",
      "```yaml",
      "id: prefer-tests-first",
      "trigger: when starting new features",
      "confidence: 0.6",
      "domain: testing",
      "```",
      "and another:",
      "```yaml",
      "id: seq-read-then-edit",
      "trigger: when modifying files",
      "```",
    ].join("\n")
    // when
    const blocks = extractInstinctBlocks(text)
    // then
    expect(blocks).toHaveLength(2)
    const first = parseInstinctFile(blocks[0]!) as Instinct
    expect(first.id).toBe("prefer-tests-first")
    expect(first.domain).toBe("testing")
    expect(first.confidence).toBe(0.6)
    const second = parseInstinctFile(blocks[1]!) as Instinct
    expect(second.id).toBe("seq-read-then-edit")
    expect(second.trigger).toBe("when modifying files")
  })

  test("falls back to bare frontmatter sections when no fenced blocks exist", () => {
    // given
    const text = ["preamble noise", "---", "id: a", "trigger: t-a", "---", "body a", "---", "id: b", "trigger: t-b", "---", "body b"].join("\n")
    // when
    const blocks = extractInstinctBlocks(text)
    // then
    expect(blocks).toHaveLength(2)
    const parsed = blocks.map((block) => parseInstinctFile(block) as Instinct)
    expect(parsed.map((i) => i.id)).toEqual(["a", "b"])
    expect(parsed[0]!.content).toBe("body a")
  })

  test("returns nothing for text without instinct candidates", () => {
    // given // when // then
    expect(extractInstinctBlocks("no blocks here\njust prose")).toEqual([])
  })
})
