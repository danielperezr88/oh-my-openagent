import { describe, it, expect } from "bun:test"
import { getNewlyUnblocked } from "./cascade"
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

describe("getNewlyUnblocked", () => {
  it("returns empty when no tasks depend on completed task", () => {
    const t1 = mkTask("T-1")
    expect(getNewlyUnblocked("T-1", [t1])).toEqual([])
  })

  it("returns task that just had its last blocker completed", () => {
    const t1 = mkTask("T-1", [], { status: "completed" })
    const t2 = mkTask("T-2", ["T-1"])
    expect(getNewlyUnblocked("T-1", [t1, t2])).toEqual([t2])
  })

  it("does not return tasks that still have other unresolved blockers", () => {
    const t1 = mkTask("T-1", [], { status: "completed" })
    const t2 = mkTask("T-2", [], { status: "pending" })
    const t3 = mkTask("T-3", ["T-1", "T-2"])
    // T-3 depends on both T-1 and T-2. T-1 completed but T-2 still pending.
    expect(getNewlyUnblocked("T-1", [t1, t2, t3])).toEqual([])
  })

  it("returns tasks unblocked after all blockers complete", () => {
    const t1 = mkTask("T-1", [], { status: "completed" })
    const t2 = mkTask("T-2", [], { status: "completed" })
    const t3 = mkTask("T-3", ["T-1", "T-2"])
    // Both T-1 and T-2 completed -> T-3 newly unblocked by either
    const unblocked = getNewlyUnblocked("T-1", [t1, t2, t3])
    expect(unblocked).toEqual([t3])
  })

  it("does not return non-pending tasks", () => {
    const t1 = mkTask("T-1", [], { status: "completed" })
    const t2 = mkTask("T-2", ["T-1"], { status: "in_progress" })
    expect(getNewlyUnblocked("T-1", [t1, t2])).toEqual([])
  })

  it("handles cascade chain", () => {
    const t1 = mkTask("T-1", [], { status: "completed" })
    const t2 = mkTask("T-2", ["T-1"])
    const t3 = mkTask("T-3", ["T-2"])
    // Completing T-1 unblocks T-2 (T-3 still blocked by T-2)
    expect(getNewlyUnblocked("T-1", [t1, t2, t3])).toEqual([t2])
  })
})
