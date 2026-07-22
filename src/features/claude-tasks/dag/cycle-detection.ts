import type { TaskObject } from "../../../tools/task/types"

/**
 * Check if adding `newBlockedBy` dependencies to `taskId` would create a cycle.
 * Uses DFS to detect if any of the proposed blockers are reachable from `taskId`
 * through the existing dependency graph.
 */
export function wouldCreateCycle(
  taskId: string,
  newBlockedBy: string[],
  allTasks: TaskObject[],
): boolean {
  const taskMap = new Map(allTasks.map((t) => [t.id, t]))

  // A task cannot block itself
  if (newBlockedBy.includes(taskId)) return true

  // For each proposed blocker, check if taskId is reachable via blockedBy chains
  for (const blockerId of newBlockedBy) {
    if (isReachable(blockerId, taskId, taskMap, new Set())) return true
  }

  return false
}

/**
 * Check if `target` is reachable from `source` by following blockedBy edges.
 * If task A is blockedBy B, and B is blockedBy C, then C is reachable from A.
 * If target (taskId) is reachable from a proposed blocker, adding that blocker
 * would create: taskId -> blocker -> ... -> taskId (cycle).
 */
function isReachable(
  source: string,
  target: string,
  taskMap: Map<string, TaskObject>,
  visited: Set<string>,
): boolean {
  if (source === target) return true
  if (visited.has(source)) return false
  visited.add(source)

  const task = taskMap.get(source)
  if (!task) return false

  for (const blockerId of task.blockedBy) {
    if (isReachable(blockerId, target, taskMap, visited)) return true
  }

  return false
}
