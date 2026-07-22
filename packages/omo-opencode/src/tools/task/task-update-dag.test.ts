import { describe, test, expect, beforeEach, afterEach } from "bun:test"
import { existsSync, rmSync, mkdirSync } from "fs"
import { join } from "path"
import type { TaskObject } from "./types"
import { createTaskUpdateTool } from "./task-update"

const TEST_STORAGE = ".test-task-update-dag"
const TEST_DIR = join(process.cwd(), TEST_STORAGE)
const DAG_CONFIG = {
  sisyphus: {
    tasks: {
      storage_path: TEST_STORAGE,
    },
  },
  experimental: {
    task_dag: true,
  },
}
const NO_DAG_CONFIG = {
  sisyphus: {
    tasks: {
      storage_path: TEST_STORAGE,
    },
  },
  experimental: {
    task_dag: false,
  },
}
const TEST_SESSION_ID = "test-session-dag"
const TEST_CONTEXT = {
  sessionID: TEST_SESSION_ID,
  messageID: "test-message-dag",
  agent: "test-agent",
  abort: new AbortController().signal,
}

async function writeTask(task: TaskObject) {
  const path = join(TEST_DIR, `${task.id}.json`)
  await Bun.write(path, JSON.stringify(task))
}

describe("task_update DAG enforcement", () => {
  let tool: ReturnType<typeof createTaskUpdateTool>

  beforeEach(() => {
    if (existsSync(TEST_STORAGE)) {
      rmSync(TEST_STORAGE, { recursive: true, force: true })
    }
    mkdirSync(TEST_DIR, { recursive: true })
  })

  afterEach(() => {
    if (existsSync(TEST_STORAGE)) {
      rmSync(TEST_STORAGE, { recursive: true, force: true })
    }
  })

  test("blocks starting task with unresolved dependencies when DAG enabled", async () => {
    //#given
    tool = createTaskUpdateTool(DAG_CONFIG)
    const blocker: TaskObject = {
      id: "T-blocker-1",
      subject: "Blocker",
      description: "",
      status: "pending",
      blocks: [],
      blockedBy: [],
      threadID: TEST_SESSION_ID,
    }
    const blocked: TaskObject = {
      id: "T-blocked-1",
      subject: "Blocked task",
      description: "",
      status: "pending",
      blocks: [],
      blockedBy: ["T-blocker-1"],
      threadID: TEST_SESSION_ID,
    }
    await writeTask(blocker)
    await writeTask(blocked)

    //#when
    const resultStr = await tool.execute(
      { id: "T-blocked-1", status: "in_progress" },
      TEST_CONTEXT,
    )
    const result = JSON.parse(resultStr)

    //#then
    expect(result.error).toBe("blocked")
    expect(result.unresolved).toContain("T-blocker-1")
  })

  test("allows starting task when all dependencies are completed", async () => {
    //#given
    tool = createTaskUpdateTool(DAG_CONFIG)
    const blocker: TaskObject = {
      id: "T-blocker-done",
      subject: "Done",
      description: "",
      status: "completed",
      blocks: [],
      blockedBy: [],
      threadID: TEST_SESSION_ID,
    }
    const blocked: TaskObject = {
      id: "T-ready-1",
      subject: "Ready task",
      description: "",
      status: "pending",
      blocks: [],
      blockedBy: ["T-blocker-done"],
      threadID: TEST_SESSION_ID,
    }
    await writeTask(blocker)
    await writeTask(blocked)

    //#when
    const resultStr = await tool.execute(
      { id: "T-ready-1", status: "in_progress" },
      TEST_CONTEXT,
    )
    const result = JSON.parse(resultStr)

    //#then
    expect(result).toHaveProperty("task")
    expect(result.task.status).toBe("in_progress")
  })

  test("reports cascade info when completing a task that unblocks others", async () => {
    //#given
    tool = createTaskUpdateTool(DAG_CONFIG)
    const blocker: TaskObject = {
      id: "T-cascade-1",
      subject: "Will complete",
      description: "",
      status: "in_progress",
      blocks: [],
      blockedBy: [],
      threadID: TEST_SESSION_ID,
    }
    const waiting: TaskObject = {
      id: "T-cascade-2",
      subject: "Waiting",
      description: "",
      status: "pending",
      blocks: [],
      blockedBy: ["T-cascade-1"],
      threadID: TEST_SESSION_ID,
    }
    await writeTask(blocker)
    await writeTask(waiting)

    //#when
    const resultStr = await tool.execute(
      { id: "T-cascade-1", status: "completed" },
      TEST_CONTEXT,
    )
    const result = JSON.parse(resultStr)

    //#then
    expect(result).toHaveProperty("cascade")
    expect(result.cascade).toContain("T-cascade-2")
  })

  test("prevents cycle when adding blockedBy", async () => {
    //#given
    tool = createTaskUpdateTool(DAG_CONFIG)
    const t1: TaskObject = {
      id: "T-cycle-1",
      subject: "T1",
      description: "",
      status: "pending",
      blocks: [],
      blockedBy: [],
      threadID: TEST_SESSION_ID,
    }
    const t2: TaskObject = {
      id: "T-cycle-2",
      subject: "T2",
      description: "",
      status: "pending",
      blocks: [],
      blockedBy: ["T-cycle-1"],
      threadID: TEST_SESSION_ID,
    }
    await writeTask(t1)
    await writeTask(t2)

    //#when: try to add T-2 as blocker of T-1, but T-2 is already blockedBy T-1
    const resultStr = await tool.execute(
      { id: "T-cycle-1", addBlockedBy: ["T-cycle-2"] },
      TEST_CONTEXT,
    )
    const result = JSON.parse(resultStr)

    //#then
    expect(result.error).toBe("would_create_cycle")
  })

  test("does not enforce when DAG disabled", async () => {
    //#given
    tool = createTaskUpdateTool(NO_DAG_CONFIG)
    const blocker: TaskObject = {
      id: "T-no-dag-b",
      subject: "Blocker",
      description: "",
      status: "pending",
      blocks: [],
      blockedBy: [],
      threadID: TEST_SESSION_ID,
    }
    const blocked: TaskObject = {
      id: "T-no-dag-1",
      subject: "Blocked",
      description: "",
      status: "pending",
      blocks: [],
      blockedBy: ["T-no-dag-b"],
      threadID: TEST_SESSION_ID,
    }
    await writeTask(blocker)
    await writeTask(blocked)

    //#when
    const resultStr = await tool.execute(
      { id: "T-no-dag-1", status: "in_progress" },
      TEST_CONTEXT,
    )
    const result = JSON.parse(resultStr)

    //#then: no enforcement, allowed to start
    expect(result).toHaveProperty("task")
    expect(result.task.status).toBe("in_progress")
  })

  test("no cascade info when DAG disabled", async () => {
    //#given
    tool = createTaskUpdateTool(NO_DAG_CONFIG)
    const t1: TaskObject = {
      id: "T-no-cascade-1",
      subject: "Completing",
      description: "",
      status: "in_progress",
      blocks: [],
      blockedBy: [],
      threadID: TEST_SESSION_ID,
    }
    const t2: TaskObject = {
      id: "T-no-cascade-2",
      subject: "Waiting",
      description: "",
      status: "pending",
      blocks: [],
      blockedBy: ["T-no-cascade-1"],
      threadID: TEST_SESSION_ID,
    }
    await writeTask(t1)
    await writeTask(t2)

    //#when
    const resultStr = await tool.execute(
      { id: "T-no-cascade-1", status: "completed" },
      TEST_CONTEXT,
    )
    const result = JSON.parse(resultStr)

    //#then
    expect(result).not.toHaveProperty("cascade")
  })
})
