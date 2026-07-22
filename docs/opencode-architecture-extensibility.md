# OpenCode Architecture: Extensibility Points for oh-my-openagent

> Analysis date: 2026-04-07
> Based on: `@opencode-ai/plugin` API (v0.4.x), oh-my-openagent source (dev branch)
> Status: OpenCode GitHub repo archived Sep 2025, npm packages still published, oh-my-openagent actively maintained

---

## 1. Plugin System Overview

OpenCode uses a **function-as-plugin** model. A plugin is a single async function that receives a `PluginInput` context and returns a `Hooks` object:

```ts
type Plugin = (input: PluginInput) => Promise<Hooks>
```

**PluginInput** provides:
- `client` -- OpenCode SDK client (session CRUD, messaging, todos, LSP)
- `project` -- current project metadata
- `directory` -- project root path
- `worktree` -- worktree root path
- `serverUrl` -- OpenCode server URL
- `$` -- Bun shell function

The `Hooks` return type defines **16 optional hook points** that form the complete extension surface.

---

## 2. The 16 Hook Points (Plugin API Surface)

### 2.1 Configuration & Registration Hooks

| Hook | Signature | When Called | Purpose |
|------|-----------|------------|---------|
| `config` | `(Config) => void` | Before session creation | Mutate the full OpenCode config (agents, providers, MCPs, tools, commands). Runs once at plugin load. |
| `tool` | `Record<string, ToolDefinition>` | Registration time | Declare tools available to agents. Each tool has `description`, `args` (Zod schema), and `execute()`. |
| `auth` | `() => void` | Provider auth flow | Handle OAuth/API key flows for providers. |

### 2.2 Chat Lifecycle Hooks

| Hook | Input | Mutable Output | Purpose |
|------|-------|---------------|---------|
| `chat.message` | `{sessionID, agent, model, messageID, variant}` | `{message, parts}` | Intercept every new user message. Modify content before LLM sees it. |
| `chat.params` | `{sessionID, agent, model, provider, message}` | `{temperature, topP, topK, options}` | Adjust LLM parameters per-request (reasoning effort, temperature). |
| `chat.headers` | `{sessionID, agent, model, provider, message}` | `{headers}` | Inject/modify HTTP headers to LLM provider (e.g., Copilot auth). |
| `command.execute.before` | `{command, sessionID, arguments}` | `{parts}` | Intercept slash-command execution before it runs. |

### 2.3 Tool Lifecycle Hooks

| Hook | Input | Mutable Output | Purpose |
|------|-------|---------------|---------|
| `tool.execute.before` | `{tool, sessionID, callID}` | `{args}` | Modify tool arguments before execution. Can guard, validate, or redirect. |
| `tool.execute.after` | `{tool, sessionID, callID, args}` | `{title, output, metadata}` | Modify tool results after execution. Can truncate, enrich, or redirect. |
| `tool.definition` | `{toolID}` | `{description, parameters}` | **Modify tool definitions at LLM request time.** Called per-tool before schemas are sent to the model. |

### 2.4 Session & Context Hooks

| Hook | Input | Mutable Output | Purpose |
|------|-------|---------------|---------|
| `event` | `{event: Event}` | -- | Catch-all event stream. Receives session lifecycle, messages, errors, idle, compaction events. |
| `permission.ask` | `Permission` | `{status: "ask" \| "deny" \| "allow"}` | Override permission prompts for tool execution. |

### 2.5 Experimental Hooks

| Hook | Input | Mutable Output | Purpose |
|------|-------|---------------|---------|
| `experimental.chat.messages.transform` | `{}` | `{messages}` | Transform full message array before each LLM call. Used for context injection, micro-compact, reminders. |
| `experimental.chat.system.transform` | `{sessionID?, model}` | `{system}` | Modify the system prompt per-request. |
| `experimental.session.compacting` | `{sessionID}` | `{context, prompt?}` | Customize compaction behavior. Add context strings, modify summary prompt. |
| `experimental.text.complete` | `{sessionID, messageID, partID}` | `{text}` | Modify streamed text output in real-time. |

### 2.6 Environment Hook

| Hook | Input | Mutable Output | Purpose |
|------|-------|---------------|---------|
| `shell.env` | `{cwd, sessionID?, callID?}` | `{env}` | Inject environment variables for shell commands. |

---

## 3. Architecture Patterns for Extension

### 3.1 The Aggregator Pattern (used by oh-my-openagent)

oh-my-openagent uses a **fan-out aggregator** for hooks that need multiple sub-handlers:

```
OpenCode calls hook (e.g., "tool.execute.before")
  -> createToolExecuteBeforeHandler() -- single entry point
    -> dispatches to N internal sub-hooks:
       - file guard
       - label truncator
       - rules injector
       - checkpoint capture
       - etc.
```

This pattern allows oh-my-openagent to compose 50+ internal hooks from OpenCode's ~16 external hook points.

### 3.2 The Mutating Output Pattern

Most hooks use **output mutation** rather than return values. The hook receives an `output` object and modifies it in place:

```ts
"tool.definition": async (input, output) => {
  if (input.toolID === "target_tool") {
    output.description = "Custom description"
    output.parameters = fullSchema
  }
}
```

This is significant because it means hooks can **partially override** -- they don't need to provide the entire definition, just mutate the fields they care about.

### 3.3 The Event-Driven State Pattern

The `event` hook is OpenCode's catch-all notification bus. Events include:
- `session.created`, `session.deleted`, `session.idle`, `session.compacted`
- `message.created`, `message.updated`, `message.part.delta`, `message.part.updated`
- Tool execution events
- Error events

oh-my-openagent dispatches 30+ internal modules from this single event stream, maintaining per-session state machines for complex behaviors (compaction recovery, background task monitoring, loop detection).

---

## 4. Key Extensibility Mechanisms for Backlog Items

### 4.1 `tool.definition` -- The Lazy Loading Enabler

**This is the most important discovery for the Deferred MCP Tool Loading blocker.**

The `tool.definition` hook is called **per-tool, per LLM request** -- right before the tool's schema is sent to the model. It provides mutable access to both `description` and `parameters`.

This means:
1. Register MCP tools as stubs (minimal description, empty parameters)
2. When `tool.definition` fires for an MCP tool, fetch the real schema from the MCP server
3. The LLM gets full schemas only for tools it's about to use

**Current state in oh-my-openagent**: The hook exists in the `@opencode-ai/plugin` API but is **not wired** into `createPluginInterface`. One internal hook (`todoDescriptionOverride`) uses it but it's dead code because the handler is never passed back to OpenCode.

**Wiring required**: Add a `"tool.definition"` entry to the `PluginInterface` return in `src/plugin-interface.ts`, with an aggregator handler that chains sub-hooks.

### 4.2 `experimental.chat.messages.transform` -- The Context Optimizer

Called before every LLM call with the full message array. oh-my-openagent already uses this for:
- Micro-compact (tool result decay)
- Todo nag reminders
- Identity re-injection
- Background result injection

This is the primary hook for any **context window optimization** -- it has access to the entire conversation and can prune, inject, or transform any message.

### 4.3 `event` + `experimental.session.compacting` -- Session Lifecycle Control

Combined, these hooks provide full control over session lifecycle:
- `event` monitors session state transitions (created, idle, compacted, deleted)
- `experimental.session.compacting` customizes what gets preserved during compaction

The compaction hook's `output.context` array is appended to the compaction prompt, allowing the plugin to ensure critical information survives summarization.

### 4.4 `config` -- The Registration-Time Powerhouse

The `config` hook runs once at plugin load and can mutate the entire OpenCode configuration:
- Add/remove/modify agents
- Change provider settings
- Register MCP servers
- Set tool permissions per agent
- Add commands and skills

This is where oh-my-openagent wires its 11 agents, 26 tools, 3 built-in MCPs, and custom commands.

---

## 5. Client SDK Capabilities

The OpenCode client SDK (`ctx.client`) provides these key APIs:

| API | Purpose |
|-----|---------|
| `client.session.create()` | Create new sessions (for sub-agents, background tasks) |
| `client.session.delete()` | Clean up sessions |
| `client.session.list()` | Enumerate sessions |
| `client.session.messages()` | Get message history (for transcript archival, context analysis) |
| `client.session.prompt()` | Send a message to a session (blocking) |
| `client.session.promptAsync()` | Send a message (fire-and-forget) |
| `client.session.summarize()` | Trigger compaction |
| `client.session.todo` | CRUD for OpenCode's native todo system |
| `client.session.update()` | Modify session metadata |

The `promptAsync` with `noReply: true` is the key mechanism for injecting notifications into sessions without triggering an LLM response -- used for background task notifications and system-reminder injections.

---

## 6. Task System Architecture (Plugin-Owned)

The task system is **entirely owned by the plugin** -- it does NOT use OpenCode's core task APIs for CRUD. Key facts:

- **Storage**: Individual JSON files (`T-{uuid}.json`) with file-based locking
- **Schema**: Already includes `blocks` and `blockedBy` arrays
- **Tools**: `task_create`, `task_update`, `task_list`, `task_get` -- all plugin tools
- **Sync**: Optional bidirectional sync with OpenCode's Todo API for UI display
- **Independence**: The task system works without OpenCode's todo system -- the sync is cosmetic

This means the task DAG can be extended purely within the plugin layer, with no dependency on OpenCode core changes.

---

## 7. What Cannot Be Extended (Current Limitations)

| Limitation | Impact | Workaround |
|-----------|--------|------------|
| No dynamic tool add/remove mid-session | Cannot register new tools after session starts | Use `tool.definition` to lazy-load schemas; use proxy execute pattern |
| No access to tool selection logic | Cannot control which tools the model sees per-turn | `tool.definition` can empty descriptions to effectively "hide" tools |
| No streaming hook for tool schemas | `tool.definition` is synchronous per-request | Cache MCP schemas after first fetch |
| No way to intercept compaction result | Cannot modify the summary itself | Use `context` array to guide summarization; use `messages.transform` to post-process |
| OpenCode repo archived | No upstream bug fixes or feature additions | oh-my-openagent is the effective maintainer of its own runtime |

---

## 8. Relationship to Crush

OpenCode's GitHub repo README states it moved to "Crush" by the Charm team. However:
- The npm packages (`@opencode-ai/plugin`, `@opencode-ai/sdk`) remain published and functional
- oh-my-openagent builds directly on these packages
- The plugin API is stable (unchanged across v0.3-v0.4)
- For oh-my-openagent's purposes, OpenCode is the runtime, and the plugin API is the stable interface

Whether Crush is a successor, fork, or parallel project is irrelevant to oh-my-openagent's architecture decisions -- the plugin API is what matters, and it works.
