import { existsSync } from "fs"
import { join } from "path"
import { planToTaskObjects } from "../../features/boulder-state"
import { getTaskDir, writeJsonAtomic } from "../../features/claude-tasks/storage"
import type { OhMyOpenCodeConfig } from "../../config/schema"
import { TaskObjectSchema } from "../../tools/task/types"
import type { TaskObject } from "../../tools/task/types"
import { log } from "../../shared/logger"
import { HOOK_NAME } from "./hook-name"

/**
 * Sync plan tasks to the task storage system.
 *
 * When DAG is enabled and Atlas has an active plan, this creates TaskObjects
 * from the plan markdown so the DAG engine can track dependencies.
 *
 * Idempotent: skips tasks that already exist in storage.
 */
export function syncPlanTasksToStorage(input: {
  planPath: string
  sessionID: string
  config: Partial<OhMyOpenCodeConfig>
}): { created: number; skipped: number } {
  const { planPath, sessionID, config } = input

  if (!existsSync(planPath)) {
    return { created: 0, skipped: 0 }
  }

  const taskDir = getTaskDir(config)
  const planTasks = planToTaskObjects(planPath, sessionID)

  if (planTasks.length === 0) {
    return { created: 0, skipped: 0 }
  }

  let created = 0
  let skipped = 0

  for (const task of planTasks) {
    const taskPath = join(taskDir, `${task.id}.json`)

    if (existsSync(taskPath)) {
      skipped++
      continue
    }

    const validatedTask = TaskObjectSchema.parse(task)
    writeJsonAtomic(taskPath, validatedTask)
    created++
  }

  if (created > 0) {
    log(`[${HOOK_NAME}] Synced plan tasks to storage`, {
      planPath,
      created,
      skipped,
    })
  }

  return { created, skipped }
}
