# Claude Code Harness Analysis: Findings & Implementation Proposal for oh-my-openagent

> Analysis date: 2026-04-05
> Sources: [learn-claude-code](https://github.com/shareAI-lab/learn-claude-code) (reverse-engineered harness docs), oh-my-openagent source code (v3.15.1)

---

## Part 1: Architecture Comparison

### What Claude Code and oh-my-openagent share

Both systems implement the same fundamental pattern: a **model-in-the-loop** architecture where the LLM decides what to do, tools execute it, and results feed back. Both use:

- Tool dispatch maps (register handler + schema, loop never changes)
- Sub-agent spawning with context isolation
- Background/async task execution
- Context window management with compaction
- File-based task persistence
- Skill/knowledge lazy-loading

### Where they diverge fundamentally

| Dimension | Claude Code | oh-my-openagent |
|-----------|-------------|-----------------|
| **Philosophy** | Single omniscient agent + harness. Trust the model entirely. Minimal scaffolding. | Multi-agent specialization. Different models for different jobs. Heavy orchestration. |
| **Agent loop** | One `while True` loop, ~30 lines. Never changes through 12 layers of capability. | OpenCode's loop (external) + plugin hooks that transform messages, system prompts, and tool behavior at multiple interception points. |
| **Model strategy** | One model does everything (Claude). | 10+ agents each with model-specific prompt variants (Claude/GPT/Gemini). Category-based routing. Fallback chains. |
| **Editing** | `old_string`/`new_string` exact match | Hash-anchored `LINE#HASH` references |
| **Planning** | Model plans organically (TodoWrite + nag reminder) | Multi-agent pipeline: Metis (classify) -> Prometheus (plan) -> Momus (review) -> Atlas (execute) |
| **Team coordination** | JSONL mailbox-based messaging, drain-on-read | OpenCode sessions with system-reminder notifications |
| **Worktree isolation** | Git worktree per task, dual state machines (task + worktree), event stream | Defers to OpenCode's built-in worktree support |

---

## Part 2: Claude Code Harness Mechanisms Not Present in oh-my-openagent

### 2.1 Three-Layer Context Compaction (HIGH VALUE)

**What Claude Code does:**
1. **Micro-compact** (every turn): Replaces tool_result content older than N turns with `"[Previous: used {tool_name}]"` if content > 100 chars. Silent, no LLM call.
2. **Auto-compact** (at 50K tokens): Saves full transcript to disk, sends conversation to LLM for summarization (max 2K token summary), replaces entire messages[] with summary.
3. **Manual compact** (model-initiated): Same as auto but triggered by the model when it senses context bloat.

**What oh-my-openagent does:**
- Preemptive compaction at 78% of context limit via `client.session.summarize()`
- Compaction context injector (structured prompt for what to preserve)
- Todo preservation across compaction

**Gap:** oh-my-openagent has no **micro-compact** equivalent — the silent, per-turn decay of old tool results. This is the cheapest and most impactful layer because it runs without any LLM call and keeps the context window from filling up with stale grep/read output. The 78% trigger means the context is already nearly full before any action is taken.

### 2.2 Nag Reminder / TODO Enforcement (PARTIAL)

**What Claude Code does:**
- Tracks `rounds_since_todo` counter
- After 3 rounds without calling `todo`, injects `<reminder>Update your todos.</reminder>` at position 0 of last user message
- Lightweight, no LLM call

**What oh-my-openagent does:**
- `todo-continuation-enforcer` hook monitors for incomplete todos on session.idle
- After 2-second countdown, injects continuation prompt
- Has stagnation detection (stops after 3 stagnant injections)

**Gap:** oh-my-openagent's enforcer only fires on idle (when the agent stops). Claude Code's fires *during* active work — every 3 turns. This catches the model mid-drift before it loses the thread, rather than after it's already stopped.

### 2.3 Agent Identity Re-injection Post-Compression (MEDIUM VALUE)

**What Claude Code does:**
- After context compression, if `len(messages) <= 3`, inserts:
  - User message: `<identity>You are '{name}', role: {role}, team: {team_name}. Continue your work.</identity>`
  - Assistant message: `"I am {name}. Continuing."`
- Prevents teammates from losing their identity/role after summarization

**What oh-my-openagent does:**
- Compaction context injector preserves delegated agent session IDs
- No explicit identity re-injection for the primary agent or sub-agents

**Gap:** When oh-my-openagent's compaction fires during a long Sisyphus orchestration session, the agent loses its behavioral grounding. The dynamic system prompt is re-injected by OpenCode, but the *conversational identity* (what it's been doing, its role context) may be diluted. A lightweight identity injection post-compaction would anchor the agent more firmly.

### 2.4 File-Based Task DAG with Dependency Resolution (PARTIAL)

**What Claude Code does:**
- Tasks stored as individual JSON files in `.tasks/task_{id}.json`
- Each task has `blockedBy: [int]` — dependency list
- When a task completes, `_clear_dependency()` iterates ALL tasks and removes the completed ID from every `blockedBy` list
- Supports parallel branches (diamond dependencies)
- Survives compression and process restarts

**What oh-my-openagent does:**
- Task tools (`task_create/get/list/update`) that sync with OpenCode's built-in todo system
- Plans written as markdown files in `.sisyphus/plans/`
- Atlas reads plan todo lists and executes wave-by-wave

**Gap:** oh-my-openagent's task system delegates to OpenCode's built-in tasks, which may or may not have full DAG semantics. The explicit file-based DAG in Claude Code is robust because it survives any crash — the file system IS the truth. oh-my-openagent's plans are powerful but they're *documents*, not machine-readable dependency graphs that agents can query/update programmatically.

### 2.5 Transcript Archival (LOW-HANGING FRUIT)

**What Claude Code does:**
- Before compaction, saves full conversation to `.transcripts/transcript_{timestamp}.jsonl`
- One JSON object per line per message
- Nothing is ever truly lost — the compressed conversation is in memory, the full history is on disk

**What oh-my-openagent does:**
- No transcript archival before compaction

**Gap:** Simple and valuable. When investigating what went wrong in a long session, having the pre-compaction transcript is invaluable for debugging and for collecting training data.

### 2.6 Worktree-Task Binding with Dual State Machines (CONTEXTUAL)

**What Claude Code does:**
- Each task gets its own git worktree directory
- **Control plane** (`.tasks/`) and **execution plane** (`.worktrees/`) run as parallel state machines
- Binding is bidirectional: task knows its worktree, worktree knows its task
- `remove()` with `complete_task=True` atomically cleans up both
- Event stream (`events.jsonl`) logs lifecycle events

**What oh-my-openagent does:**
- Defers to OpenCode's built-in worktree support
- No explicit worktree-task binding

**Gap:** This is powerful for true multi-agent parallel execution (multiple agents working on different tasks in different worktrees simultaneously). However, oh-my-openagent already achieves parallelism through background agents using separate sessions. The worktree binding becomes relevant when agents need filesystem isolation from each other.

### 2.7 Structured Background Task Notification Injection (PARTIAL)

**What Claude Code does:**
- Background tasks complete → results enqueued to notification queue
- Before each LLM call, `drain_notifications()` injects as: `<background-results>\n[bg:{task_id}] {result}\n</background-results>`
- Truncated to 500 chars for injection (full output stored separately)
- Injected as a user message, ensuring the model sees it

**What oh-my-openagent does:**
- `BackgroundManager` with polling, event-driven completion detection
- On completion, notifies parent session via system-reminder
- Full result available via `background_output(task_id="bg_xxxx")`

**Gap:** The difference is injection style. Claude Code injects results directly into the message stream as a user message before the next LLM call — the model *must* see it. oh-my-openagent uses system-reminder notifications, which may or may not be as reliably attended to by the model. The explicit injection pattern is more robust.

### 2.8 Deferred MCP Tool Loading (MEDIUM VALUE)

**What Claude Code does:**
- Only tool *names* are loaded into the system prompt at startup (~120 tokens for all MCP tools)
- Full tool schemas are loaded on-demand via `ToolSearch` tool when the model decides it needs one
- `ENABLE_TOOL_SEARCH=auto` loads schemas upfront only if they fit within 10% of context window
- Scales to hundreds of MCP tools without consuming context

**What oh-my-openagent does:**
- Built-in MCPs (websearch, context7, grep_app) are registered at startup
- Skill-embedded MCPs are loaded on demand with skills
- No deferred loading of tool schemas — all registered tools have their full schemas in context

**Gap:** With oh-my-openagent's rich tool set (LSP tools, AST-grep, session manager, task tools, etc.) the tool schemas consume a non-trivial portion of the context window. Deferred loading would free up context for actual work.

### 2.9 Path-Scoped Rules (NOVEL PATTERN)

**What Claude Code does:**
- `.claude/rules/*.md` files can have `paths:` YAML frontmatter specifying glob patterns
- Rules only load into context when Claude reads files matching those patterns
- Example: API convention rules only load when API files are touched
- This is a **file-triggered context injection system**

**What oh-my-openagent does:**
- No path-scoped context injection
- Skills load on demand but are triggered by agent/user request, not by file access

**Gap:** This pattern is powerful for large codebases with different conventions in different areas. It's essentially free context that appears exactly when needed and doesn't waste tokens otherwise.

### 2.10 Checkpoint-Based Undo (SAFETY NET)

**What Claude Code does:**
- Every file edit creates a snapshot of the file's pre-edit state
- Users can rewind with Esc-Esc
- Independent of git — works even on uncommitted/untracked files
- Session-level undo system

**What oh-my-openagent does:**
- Hash-anchored editing prevents *corrupted* edits (hash mismatch = rejected before writing)
- No pre-edit snapshots for undo

**Gap:** Hashline prevents corruption but doesn't help when the edit was valid but wrong. Checkpoint-based undo gives the user a safety net for reverting any edit, complementing hashline's corruption prevention.

---

## Part 3: oh-my-openagent Mechanisms Not Present in Claude Code

For completeness — these are things oh-my-openagent does that Claude Code doesn't, and should NOT be removed:

| Mechanism | Value |
|-----------|-------|
| **Hash-anchored editing** | Solves the stale-file edit problem more robustly than exact string matching |
| **Multi-agent specialization** | Different models for different tasks = cost optimization + quality optimization |
| **Category-based model routing** | Agents declare task type, system routes to best available model |
| **Multi-agent planning pipeline** | Metis → Prometheus → Momus → Atlas is more structured than organic todo-driven planning |
| **Ultrawork mode** | Behavioral injection that forces maximum thoroughness — no equivalent in Claude Code |
| **LSP integration** | Real IDE-grade refactoring (rename, find references, diagnostics) vs. just grep+read |
| **AST-grep** | Structural code search across 25 languages |
| **Skill-embedded MCPs** | Skills can bring their own MCP servers on-demand |
| **Ralph Loop** | Self-referential execution loop until completion — more aggressive than Claude Code's team idle polling |
| **Model-specific prompt variants** | Same agent, different prompt for Claude/GPT/Gemini — Claude Code only targets Claude |

---

## Part 4: Implementation Proposal

### Guiding principle

oh-my-openagent is a **long-running agentic orchestration solution**. We are NOT trying to replicate Claude Code's single-agent minimalism. We want to adopt specific **harness mechanisms** that make long-running multi-agent sessions more robust, context-efficient, and debuggable.

### P0 — Micro-Compact (Tool Result Decay)

**What:** Add a hook that runs after every tool execution. For tool results older than the most recent N tool calls, replace the content with a short summary placeholder like `"[Previous: {tool_name} on {file_or_command}]"` — but only if the content exceeds a size threshold (e.g., 200 chars).

**Why:** This is the single highest-impact improvement for long-running sessions. Every `grep`, `read_file`, and `bash` result occupies hundreds to thousands of tokens permanently. Micro-compact silently decays them without any LLM call, dramatically extending how long an agent can work before hitting the 78% compaction threshold.

**Where:** New hook in `src/hooks/` — `micro-compact/`. Would use `experimental.chat.messages.transform` to prune old tool results before each LLM call.

**Estimated complexity:** Low. Pure message array manipulation, no LLM calls, no new dependencies.

**Parameters:**
- `KEEP_RECENT_TOOL_RESULTS`: number of recent tool calls to keep intact (default: 5)
- `MIN_CONTENT_SIZE_FOR_DECAY`: minimum content size to trigger replacement (default: 200 chars)
- Configurable via `oh-my-openagent.json`

### P1 — In-Flight TODO Nag Reminder

**What:** Track rounds since last todo/task update. After N rounds (default: 4) without the agent calling `task_update` or `task_create`, inject a lightweight `<reminder>` message into the conversation.

**Why:** oh-my-openagent's todo-continuation-enforcer only fires on idle. During long autonomous runs (especially with ultrawork), the agent can drift for 10+ tool calls without updating its task list. A mid-flight nag catches drift early.

**Where:** New hook in `src/hooks/` — `todo-nag/`. Would use `tool.execute.after` to increment a counter and `experimental.chat.messages.transform` to inject the reminder.

**Estimated complexity:** Low. Counter + conditional injection.

**Parameters:**
- `NAG_THRESHOLD_ROUNDS`: rounds without todo update before nag (default: 4)
- `NAG_MESSAGE`: configurable reminder text
- Respects compaction cooldown window

### P1 — Transcript Archival Before Compaction

**What:** Before `client.session.summarize()` fires, dump the full conversation to `.sisyphus/transcripts/transcript_{sessionId}_{timestamp}.jsonl`.

**Why:** Enables post-mortem debugging of long sessions. When an agent goes wrong after compaction, you can reconstruct what happened. Also serves as training data collection for prompt/agent improvement.

**Where:** Extend the existing `experimental.session.compacting` hook to save the message array to disk before summarization.

**Estimated complexity:** Very low. File write + JSON serialization.

### P2 — Identity Re-injection After Compaction

**What:** After compaction completes, if the current session is a delegated agent (Sisyphus-Junior, background agent, etc.), inject an identity anchor message: `<identity>You are {agent_name} ({agent_role}). Task: {current_task_description}. Continue.</identity>`

**Why:** Long-running background agents that survive compaction can lose their behavioral grounding. The dynamic system prompt is preserved by OpenCode, but the conversational context of *what this specific agent is doing* can be diluted.

**Where:** Extend compaction context injector in `src/hooks/compaction-context-injector/`. Detect if session is a subagent (via session metadata) and inject identity if so.

**Estimated complexity:** Low-medium. Needs session metadata access to determine agent identity.

### P2 — Structured Background Result Injection

**What:** When a background agent completes, inject its result as a structured `<background-result>` block directly into the parent session's next user message (before the LLM call), rather than relying solely on system-reminder notifications.

**Why:** System-reminder notifications are useful but can be missed or deprioritized by the model, especially in a busy multi-agent session. Direct message injection is more reliable for ensuring the parent agent actually processes the result.

**Where:** Modify `features/background-agent/manager.ts` notification path. Use `experimental.chat.messages.transform` to inject pending background results as structured content blocks.

**Estimated complexity:** Medium. Needs coordination between BackgroundManager completion events and message transform hook timing.

**Parameters:**
- `MAX_INJECTION_LENGTH`: truncation limit for injected results (default: 500 chars). Full result still available via `background_output()`.

### P3 — Machine-Readable Task DAG (Longer term)

**What:** Extend the task system to support explicit `blockedBy` dependencies between tasks, stored as JSON files that survive compaction and restart. When a task completes, automatically unblock dependent tasks.

**Why:** Atlas currently reads plan files (markdown) and executes wave-by-wave. A machine-readable DAG would enable more dynamic scheduling — agents could self-select tasks based on what's unblocked, similar to Claude Code's autonomous agent pattern.

**Where:** Extend `src/tools/task/` with `blockedBy` field support. Add dependency resolution logic.

**Estimated complexity:** Medium-high. Requires changes to task tools, Atlas execution logic, and potentially the background agent spawning system.

**Note:** This overlaps with Claude Code's s07 + s11 (task system + autonomous agents). It would be the biggest structural change and should only be pursued after P0-P2 are validated.

---

## Summary: Priority Matrix

| Priority | Feature | Effort | Impact | Scope Risk |
|----------|---------|--------|--------|------------|
| **P0** | Micro-compact (tool result decay) | Low | **Very High** — extends session lifetime 2-3x | None |
| **P1** | In-flight TODO nag reminder | Low | High — catches drift mid-execution | None |
| **P1** | Transcript archival before compaction | Very Low | Medium — debugging + data collection | None |
| **P2** | Identity re-injection post-compaction | Low-Med | Medium — keeps background agents grounded | None |
| **P2** | Structured background result injection | Medium | Medium-High — more reliable multi-agent comms | Low |
| **P2** | Path-scoped context rules | Medium | Medium — targeted context injection per file area | None |
| **P2** | Checkpoint-based undo (pre-edit snapshots) | Low-Med | Medium — safety net complementing hashline | None |
| **P3** | Deferred MCP tool loading | Medium | Medium — frees context for large tool registries | Low |
| **P3** | Machine-readable task DAG | Med-High | High — enables autonomous task claiming | Medium |

All P0-P2 items are additive hooks/features that don't change oh-my-openagent's architecture. P3 items touch core orchestration or tool registration logic.
## Implementation Status

### Completed (P0-P2)

All P0-P2 features implemented, tested, and committed:

| Priority | Feature | Commit | Tests |
|----------|---------|--------|-------|
| P0 | Micro-compact (tool result decay) | `816ba41c` | 7 |
| P1 | In-flight TODO nag reminder | `f97a57ea` | 8 |
| P1 | Transcript archival before compaction | `18facf7d` | 5 |
| P2 | Identity re-injection post-compaction | `8277259c` | 6 |
| P2 | Structured background result injection | `afb6f65c` | 6 |
| P2 | Path-scoped context rules | `fe76c628` | 16 |
| P2 | Checkpoint-based undo | `47e2195b` | 15 |

Bug fixes applied in commit `852f0bc6`:
- background-result-injection: clear notifications after injection
- identity-reinjection: prevent duplicate injections per transform batch
- checkpoint-undo: fix session ID prefix collision in cleanup

### Notes on todo-nag vs task-reminder coexistence

Both hooks serve complementary purposes:
- `todo-nag` fires **mid-work** via `messages.transform` after N non-task tool calls, catching drift early
- `todo-continuation-enforcer` fires **on idle** when the agent stops, providing a safety net

**Recommendation**: Test both individually in real usage to decide whether to keep both or disable one via `disabled_hooks` in `oh-my-openagent.json`. The nag hook is more proactive (prevents drift before stopping); the enforcer is more reactive (recovers after stopping).

---

## Backlog

### 1. P3 — Deferred MCP Tool Loading

**Status**: Deferred — requires changes to OpenCode's core tool registration API.

**What**: Load MCP tool schemas lazily (only when the agent actually calls a tool from that server) instead of eagerly injecting all tools into every session's context window.

**Why**: Large MCP tool registries consume context window tokens even when the agent never uses most tools. Lazy loading would free context for actual work.

**Blocker**: OpenCode registers tools at session creation time. There is no API to add/remove tools mid-session. This needs a core change.

**Estimated effort if unblocked**: Medium. Would need a new `registerTools(sessionID, tools)` API or a tool-proxy pattern in the plugin.

### 2. P3 — Machine-Readable Task DAG

**Status**: Deferred — requires changes to task tools + Atlas execution logic.

**What**: Extend the task system with explicit `blockedBy` dependencies between tasks, stored as JSON files that survive compaction and restart. When a task completes, automatically unblock dependents.

**Why**: Atlas currently reads plan files (markdown) and executes wave-by-wave. A machine-readable DAG enables dynamic scheduling where agents self-select tasks based on what's unblocked.

**Blocker**: Task tools are provided by OpenCode's core, not the plugin. The plugin can only observe tasks via events, not modify their schema. Atlas execution logic would need DAG-aware dispatch.

**Estimated effort if unblocked**: Medium-high. Requires task tool schema changes, dependency resolution engine, and Atlas integration.

### 3. Checkpoint-Undo Enhancement — Full Pre-Edit Content Capture

**Status**: COMPLETED (2026-04-06).

**What was done**:
- `hook.ts` now extracts file path from `output.args` in `toolExecuteBefore` (using `filePath ?? path ?? file_path` pattern)
- Reads the file content via `readFile()` before the edit executes
- `saveCheckpoint` writes pre-edit snapshots as JSON to `{directory}/.sisyphus/checkpoints/{sessionID}_{callID}.json`
- Enforces `maxCheckpoints` limit by cleaning up oldest checkpoints per session
- Cleans up checkpoint files on `session.deleted`
- Accepts `directory` option via `createCheckpointUndoHook({ directory })`
- `directory` is threaded from `ctx.directory` in `create-session-hooks.ts`
- Handles absolute and relative paths correctly on Windows
- 30 tests covering: file content capture, new files, multiple key patterns, absolute paths, metadata fallback, output text parsing, maxCheckpoints enforcement, session deletion cleanup, prefix collision safety, custom checkpointsDir, multi-edit scenarios, large files, no-directory mode

---

## Test Coverage Report (2026-04-06)

### New tests added: 235 across 7 files

| Module | File | Tests | Key Coverage |
|--------|------|-------|--------------|
| keyword-detector/ultrawork | `source-detector.test.ts` | 48 | isPlannerAgent, isNonOmoAgent, isGptModel, isGeminiModel, getUltraworkSource |
| keyword-detector/ultrawork | `index.test.ts` | 13 | getUltraworkMessage routing, content markers per source |
| model-capabilities | `runtime-model-readers.test.ts` | 92 | All 9 reader functions, edge cases, precedence rules |
| sisyphus-junior-notepad | `hook.test.ts` | 15 | Constants, tool filtering, orchestrator check, double injection guard, directive prepend |
| ast-grep | `sg-compact-json-output.test.ts` | 14 | JSON parsing, truncation recovery, boundary conditions |
| ast-grep | `result-formatter.test.ts` | 23 | All 4 formatters, error/empty/truncated/normal cases |
| checkpoint-undo | `hook.test.ts` | 30 | Pre-edit capture, disk persistence, maxCheckpoints, session cleanup, prefix safety, absolute paths |

### Issues found during testing

No bugs found. All modules tested as expected — source-detector routing, runtime model reader precedence chains, notepad hook guard logic, and ast-grep formatters all behave correctly.

### Remaining untested modules (skipped, see plan rationale)

- `openclaw/` (1,672 lines): Core orchestration, coupled to runtime state
- `hooks/interactive-bash-session/` (608 lines): Tmux-dependent
- `shared/command-executor/` (264 lines): Shell execution layer
- `tools/interactive-bash/` (229 lines): Tool wrapper
- `features/builtin-skills/skills/` (2,823 lines): Prompt templates

### Pre-existing test failures

The full suite has 208 pre-existing test failures (out of 5,070 tests) unrelated to this work. These are primarily in skill tool MCP mocking and existed before this test coverage effort.

