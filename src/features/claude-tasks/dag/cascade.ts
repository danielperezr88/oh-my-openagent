import type { TaskObject } from "../../../tools/task/types"
import { canStartTask } from "./enforcement"

/**
 * When a task is completed, find tasks that just became unblocked.
 * Returns tasks that:
 * 1. Have the completed task in their blockedBy list
 * 2. Have ALL other blockers also resolved
 * 3. Are currently in "pending" status
 */
export function getNewlyUnblocked(
  completedTaskId: string,
  allTasks: TaskObject[],
): TaskObject[] {
  return allTasks.filter((task) => {
    if (task.status !== "pending") return false
    if (!task.blockedBy.includes(completedTaskId)) return false
    return canStartTask(task, allTasks)
  })
}
