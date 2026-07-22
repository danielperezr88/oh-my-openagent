import type { TaskObject } from "../../../tools/task/types"

/**
 * Check if a task can transition to `in_progress` based on its dependencies.
 * Returns the list of unresolved blocker IDs (empty = can start).
 */
export function getUnresolvedBlockers(
  task: TaskObject,
  allTasks: TaskObject[],
): string[] {
  const taskMap = new Map(allTasks.map((t) => [t.id, t]))

  return task.blockedBy.filter((blockerId) => {
    const blocker = taskMap.get(blockerId)
    // Missing blockers are considered resolved (task file may have been cleaned up)
    if (!blocker) return false
    return blocker.status !== "completed"
  })
}

/**
 * Check if a task can start (all blockers completed or missing).
 */
export function canStartTask(
  task: TaskObject,
  allTasks: TaskObject[],
): boolean {
  return getUnresolvedBlockers(task, allTasks).length === 0
}
