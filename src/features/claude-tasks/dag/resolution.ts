import type { TaskObject } from "../../../tools/task/types"
import { canStartTask } from "./enforcement"

/**
 * Return tasks with status "pending" that have all blockers resolved.
 * These are tasks that are ready to be picked up.
 */
export function getReadyTasks(allTasks: TaskObject[]): TaskObject[] {
  return allTasks.filter(
    (task) => task.status === "pending" && canStartTask(task, allTasks),
  )
}
