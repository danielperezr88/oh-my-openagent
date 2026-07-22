import type { PluginInput } from "@opencode-ai/plugin";
import { tool, type ToolDefinition } from "@opencode-ai/plugin/tool";
import { join } from "path";
import { readdirSync } from "fs";
import type { OhMyOpenCodeConfig } from "../../config/schema";
import { TaskObjectSchema, TaskUpdateInputSchema } from "./types";
import type { TaskObject, TaskStatus } from "./types";
import {
  getTaskDir,
  readJsonSafe,
  writeJsonAtomic,
  acquireLock,
} from "../../features/claude-tasks/storage";
import { syncTaskTodoUpdate } from "./todo-sync";
import {
  wouldCreateCycle,
  getUnresolvedBlockers,
  getNewlyUnblocked,
} from "../../features/claude-tasks/dag";

const TASK_ID_PATTERN = /^T-[A-Za-z0-9-]+$/;

function parseTaskId(id: string): string | null {
  if (!TASK_ID_PATTERN.test(id)) return null;
  return id;
}

function isDagEnabled(config: Partial<OhMyOpenCodeConfig>): boolean {
  return config.experimental?.task_dag === true;
}

function loadAllTasks(taskDir: string): TaskObject[] {
  try {
    const files = readdirSync(taskDir)
      .filter((f) => f.endsWith(".json") && f.startsWith("T-"))
      .map((f) => f.replace(".json", ""));
    const tasks: TaskObject[] = [];
    for (const fileId of files) {
      const task = readJsonSafe(join(taskDir, `${fileId}.json`), TaskObjectSchema);
      if (task) tasks.push(task);
    }
    return tasks;
  } catch {
    return [];
  }
}

export function createTaskUpdateTool(
  config: Partial<OhMyOpenCodeConfig>,
  ctx?: PluginInput,
): ToolDefinition {
   return tool({
     description: `Update an existing task with new values.

Supports updating: subject, description, status, activeForm, owner, metadata.
For blocks/blockedBy: use addBlocks/addBlockedBy to append (additive, not replacement).
For metadata: merge with existing, set key to null to delete.
Syncs to OpenCode Todo API after update.

**IMPORTANT - Dependency Management:**
Use \`addBlockedBy\` to declare dependencies on other tasks.
Properly managed dependencies enable maximum parallel execution.

When task DAG is enabled (experimental.task_dag):
- Cannot start a task that has unresolved blockers
- Cycle detection prevents circular dependencies
- Completing a task reports newly unblocked tasks`,
     args: {
      id: tool.schema.string().describe("Task ID (required)"),
      subject: tool.schema.string().optional().describe("Task subject"),
      description: tool.schema.string().optional().describe("Task description"),
      status: tool.schema
        .enum(["pending", "in_progress", "completed", "deleted"])
        .optional()
        .describe("Task status"),
      activeForm: tool.schema
        .string()
        .optional()
        .describe("Active form (present continuous)"),
      owner: tool.schema
        .string()
        .optional()
        .describe("Task owner (agent name)"),
      addBlocks: tool.schema
        .array(tool.schema.string())
        .optional()
        .describe("Task IDs to add to blocks (additive, not replacement)"),
      addBlockedBy: tool.schema
        .array(tool.schema.string())
        .optional()
        .describe("Task IDs to add to blockedBy (additive, not replacement)"),
      metadata: tool.schema
        .record(tool.schema.string(), tool.schema.unknown())
        .optional()
        .describe("Task metadata to merge (set key to null to delete)"),
    },
    execute: async (args, context) => {
      return handleUpdate(args, config, ctx, context);
    },
  });
}

async function handleUpdate(
  args: Record<string, unknown>,
  config: Partial<OhMyOpenCodeConfig>,
  ctx: PluginInput | undefined,
  context: { sessionID: string },
): Promise<string> {
  try {
    const validatedArgs = TaskUpdateInputSchema.parse(args);
    const taskId = parseTaskId(validatedArgs.id);
    if (!taskId) {
      return JSON.stringify({ error: "invalid_task_id" });
    }

    const taskDir = getTaskDir(config);
    const lock = acquireLock(taskDir);

    if (!lock.acquired) {
      return JSON.stringify({ error: "task_lock_unavailable" });
    }

    try {
      const taskPath = join(taskDir, `${taskId}.json`);
      const task = readJsonSafe(taskPath, TaskObjectSchema);

      if (!task) {
        return JSON.stringify({ error: "task_not_found" });
      }

      const dagEnabled = isDagEnabled(config);

      // DAG enforcement: check cycle before adding blockedBy
      if (dagEnabled) {
        const addBlockedBy = args.addBlockedBy as string[] | undefined;
        if (addBlockedBy && addBlockedBy.length > 0) {
          const allTasks = loadAllTasks(taskDir);
          if (wouldCreateCycle(taskId, addBlockedBy, allTasks)) {
            return JSON.stringify({ error: "would_create_cycle", message: "Cannot add dependency: would create a circular dependency chain." });
          }
        }
      }

      if (validatedArgs.subject !== undefined) {
        task.subject = validatedArgs.subject;
      }
      if (validatedArgs.description !== undefined) {
        task.description = validatedArgs.description;
      }
      if (validatedArgs.activeForm !== undefined) {
        task.activeForm = validatedArgs.activeForm;
      }
      if (validatedArgs.owner !== undefined) {
        task.owner = validatedArgs.owner;
      }

      const addBlocks = args.addBlocks as string[] | undefined;
      if (addBlocks) {
        task.blocks = [...new Set([...task.blocks, ...addBlocks])];
      }

      const addBlockedBy = args.addBlockedBy as string[] | undefined;
      if (addBlockedBy) {
        task.blockedBy = [...new Set([...task.blockedBy, ...addBlockedBy])];
      }

      if (validatedArgs.metadata !== undefined) {
        task.metadata = { ...task.metadata, ...validatedArgs.metadata };
        Object.keys(task.metadata).forEach((key) => {
          if (task.metadata?.[key] === null) {
            delete task.metadata[key];
          }
        });
      }

      // DAG enforcement: block starting task with unresolved dependencies
      if (dagEnabled && validatedArgs.status === "in_progress") {
        const allTasks = loadAllTasks(taskDir);
        const pendingStatus = validatedArgs.status as TaskStatus;
        // Refresh the task in the allTasks list for accurate checking
        const updatedAllTasks = allTasks.map((t) => (t.id === taskId ? { ...task, status: pendingStatus } : t));
        const unresolved = getUnresolvedBlockers({ ...task, status: pendingStatus }, updatedAllTasks);
        if (unresolved.length > 0) {
          return JSON.stringify({
            error: "blocked",
            message: `Cannot start: blocked by ${unresolved.join(", ")}. Complete those tasks first.`,
            unresolved,
          });
        }
      }

      // Check if we're completing a task (for cascade)
      const wasCompleting = validatedArgs.status === "completed";
      if (validatedArgs.status !== undefined) {
        task.status = validatedArgs.status;
      }

      const validatedTask = TaskObjectSchema.parse(task);
      writeJsonAtomic(taskPath, validatedTask);

      await syncTaskTodoUpdate(ctx, validatedTask, context.sessionID);

      // DAG cascade: report newly unblocked tasks on completion
      let cascadeInfo: string | undefined;
      if (dagEnabled && wasCompleting) {
        const allTasks = loadAllTasks(taskDir);
        const newlyUnblocked = getNewlyUnblocked(taskId, allTasks);
        if (newlyUnblocked.length > 0) {
          cascadeInfo = `Newly unblocked tasks: ${newlyUnblocked.map((t) => t.id).join(", ")}`;
        }
      }

      const result: Record<string, unknown> = { task: validatedTask };
      if (cascadeInfo) {
        result.cascade = cascadeInfo;
      }

      return JSON.stringify(result);
    } finally {
      lock.release();
    }
  } catch (error) {
    if (error instanceof Error && error.message.includes("Required")) {
      return JSON.stringify({
        error: "validation_error",
        message: error.message,
      });
    }
    return JSON.stringify({ error: "internal_error" });
  }
}
