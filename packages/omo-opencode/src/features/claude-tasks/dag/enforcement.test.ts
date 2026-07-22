import { describe, it, expect } from "bun:test"
import { canStartTask, getUnresolvedBlockers } from "./enforcement"
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

describe("getUnresolvedBlockers", () => {
  it("returns empty for task with no blockers", () => {
    const task = mkTask("T-1")
    expect(getUnresolvedBlockers(task, [task])).toEqual([])
  })

  it("returns blockers that are not completed", () => {
    const task = mkTask("T-1", ["T-2", "T-3"])
    const t2 = mkTask("T-2", [], { status: "pending" })
    const t3 = mkTask("T-3", [], { status: "completed" })
    expect(getUnresolvedBlockers(task, [task, t2, t3])).toEqual(["T-2"])
  })

  it("excludes missing blockers (treated as resolved)", () => {
    const task = mkTask("T-1", ["T-missing"])
    expect(getUnresolvedBlockers(task, [task])).toEqual([])
  })

  it("returns all blockers if none are completed", () => {
    const task = mkTask("T-1", ["T-2", "T-3"])
    const t2 = mkTask("T-2", [], { status: "in_progress" })
    const t3 = mkTask("T-3", [], { status: "pending" })
    expect(getUnresolvedBlockers(task, [task, t2, t3])).toEqual(["T-2", "T-3"])
  })
})

describe("canStartTask", () => {
  it("returns true when no blockers", () => {
    const task = mkTask("T-1")
    expect(canStartTask(task, [task])).toBe(true)
  })

  it("returns false when has unresolved blockers", () => {
    const task = mkTask("T-1", ["T-2"])
    const t2 = mkTask("T-2", [], { status: "pending" })
    expect(canStartTask(task, [task, t2])).toBe(false)
  })

  it("returns true when all blockers are completed", () => {
    const task = mkTask("T-1", ["T-2", "T-3"])
    const t2 = mkTask("T-2", [], { status: "completed" })
    const t3 = mkTask("T-3", [], { status: "completed" })
    expect(canStartTask(task, [task, t2, t3])).toBe(true)
  })

  it("returns true when blockers are missing", () => {
    const task = mkTask("T-1", ["T-gone"])
    expect(canStartTask(task, [task])).toBe(true)
  })
})
