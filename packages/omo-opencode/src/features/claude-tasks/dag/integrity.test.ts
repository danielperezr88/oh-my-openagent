import { describe, it, expect } from "bun:test"
import { syncBidirectionalLinks } from "./integrity"
import type { TaskObject } from "../../../tools/task/types"

const mkTask = (
  id: string,
  blockedBy: string[] = [],
  blocks: string[] = [],
): TaskObject => ({
  id,
  subject: id,
  description: "",
  status: "pending",
  blocks,
  blockedBy,
  threadID: "test",
})

describe("syncBidirectionalLinks", () => {
  it("returns empty patches for consistent graph", () => {
    // T-1 blocks T-2, T-2 blockedBy T-1 - consistent
    const tasks = [mkTask("T-1", [], ["T-2"]), mkTask("T-2", ["T-1"])]
    const patches = syncBidirectionalLinks(tasks)
    expect(patches.size).toBe(0)
  })

  it("patches missing reverse link: A blocks B but B not blockedBy A", () => {
    const tasks = [mkTask("T-1", [], ["T-2"]), mkTask("T-2")]
    const patches = syncBidirectionalLinks(tasks)
    expect(patches.has("T-2")).toBe(true)
    expect(patches.get("T-2")!.blockedBy).toContain("T-1")
  })

  it("patches missing forward link: B blockedBy A but A does not block B", () => {
    const tasks = [mkTask("T-1"), mkTask("T-2", ["T-1"])]
    const patches = syncBidirectionalLinks(tasks)
    expect(patches.has("T-1")).toBe(true)
    expect(patches.get("T-1")!.blocks).toContain("T-2")
  })

  it("handles multiple inconsistencies", () => {
    const tasks = [
      mkTask("T-1", [], ["T-2", "T-3"]),
      mkTask("T-2", [], ["T-3"]),  // T-2 missing blockedBy T-1
      mkTask("T-3"),               // T-3 missing blockedBy T-1, T-2
    ]
    const patches = syncBidirectionalLinks(tasks)
    expect(patches.get("T-2")!.blockedBy).toContain("T-1")
    expect(patches.get("T-3")!.blockedBy).toContain("T-1")
    expect(patches.get("T-3")!.blockedBy).toContain("T-2")
  })

  it("ignores references to missing tasks", () => {
    const tasks = [mkTask("T-1", [], ["T-missing"])]
    const patches = syncBidirectionalLinks(tasks)
    expect(patches.size).toBe(0)
  })

  it("returns empty for empty task list", () => {
    expect(syncBidirectionalLinks([]).size).toBe(0)
  })
})
