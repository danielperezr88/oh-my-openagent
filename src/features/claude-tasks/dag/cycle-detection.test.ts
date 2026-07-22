import { describe, it, expect } from "bun:test"
import { wouldCreateCycle } from "./cycle-detection"
import type { TaskObject } from "../../../tools/task/types"

const mkTask = (
  id: string,
  blockedBy: string[] = [],
  extra: Partial<TaskObject> = {},
): TaskObject => ({
  id,
  subject: id,
  description: "",
  status: "pending",
  blocks: [],
  blockedBy,
  threadID: "test",
  ...extra,
})

describe("wouldCreateCycle", () => {
  it("detects self-dependency", () => {
    const tasks = [mkTask("T-1")]
    expect(wouldCreateCycle("T-1", ["T-1"], tasks)).toBe(true)
  })

  it("allows new dependency with no existing edges", () => {
    const tasks = [mkTask("T-1"), mkTask("T-2")]
    expect(wouldCreateCycle("T-1", ["T-2"], tasks)).toBe(false)
  })

  it("detects direct cycle A->B->A", () => {
    // T-2 is already blockedBy T-1. Adding T-2 as blocker to T-1 creates cycle.
    const tasks = [mkTask("T-1"), mkTask("T-2", ["T-1"])]
    expect(wouldCreateCycle("T-1", ["T-2"], tasks)).toBe(true)
  })

  it("detects transitive cycle A->B->C->A", () => {
    // T-2 blockedBy T-1, T-3 blockedBy T-2
    // Adding T-3 as blocker to T-1 creates: T-1 blockedBy T-3, T-3 blockedBy T-2, T-2 blockedBy T-1
    const tasks = [mkTask("T-1"), mkTask("T-2", ["T-1"]), mkTask("T-3", ["T-2"])]
    expect(wouldCreateCycle("T-1", ["T-3"], tasks)).toBe(true)
  })

  it("allows non-cyclic dependency chain", () => {
    // T-2 blockedBy T-1, T-3 blockedBy T-2
    // Adding T-4 as blocker to T-3 is fine
    const tasks = [
      mkTask("T-1"),
      mkTask("T-2", ["T-1"]),
      mkTask("T-3", ["T-2"]),
      mkTask("T-4"),
    ]
    expect(wouldCreateCycle("T-3", ["T-4"], tasks)).toBe(false)
  })

  it("handles diamond dependency without cycle", () => {
    // T-4 blockedBy [T-2, T-3], T-2 blockedBy T-1, T-3 blockedBy T-1
    const tasks = [
      mkTask("T-1"),
      mkTask("T-2", ["T-1"]),
      mkTask("T-3", ["T-1"]),
      mkTask("T-4", ["T-2", "T-3"]),
    ]
    // Adding T-4 as blocker to T-1: T-1 blockedBy T-4, T-4 blockedBy T-2, T-2 blockedBy T-1 => CYCLE
    expect(wouldCreateCycle("T-1", ["T-4"], tasks)).toBe(true)
  })

  it("returns false for empty newBlockedBy", () => {
    const tasks = [mkTask("T-1")]
    expect(wouldCreateCycle("T-1", [], tasks)).toBe(false)
  })

  it("handles missing tasks gracefully", () => {
    const tasks = [mkTask("T-1")]
    // T-2 doesn't exist in allTasks but that's fine - can't form a cycle with a missing node
    expect(wouldCreateCycle("T-1", ["T-2"], tasks)).toBe(false)
  })

  it("detects cycle through multiple proposed blockers", () => {
    // T-2 blockedBy T-1. Proposing to add both T-3 and T-2 as blockers of T-1
    const tasks = [mkTask("T-1"), mkTask("T-2", ["T-1"]), mkTask("T-3")]
    expect(wouldCreateCycle("T-1", ["T-3", "T-2"], tasks)).toBe(true)
  })
})
