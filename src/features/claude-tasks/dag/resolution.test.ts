import { describe, it, expect } from "bun:test"
import { getReadyTasks } from "./resolution"
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

describe("getReadyTasks", () => {
  it("returns empty when no tasks exist", () => {
    expect(getReadyTasks([])).toEqual([])
  })

  it("returns all pending tasks with no blockers", () => {
    const t1 = mkTask("T-1")
    const t2 = mkTask("T-2")
    expect(getReadyTasks([t1, t2])).toEqual([t1, t2])
  })

  it("excludes tasks with unresolved blockers", () => {
    const t1 = mkTask("T-1")
    const t2 = mkTask("T-2", ["T-3"])
    const t3 = mkTask("T-3", [], { status: "in_progress" })
    // T-1 is ready (no blockers), T-2 blocked by T-3 (in_progress), T-3 is not pending
    expect(getReadyTasks([t1, t2, t3])).toEqual([t1])
  })

  it("includes tasks whose blockers are all completed", () => {
    const t1 = mkTask("T-1")
    const t2 = mkTask("T-2", ["T-3"])
    const t3 = mkTask("T-3", [], { status: "completed" })
    expect(getReadyTasks([t1, t2, t3])).toEqual([t1, t2])
  })

  it("excludes non-pending tasks", () => {
    const t1 = mkTask("T-1", [], { status: "in_progress" })
    const t2 = mkTask("T-2", [], { status: "completed" })
    const t3 = mkTask("T-3")
    expect(getReadyTasks([t1, t2, t3])).toEqual([t3])
  })

  it("handles diamond dependency", () => {
    const root = mkTask("T-1")
    const left = mkTask("T-2", ["T-1"], { status: "completed" })
    const right = mkTask("T-3", ["T-1"], { status: "completed" })
    const merge = mkTask("T-4", ["T-2", "T-3"])
    expect(getReadyTasks([root, left, right, merge])).toEqual([root, merge])
  })
})
