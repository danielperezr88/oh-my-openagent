import { readFileSync, existsSync } from "fs"
import type { TaskObject } from "../../tools/task/types"

export interface ParsedPlanTask {
  label: string
  section: "todo" | "final-wave"
  title: string
  description: string
  index: number
  key: string
}

const TODO_HEADING = /^##\s+TODOs\b/i
const FINAL_VERIFICATION_HEADING = /^##\s+Final Verification Wave\b/i
const H2_PATTERN = /^##\s+/
const CHECKBOX_PATTERN = /^[-*]\s*\[([ xX])\]\s*(.+)$/
const TODO_TASK_PATTERN = /^(\d+)\.\s+(.+)$/
const FINAL_WAVE_TASK_PATTERN = /^(F\d+)\.\s+(.+)$/i

type PlanSection = "todo" | "final-wave" | "other"

export function parsePlanTasks(planPath: string): ParsedPlanTask[] {
  if (!existsSync(planPath)) return []

  try {
    const content = readFileSync(planPath, "utf-8")
    const lines = content.split(/\r?\n/)
    const tasks: ParsedPlanTask[] = []
    let section: PlanSection = "other"
    let currentTask: ParsedPlanTask | null = null
    let descriptionLines: string[] = []
    const counters: Record<string, number> = { todo: 0, "final-wave": 0 }

    for (const line of lines) {
      if (H2_PATTERN.test(line)) {
        section = TODO_HEADING.test(line)
          ? "todo"
          : FINAL_VERIFICATION_HEADING.test(line)
            ? "final-wave"
            : "other"
      }

      const checkboxMatch = line.match(CHECKBOX_PATTERN)
      if (!checkboxMatch) {
        if (currentTask) {
          descriptionLines.push(line)
        }
        continue
      }

      const isChecked = checkboxMatch[1].toLowerCase() === "x"
      const taskText = checkboxMatch[2].trim()

      if (currentTask) {
        currentTask.description = descriptionLines.join("\n").trim()
      }
      descriptionLines = []

      if (section !== "todo" && section !== "final-wave") continue
      if (isChecked) continue

      const pattern = section === "todo" ? TODO_TASK_PATTERN : FINAL_WAVE_TASK_PATTERN
      const taskMatch = taskText.match(pattern)
      if (!taskMatch) continue

      const label = taskMatch[1]
      const title = taskMatch[2].trim()
      const idx = counters[section]++

      currentTask = {
        label,
        section,
        title,
        description: "",
        index: idx,
        key: section + ":" + label.toLowerCase(),
      }
      tasks.push(currentTask)
    }

    if (currentTask) {
      currentTask.description = descriptionLines.join("\n").trim()
    }

    return tasks
  } catch {
    return []
  }
}

export function planToTaskObjects(planPath: string, sessionID: string): TaskObject[] {
  const parsed = parsePlanTasks(planPath)
  if (parsed.length === 0) return []

  const todoTasks = parsed.filter((t) => t.section === "todo")
  const finalTasks = parsed.filter((t) => t.section === "final-wave")
  const taskMap = new Map<string, TaskObject>()

  for (let i = 0; i < todoTasks.length; i++) {
    const pt = todoTasks[i]
    const taskId = "T-plan-" + pt.key.replace(":", "-")
    const blockedBy: string[] = []

    if (i > 0) {
      const prevTaskId = "T-plan-" + todoTasks[i - 1].key.replace(":", "-")
      blockedBy.push(prevTaskId)
    }

    taskMap.set(pt.key, {
      id: taskId,
      subject: pt.title,
      description: pt.description,
      status: "pending",
      blocks: [],
      blockedBy,
      threadID: sessionID,
      metadata: {
        plan_file: planPath,
        plan_key: pt.key,
        plan_section: pt.section,
        plan_label: pt.label,
      },
    })
  }

  for (let i = 0; i < finalTasks.length; i++) {
    const pt = finalTasks[i]
    const taskId = "T-plan-" + pt.key.replace(":", "-")
    const blockedBy: string[] = []

    for (const todoTask of todoTasks) {
      const todoTaskId = "T-plan-" + todoTask.key.replace(":", "-")
      blockedBy.push(todoTaskId)
    }

    if (i > 0) {
      const prevFinalTaskId = "T-plan-" + finalTasks[i - 1].key.replace(":", "-")
      blockedBy.push(prevFinalTaskId)
    }

    taskMap.set(pt.key, {
      id: taskId,
      subject: pt.title,
      description: pt.description,
      status: "pending",
      blocks: [],
      blockedBy,
      threadID: sessionID,
      metadata: {
        plan_file: planPath,
        plan_key: pt.key,
        plan_section: pt.section,
        plan_label: pt.label,
      },
    })
  }

  const allTasks = Array.from(taskMap.values())
  for (const task of allTasks) {
    for (const blockerId of task.blockedBy) {
      const blocker = allTasks.find((t) => t.id === blockerId)
      if (blocker && !blocker.blocks.includes(task.id)) {
        blocker.blocks.push(task.id)
      }
    }
  }

  return allTasks
}
