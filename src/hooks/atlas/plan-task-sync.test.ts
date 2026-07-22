import { describe, it, expect, beforeEach, afterEach } from "bun:test"
import { existsSync, mkdirSync, rmSync, writeFileSync } from "fs"
import { join } from "path"
import { syncPlanTasksToStorage } from "./plan-task-sync"

const TEST_DIR = "/tmp/plan-task-sync-test"
const TASK_DIR = join(TEST_DIR, "tasks")
const PLANS_DIR = join(TEST_DIR, "plans")

const SAMPLE_PLAN = `# Plan: Sync Test

## TODOs

- [ ] 1. First task
  Setup the project.
  - AC: Done
- [ ] 2. Second task
  Build the thing.
  - AC: Done

## Final Verification Wave

- [ ] F1. Review
  Check everything.
`

const CONFIG_WITH_DAG = {
  experimental: { task_dag: true },
  sisyphus: { tasks: { storage_path: TASK_DIR } },
}

describe("syncPlanTasksToStorage", () => {
  beforeEach(() => {
    if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true, force: true })
    mkdirSync(PLANS_DIR, { recursive: true })
    mkdirSync(TASK_DIR, { recursive: true })
  })

  afterEach(() => {
    if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true, force: true })
  })

  it("creates task files from plan", () => {
    const planPath = join(PLANS_DIR, "test-plan.md")
    writeFileSync(planPath, SAMPLE_PLAN)

    const result = syncPlanTasksToStorage({
      planPath,
      sessionID: "session-1",
      config: CONFIG_WITH_DAG,
    })

    expect(result.created).toBe(3) // 2 todo + 1 final-wave
    expect(result.skipped).toBe(0)

    // Verify task files exist
    expect(existsSync(join(TASK_DIR, "T-plan-todo-1.json"))).toBe(true)
    expect(existsSync(join(TASK_DIR, "T-plan-todo-2.json"))).toBe(true)
    expect(existsSync(join(TASK_DIR, "T-plan-final-wave-f1.json"))).toBe(true)
  })

  it("skips tasks that already exist", () => {
    const planPath = join(PLANS_DIR, "test-plan.md")
    writeFileSync(planPath, SAMPLE_PLAN)

    // First sync creates all tasks
    syncPlanTasksToStorage({ planPath, sessionID: "session-1", config: CONFIG_WITH_DAG })

    // Second sync should skip all
    const result = syncPlanTasksToStorage({
      planPath,
      sessionID: "session-1",
      config: CONFIG_WITH_DAG,
    })

    expect(result.created).toBe(0)
    expect(result.skipped).toBe(3)
  })

  it("returns zeros for missing plan file", () => {
    const result = syncPlanTasksToStorage({
      planPath: "/nonexistent/plan.md",
      sessionID: "session-1",
      config: CONFIG_WITH_DAG,
    })

    expect(result.created).toBe(0)
    expect(result.skipped).toBe(0)
  })

  it("returns zeros for plan with no checkboxes", () => {
    const planPath = join(PLANS_DIR, "empty.md")
    writeFileSync(planPath, "# Empty Plan\n\nJust overview.\n")

    const result = syncPlanTasksToStorage({
      planPath,
      sessionID: "session-1",
      config: CONFIG_WITH_DAG,
    })

    expect(result.created).toBe(0)
    expect(result.skipped).toBe(0)
  })

  it("creates tasks with correct dependency structure", () => {
    const planPath = join(PLANS_DIR, "dep-test.md")
    writeFileSync(planPath, SAMPLE_PLAN)

    syncPlanTasksToStorage({ planPath, sessionID: "s1", config: CONFIG_WITH_DAG })

    const task1 = JSON.parse(require("fs").readFileSync(join(TASK_DIR, "T-plan-todo-1.json"), "utf-8"))
    const task2 = JSON.parse(require("fs").readFileSync(join(TASK_DIR, "T-plan-todo-2.json"), "utf-8"))
    const f1 = JSON.parse(require("fs").readFileSync(join(TASK_DIR, "T-plan-final-wave-f1.json"), "utf-8"))

    expect(task1.blockedBy).toEqual([])
    expect(task2.blockedBy).toContain("T-plan-todo-1")
    expect(f1.blockedBy).toContain("T-plan-todo-1")
    expect(f1.blockedBy).toContain("T-plan-todo-2")
  })
})
