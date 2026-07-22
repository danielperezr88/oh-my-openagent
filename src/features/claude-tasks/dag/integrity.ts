import type { TaskObject } from "../../../tools/task/types"

/**
 * Ensure bidirectional link consistency.
 * If A.blocks contains B, then B.blockedBy should contain A (and vice versa).
 * Returns a map of taskId -> patches needed (only tasks with changes).
 */
export function syncBidirectionalLinks(
  tasks: TaskObject[],
): Map<string, { blocks: string[]; blockedBy: string[] }> {
  const taskMap = new Map(tasks.map((t) => [t.id, t]))
  const patches = new Map<string, { blocks: string[]; blockedBy: string[] }>()

  for (const task of tasks) {
    let blocksChanged = false
    let blockedByChanged = false
    const blocks = [...task.blocks]
    const blockedBy = [...task.blockedBy]

    // Forward: if I say I block someone, they should say they're blockedBy me
    for (const blockedId of task.blocks) {
      const blocked = taskMap.get(blockedId)
      if (blocked && !blocked.blockedBy.includes(task.id)) {
        // The blocked task needs patching - we record what it should have
        const existing = patches.get(blockedId) ?? {
          blocks: [...blocked.blocks],
          blockedBy: [...blocked.blockedBy],
        }
        if (!existing.blockedBy.includes(task.id)) {
          existing.blockedBy.push(task.id)
        }
        patches.set(blockedId, existing)
      }
    }

    // Reverse: if I say I'm blockedBy someone, they should say they block me
    for (const blockerId of task.blockedBy) {
      const blocker = taskMap.get(blockerId)
      if (blocker && !blocker.blocks.includes(task.id)) {
        const existing = patches.get(blockerId) ?? {
          blocks: [...blocker.blocks],
          blockedBy: [...blocker.blockedBy],
        }
        if (!existing.blocks.includes(task.id)) {
          existing.blocks.push(task.id)
        }
        patches.set(blockerId, existing)
      }
    }

    if (blocksChanged || blockedByChanged) {
      patches.set(task.id, { blocks, blockedBy })
    }
  }

  return patches
}
