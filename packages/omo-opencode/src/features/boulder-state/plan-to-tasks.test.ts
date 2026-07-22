import { describe, it, expect, beforeEach, afterEach } from "bun:test"
import { existsSync, mkdirSync, rmSync, writeFileSync } from "fs"
import { join } from "path"
import { parsePlanTasks, planToTaskObjects } from "./plan-to-tasks"

const TEST_DIR = "/tmp/plan-to-tasks-test"

const SAMPLE_PLAN = `# Plan: Test Implementation

## Overview
This is a test plan.

## TODOs

- [ ] 1. Set up project structure
  Create directories and initialize config files.
  - AC: Directories exist
- [ ] 2. Implement core module
  Depends on project structure being in place.
  - AC: Module exports work
- [ ] 3. Add tests
  Tests need the core module.
  - AC: Tests pass
- [ ] 4. Update documentation
  Can be done in parallel with tests.
  - AC: Docs are complete

## Execution Strategy

### Wave 1: Foundation
- Task 1 (no dependencies)

### Wave 2: Core
- Task 2 (depends on Task 1)

### Wave 3: Polish
- Tasks 3, 4 (depend on Task 2)

## Final Verification Wave

- [ ] F1. Code Review
  Review all changes.
- [ ] F2. Integration Test
  Run full integration suite.
`

const EMPTY_PLAN = `# Empty Plan

## Overview
Nothing here.
`

const NO_TODOS_PLAN = `# Plan Without Todos

## Overview
Just overview.

## Final Verification Wave

- [ ] F1. Final check
`

describe("parsePlanTasks", () => {
  beforeEach(() => {
    if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true, force: true })
    mkdirSync(TEST_DIR, { recursive: true })
  })

  afterEach(() => {
    if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true, force: true })
  })

  it("returns empty for missing file", () => {
    expect(parsePlanTasks("/nonexistent/file.md")).toEqual([])
  })

  it("parses TODO tasks with labels and titles", () => {
    const planPath = join(TEST_DIR, "plan.md")
    writeFileSync(planPath, SAMPLE_PLAN)

    const tasks = parsePlanTasks(planPath)

    expect(tasks.length).toBe(6)
    const todoTasks = tasks.filter((t) => t.section === "todo")
    expect(todoTasks.length).toBe(4)
    expect(todoTasks[0].label).toBe("1")
    expect(todoTasks[0].title).toBe("Set up project structure")
    expect(todoTasks[0].section).toBe("todo")
    expect(todoTasks[0].key).toBe("todo:1")
    expect(todoTasks[1].label).toBe("2")
    expect(todoTasks[1].title).toBe("Implement core module")
  })

  it("parses Final Verification Wave tasks", () => {
    const planPath = join(TEST_DIR, "plan.md")
    writeFileSync(planPath, SAMPLE_PLAN)

    const tasks = parsePlanTasks(planPath)
    const finalTasks = tasks.filter((t) => t.section === "final-wave")

    expect(finalTasks.length).toBe(2)
    expect(finalTasks[0].label).toBe("F1")
    expect(finalTasks[0].title).toBe("Code Review")
    expect(finalTasks[0].key).toBe("final-wave:f1")
    expect(finalTasks[1].label).toBe("F2")
    expect(finalTasks[1].title).toBe("Integration Test")
  })

  it("captures description text after checkbox", () => {
    const planPath = join(TEST_DIR, "plan.md")
    writeFileSync(planPath, SAMPLE_PLAN)

    const tasks = parsePlanTasks(planPath)
    const task1 = tasks.find((t) => t.key === "todo:1")!

    expect(task1.description).toContain("Create directories")
  })

  it("returns empty for plan with no checkboxes", () => {
    const planPath = join(TEST_DIR, "empty.md")
    writeFileSync(planPath, EMPTY_PLAN)

    expect(parsePlanTasks(planPath)).toEqual([])
  })

  it("handles plan with only final wave tasks", () => {
    const planPath = join(TEST_DIR, "no-todos.md")
    writeFileSync(planPath, NO_TODOS_PLAN)

    const tasks = parsePlanTasks(planPath)
    expect(tasks.length).toBe(1)
    expect(tasks[0].section).toBe("final-wave")
    expect(tasks[0].label).toBe("F1")
  })
})

describe("planToTaskObjects", () => {
  beforeEach(() => {
    if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true, force: true })
    mkdirSync(TEST_DIR, { recursive: true })
  })

  afterEach(() => {
    if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true, force: true })
  })

  it("generates TaskObjects with IDs based on plan keys", () => {
    const planPath = join(TEST_DIR, "plan.md")
    writeFileSync(planPath, SAMPLE_PLAN)

    const tasks = planToTaskObjects(planPath, "session-1")

    expect(tasks.length).toBe(6)
    expect(tasks[0].id).toBe("T-plan-todo-1")
    expect(tasks[0].subject).toBe("Set up project structure")
    expect(tasks[0].status).toBe("pending")
    expect(tasks[0].threadID).toBe("session-1")
  })

  it("sets blockedBy for sequential TODO tasks", () => {
    const planPath = join(TEST_DIR, "plan.md")
    writeFileSync(planPath, SAMPLE_PLAN)

    const tasks = planToTaskObjects(planPath, "session-1")
    const task1 = tasks.find((t) => t.id === "T-plan-todo-1")!
    const task2 = tasks.find((t) => t.id === "T-plan-todo-2")!
    const task3 = tasks.find((t) => t.id === "T-plan-todo-3")!
    const task4 = tasks.find((t) => t.id === "T-plan-todo-4")!

    // Task 1 has no blockers
    expect(task1.blockedBy).toEqual([])

    // Task 2 blocked by task 1
    expect(task2.blockedBy).toContain("T-plan-todo-1")

    // Task 3 blocked by task 2
    expect(task3.blockedBy).toContain("T-plan-todo-2")

    // Task 4 blocked by task 3 (sequential chain)
    expect(task4.blockedBy).toContain("T-plan-todo-3")
  })

  it("final-wave tasks depend on all TODO tasks", () => {
    const planPath = join(TEST_DIR, "plan.md")
    writeFileSync(planPath, SAMPLE_PLAN)

    const tasks = planToTaskObjects(planPath, "session-1")
    const f1 = tasks.find((t) => t.id === "T-plan-final-wave-f1")!
    const f2 = tasks.find((t) => t.id === "T-plan-final-wave-f2")!

    // F1 blocked by all TODO tasks
    expect(f1.blockedBy).toContain("T-plan-todo-1")
    expect(f1.blockedBy).toContain("T-plan-todo-2")
    expect(f1.blockedBy).toContain("T-plan-todo-3")
    expect(f1.blockedBy).toContain("T-plan-todo-4")

    // F2 blocked by all TODO tasks AND F1
    expect(f2.blockedBy).toContain("T-plan-final-wave-f1")
  })

  it("sets blocks arrays bidirectionally", () => {
    const planPath = join(TEST_DIR, "plan.md")
    writeFileSync(planPath, SAMPLE_PLAN)

    const tasks = planToTaskObjects(planPath, "session-1")
    const task1 = tasks.find((t) => t.id === "T-plan-todo-1")!

    expect(task1.blocks).toContain("T-plan-todo-2")
  })

  it("stores plan metadata on each task", () => {
    const planPath = join(TEST_DIR, "plan.md")
    writeFileSync(planPath, SAMPLE_PLAN)

    const tasks = planToTaskObjects(planPath, "session-1")
    const task1 = tasks[0]

    expect(task1.metadata?.plan_file).toBe(planPath)
    expect(task1.metadata?.plan_key).toBe("todo:1")
    expect(task1.metadata?.plan_section).toBe("todo")
    expect(task1.metadata?.plan_label).toBe("1")
  })

  it("returns empty for missing file", () => {
    expect(planToTaskObjects("/nonexistent.md", "session-1")).toEqual([])
  })
})
