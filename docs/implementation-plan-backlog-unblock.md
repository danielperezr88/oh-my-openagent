# Implementation Plan: Unblocking P3 Backlog Items

> Date: 2026-04-07
> Status: **Item 1: IMPLEMENTED** | Item 2: IMPLEMENTED
> Related: `docs/opencode-architecture-extensibility.md`, `docs/claude-code-harness-analysis.md`

---

## Executive Summary

Both P3 backlog items are **far less blocked than originally assessed**:

| Item | Original Blocker | Actual Situation |
|------|-----------------|------------------|
| **Deferred MCP Tool Loading** | "Requires changes to OpenCode's core tool registration API" | The `tool.definition` hook in OpenCode's plugin API provides exactly what we need. It's already used (dead code) in the codebase. No core changes required. |
| **Machine-Readable Task DAG** | "Task tools are provided by OpenCode's core, not the plugin" | The task system is **entirely plugin-owned**. `blockedBy`/`blocks` fields already exist in the schema. Only logic is missing: enforcement, resolution, cascade. No OpenCode dependency at all. |

---

## Item 1: Deferred MCP Tool Loading

### Background: How Claude Code Does It

Claude Code uses a **stub-first + API-native deferred loading** mechanism:

1. MCP tools registered with `defer_loading: true` (Anthropic API feature)
2. Only tool names sent to model (no schemas)
3. `ToolSearch` tool lets model request full schemas
4. Anthropic API expands `tool_reference` blocks server-side

**Why we can't copy this directly**: It depends on Anthropic API-specific features (`defer_loading`, `tool_reference`). oh-my-openagent is multi-provider (Claude, GPT, Gemini, etc.).

### Our Approach: `tool.definition` + `discover_tools` (Provider-Agnostic)

The `tool.definition` hook is called **per-tool, per LLM request** with mutable output. This gives us a provider-agnostic equivalent to Claude Code's `defer_loading`.

#### Architecture

```
Plugin init:
  -> Register all MCP tools with full schemas (execute works)
  -> Mark MCP tools as "deferred" in internal registry

Every LLM request:
  -> OpenCode calls tool.definition(toolID, output) for each tool
  -> Our handler checks:
     - Is this an MCP tool? Is it "discovered"?
     - UNDISCOVERED: output.description = stub, output.parameters = {}
     - DISCOVERED: output.description = full, output.parameters = full
  -> Inject <available-deferred-tools> list in messages.transform

Model wants an MCP tool:
  -> Calls discover_tools(query) -- our new tool
  -> discover_tools searches MCP tool names/descriptions
  -> Marks matching tools as "discovered" in session state
  -> Returns list of now-available tools with descriptions
  -> Next LLM call: tool.definition provides full schemas for discovered tools
  -> Model can now call the MCP tool with proper parameters
```

#### Implementation Steps

**Step 1: Wire `tool.definition` into PluginInterface** (src/plugin-interface.ts)

Add a new aggregator handler:
```ts
"tool.definition": async (input: { toolID: string }, output: { description: string; parameters: unknown }) => {
  // Chain: todoDescriptionOverride -> mcpDeferredLoader
  await todoDescriptionOverride?.["tool.definition"]?.(input, output)
  await mcpDeferredLoader?.["tool.definition"]?.(input, output)
}
```

Create `src/plugin/tool-definition.ts` with the aggregator logic, following the same pattern as `tool-execute-before.ts`.

**Step 2: Create MCP Deferred Loader** (src/hooks/mcp-deferred-loader/)

New module with:
- `hook.ts` -- the `tool.definition` handler that swaps stub/full schemas
- `registry.ts` -- per-session tracking of discovered MCP tools
- `constants.ts` -- stub description template, config defaults

The registry stores a `Set<string>` of discovered tool IDs per session. On `tool.definition`:
- If tool is MCP and NOT in discovered set -> replace with stub
- If tool is MCP and IS in discovered set -> keep full schema

**Step 3: Create `discover_tools` Tool** (src/tools/discover-tools/)

New tool registered in `tool-registry.ts`:
- Input: `query` (string) -- tool name or keyword search
- Output: List of matching tools with names, descriptions, and categories
- Side effect: Marks matched tools as "discovered" in the deferred loader registry
- Description: "Search and discover MCP tools. Returns tool descriptions and unlocks their schemas for use."

**Step 4: Inject Available Tools List** (messages.transform)

Add a sub-hook in `messages.transform` that injects a `<available-deferred-tools>` block listing undiscovered MCP tool names. This mirrors Claude Code's approach but works across all providers:
```
<available-deferred-tools>
mcp__websearch__search, mcp__websearch__fetch, mcp__context7__resolve, mcp__grep_app__search
Use discover_tools(query) to unlock tool schemas.
</available-deferred-tools>
```

**Step 5: Config Integration**

Add to `oh-my-openagent.jsonc` config schema:
```jsonc
{
  "mcp_deferred_loading": {
    "enabled": true,           // master switch
    "always_load": ["websearch"],  // MCP server names to never defer
    "stub_description": "Deferred MCP tool. Use discover_tools to unlock."
  }
}
```

Also respect MCP server `_meta['anthropic/alwaysLoad']` if present.

**Step 6: Event Cleanup**

On `session.deleted` -> clear discovered set for that session.
On `session.compacted` -> preserve discovered set (tools remain available).

#### Files to Create/Modify

| Action | File | Purpose |
|--------|------|---------|
| Create | `src/hooks/mcp-deferred-loader/hook.ts` | tool.definition handler |
| Create | `src/hooks/mcp-deferred-loader/registry.ts` | Per-session discovered state |
| Create | `src/hooks/mcp-deferred-loader/constants.ts` | Config defaults |
| Create | `src/hooks/mcp-deferred-loader/index.ts` | Barrel export |
| Create | `src/hooks/mcp-deferred-loader/hook.test.ts` | Tests |
| Create | `src/tools/discover-tools/create-discover-tools.ts` | Tool factory |
| Create | `src/tools/discover-tools/index.ts` | Barrel export |
| Create | `src/tools/discover-tools/create-discover-tools.test.ts` | Tests |
| Modify | `src/plugin/tool-registry.ts` | Register discover_tools tool |
| Modify | `src/plugin-interface.ts` | Add tool.definition handler |
| Modify | `src/create-hooks.ts` | Create mcp-deferred-loader hooks |
| Modify | `src/plugin/messages-transform.ts` | Add deferred-tools-list injection |
| Modify | `src/config/schema/` | Add mcp_deferred_loading config |

#### Edge Cases

- **First-call latency**: The first time a model calls an MCP tool, it must `discover_tools` first, adding one extra turn. Mitigate by auto-discovering tools mentioned in user message or system prompt.
- **Context window savings**: Stub schemas are ~20 tokens vs full schemas at 200-500 tokens each. With 20 MCP tools, this saves ~4000-9000 tokens per request.
- **Non-MCP tools**: Built-in tools (bash, read, write, etc.) are never deferred. Only MCP tools.
- **Multi-provider**: Since `tool.definition` works at the OpenCode layer (before the provider request), this works with all LLM providers.

---

## Item 2: Machine-Readable Task DAG

### Background: Current State

The task system is **entirely plugin-owned** and the `blockedBy`/`blocks` fields already exist in the schema:

- `TaskObjectSchema` has `blockedBy: z.array(z.string()).default([])` and `blocks: z.array(z.string()).default([])`
- `task-create` accepts these at creation time
- `task-update` supports additive `addBlockedBy` / `addBlocks`
- `task-list` filters completed blockers from display
- **No enforcement, no resolution, no cascade, no cycle detection**

Atlas uses a separate markdown-plan system (checkboxes in `.sisyphus/plans/`) and does NOT use the task tool's blockedBy system at all.

### Approach: Dual-Write Bridge + Gradual Migration

The bridge pattern preserves backward compatibility while adding DAG semantics underneath.

#### Phase 1: DAG Engine (Pure Addition, No Breaking Changes)

**Step 1: Create DAG Resolution Utilities** (src/features/claude-tasks/dag/)

New module with:
- `resolution.ts` -- `getReadyTasks(tasks)`: returns tasks where `status === "pending"` and all `blockedBy` resolve to completed tasks
- `enforcement.ts` -- `canStartTask(task, allTasks)`: checks if task can transition to `in_progress`
- `cycle-detection.ts` -- `wouldCreateCycle(taskId, newBlockedBy, allTasks)`: DFS to prevent circular dependencies
- `cascade.ts` -- `onTaskCompleted(taskId, allTasks)`: returns list of tasks that just became unblocked
- `integrity.ts` -- `syncBidirectionalLinks(tasks)`: ensures if A blocks B, then B is blockedBy A

**Step 2: Add Enforcement to task-update** (src/tools/task/task-update/)

Before allowing a status transition to `in_progress`:
```
if (newStatus === "in_progress") {
  const unresolved = task.blockedBy.filter(id => {
    const blocker = getTask(id)
    return blocker?.status !== "completed"
  })
  if (unresolved.length > 0) {
    return `Cannot start: blocked by ${unresolved.join(", ")}`
  }
}
```

**Step 3: Add Completion Cascade to task-update** (src/tools/task/task-update/)

After setting a task to `completed`:
```
const newlyReady = onTaskCompleted(taskId, allTasks)
if (newlyReady.length > 0) {
  output += `\nNewly unblocked tasks: ${newlyReady.map(t => t.id).join(", ")}`
}
```

**Step 4: Add Cycle Detection to task-update** (src/tools/task/task-update/)

Before allowing `addBlockedBy`:
```
if (wouldCreateCycle(taskId, newBlockedBy, allTasks)) {
  return "Cannot add dependency: would create a cycle"
}
```

**Step 5: Add `get_ready_tasks` to task-list** (src/tools/task/task-list/)

New query option on `task-list`:
```ts
// When ?ready=true, only return tasks with empty blockedBy (after filtering completed)
if (input.ready) {
  tasks = tasks.filter(t => t.blockedBy.every(id => {
    const blocker = allTasks.find(b => b.id === id)
    return blocker?.status === "completed"
  }))
}
```

#### Phase 2: Plan-to-Tasks Bridge (Atlas Enhancement, Non-Breaking)

**Step 6: Create Plan Parser** (src/features/boulder-state/plan-to-tasks.ts)

New module that parses a Prometheus plan markdown file and generates `TaskObject[]`:
- Parse `## TODOs` section for checkbox items
- Parse `## Execution Strategy` for wave/dependency information
- Parse `## Final Verification Wave` for final tasks
- Generate TaskObjects with:
  - `subject`: task title from checkbox
  - `blockedBy`: derived from wave ordering or explicit "Depends on" annotations
  - `metadata.category`: from task metadata
  - `metadata.skills`: from task metadata
  - `metadata.wave`: from execution strategy
  - `metadata.plan_file`: source plan path

**Step 7: Auto-Bridge Trigger** (src/hooks/atlas/event-handler.ts)

When Atlas starts a new plan (detected via boulder state creation):
1. Parse the plan file using plan-to-tasks
2. Create TaskObjects for all tasks
3. Store mapping: checkbox index -> taskId in boulder state
4. Atlas continues to use checkboxes for UI, but tasks are available for programmatic queries

**Step 8: Enhance Atlas Prompt** (src/agents/atlas/default-prompt-sections.ts)

Add optional section (feature-gated):
```
When planning execution order, use task_list with ready=true to find unblocked tasks.
After completing a task, use task_update with status=completed to automatically unblock dependent tasks.
```

**Step 9: Sync Checkbox <-> Task State** (src/hooks/atlas/tool-execute-after.ts)

When Atlas marks a checkbox `- [x]` in the plan:
- Find the corresponding TaskObject via the mapping
- Call task-update internally to mark it completed
- This triggers the cascade (unblocking dependent tasks)

When a task is completed via task-update:
- Update the corresponding checkbox in the plan markdown (if mapping exists)

#### Phase 3: Feature Gate

Gate the entire DAG system behind a config flag:
```jsonc
{
  "experimental": {
    "task_dag": false  // default off, opt-in
  }
}
```

When disabled:
- task-create/update/list work as before (fields exist but no enforcement)
- Atlas uses markdown plans as before
- No bridge, no cascade, no enforcement

When enabled:
- All Phase 1 enforcement active
- Plan-to-tasks bridge active (Phase 2)
- Atlas prompt includes DAG-aware instructions

#### Files to Create/Modify

| Action | File | Purpose |
|--------|------|---------|
| Create | `src/features/claude-tasks/dag/resolution.ts` | getReadyTasks |
| Create | `src/features/claude-tasks/dag/enforcement.ts` | canStartTask |
| Create | `src/features/claude-tasks/dag/cycle-detection.ts` | wouldCreateCycle |
| Create | `src/features/claude-tasks/dag/cascade.ts` | onTaskCompleted |
| Create | `src/features/claude-tasks/dag/integrity.ts` | syncBidirectionalLinks |
| Create | `src/features/claude-tasks/dag/index.ts` | Barrel export |
| Create | `src/features/claude-tasks/dag/*.test.ts` | Tests per module |
| Create | `src/features/boulder-state/plan-to-tasks.ts` | Markdown plan -> TaskObjects |
| Create | `src/features/boulder-state/plan-to-tasks.test.ts` | Tests |
| Modify | `src/tools/task/task-update/` | Add enforcement, cascade, cycle detection |
| Modify | `src/tools/task/task-list/` | Add ready=true query |
| Modify | `src/hooks/atlas/event-handler.ts` | Auto-bridge trigger |
| Modify | `src/hooks/atlas/tool-execute-after.ts` | Checkbox <-> task sync |
| Modify | `src/agents/atlas/default-prompt-sections.ts` | DAG-aware prompt |
| Modify | `src/config/schema/` | Add task_dag config |

---

## Implementation Order

```
Week 1: Foundation
  1. Wire tool.definition into PluginInterface (Item 1, Step 1)
  2. Create DAG resolution + enforcement utilities (Item 2, Steps 1-2)
  3. Tests for DAG utilities

Week 2: MCP Deferred Loading
  4. MCP deferred loader hook (Item 1, Steps 2-3)
  5. discover_tools tool (Item 1, Step 3)
  6. Messages transform injection (Item 1, Step 4)
  7. Config integration (Item 1, Step 5)
  8. Tests for MCP deferred loading

Week 3: Task DAG Completion
  9. Cycle detection + cascade (Item 2, Steps 3-4)
  10. task-list ready query (Item 2, Step 5)
  11. Tests for task DAG enforcement

Week 4: Atlas Bridge (Feature-Gated)
  12. Plan-to-tasks parser (Item 2, Step 6)
  13. Auto-bridge trigger (Item 2, Steps 7-8)
  14. Atlas prompt enhancement (Item 2, Step 8)
  15. Checkbox <-> task sync (Item 2, Step 9)
  16. Integration tests
```

---

## Risk Assessment

| Risk | Likelihood | Mitigation |
|------|-----------|------------|
| `tool.definition` not called for all tools | Low -- it's in the plugin API contract | Test with all providers early |
| MCP tool schema fetch is slow | Medium -- first discovery adds latency | Cache schemas aggressively; preload in background |
| DAG cycle detection is expensive | Low -- task lists are small (<100) | DFS on <100 nodes is negligible |
| Atlas prompt changes break orchestration | Medium -- LLM behavior is non-deterministic | Feature gate; keep markdown plan as fallback |
| Plan-to-tasks parser misses edge cases | Medium -- markdown is unstructured | Start with strict parsing; add fallback to manual task creation |

---

## Success Metrics

**Deferred MCP Tool Loading:**
- Token savings per request (measure tool schema tokens before/after)
- Number of MCP tools discovered per session
- First-call latency overhead (discover_tools turn)

**Task DAG:**
- Number of tasks with dependencies created per plan
- Parallel execution improvement (measure concurrent tasks before/after)
- Blocked-task violations caught by enforcement
