import { describe, expect, it } from "bun:test"
import { createToolCallRecord, detectToolLoop } from "./loop-detector"
import { detectScopeDrift } from "./scope-detector"
import { DEFAULT_LOOP_CONFIG, DEFAULT_DRIFT_CONFIG } from "./types"

describe("loop-detector", () => {
  describe("#given fewer calls than threshold", () => {
    it("does not detect a loop", () => {
      // given
      const records = [
        createToolCallRecord("read", { filePath: "/a.ts" }),
        createToolCallRecord("read", { filePath: "/a.ts" }),
      ]
      // when
      const result = detectToolLoop(records, DEFAULT_LOOP_CONFIG)
      // then
      expect(result.detected).toBe(false)
    })
  })

  describe("#given same tool+file 3 times within window", () => {
    it("detects a loop", () => {
      // given
      const records = [
        createToolCallRecord("read", { filePath: "/index.ts" }),
        createToolCallRecord("read", { filePath: "/index.ts" }),
        createToolCallRecord("read", { filePath: "/index.ts" }),
      ]
      // when
      const result = detectToolLoop(records, DEFAULT_LOOP_CONFIG)
      // then
      expect(result.detected).toBe(true)
      expect(result.tool).toBe("read")
      expect(result.count).toBe(3)
    })
  })

  describe("#given different files", () => {
    it("does not detect a loop", () => {
      // given
      const records = [
        createToolCallRecord("read", { filePath: "/a.ts" }),
        createToolCallRecord("read", { filePath: "/b.ts" }),
        createToolCallRecord("read", { filePath: "/c.ts" }),
      ]
      // when
      const result = detectToolLoop(records, DEFAULT_LOOP_CONFIG)
      // then
      expect(result.detected).toBe(false)
    })
  })
})

describe("scope-detector", () => {
  describe("#given messages closely related to task", () => {
    it("does not flag drift", () => {
      // given
      const task = "implement user authentication with JWT tokens and login flow"
      const recent = [
        "implementing JWT token authentication for user login flow",
        "adding authentication middleware for JWT token validation",
      ]
      // when
      const result = detectScopeDrift(task, recent, DEFAULT_DRIFT_CONFIG)
      // then
      expect(result.drifting).toBe(false)
    })
  })

  describe("#given messages completely unrelated to task", () => {
    it("flags drift", () => {
      // given
      const task = "implement user authentication with JWT tokens"
      const recent = ["let us refactor the CSS color palette", "changing font sizes globally"]
      // when
      const result = detectScopeDrift(task, recent, DEFAULT_DRIFT_CONFIG)
      // then
      expect(result.drifting).toBe(true)
      expect(result.similarity).toBeLessThan(DEFAULT_DRIFT_CONFIG.driftThreshold)
    })
  })

  describe("#given empty messages", () => {
    it("does not flag drift", () => {
      // given
      const result = detectScopeDrift("task", [], DEFAULT_DRIFT_CONFIG)
      // then
      expect(result.drifting).toBe(false)
    })
  })
})
