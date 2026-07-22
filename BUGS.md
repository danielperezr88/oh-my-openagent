# Fork Bugs & Known Issues

Issues specific to this fork of oh-my-openagent. Not applicable to upstream `code-yeongyu/oh-my-openagent`.

---

## `discover_tools` does not find external MCP tools

- **Date**: 2026-07-02
- **Severity**: Medium — orchestrator agents (Sisyphus) cannot dynamically discover external MCP tool suites without manually knowing tool names
- **Status**: Open

### Symptom

Calling `discover_tools(query="astrolabe")` returns `no_matches` with only OMO's 3 built-in MCPs (websearch, context7, grep_app) listed as available. External MCP tools registered via OpenCode's native `opencode.json` → `mcp` config are invisible.

### Root Cause

In `src/plugin/tool-registry.ts:382-386`:
```ts
discover_tools: createDiscoverToolsTool({
  registry: mcpDeferredRegistry,
  getMcpToolIDs: () => extractMcpToolIDs(allTools),       // allTools = OMO-native only
  getToolDescriptions: () => extractMcpToolDescriptions(allTools),
})
```

`allTools` is built from OMO's own tool factories (`createGrepTools`, `createGlobTools`, etc.) and includes only the 3 OMO-native MCP servers (websearch, context7, grep_app). External MCPs registered via OpenCode's native config are never added to `allTools`.

Additionally, `McpDeferredRegistry.setAllMcpToolIDs()` and `setToolDescriptions()` are **never called in production code** — only in tests.

### Impact

Any external MCP server (astrolabe, codegraph, etc.) registered via `opencode.json` is invisible to `discover_tools`. The Sisyphus orchestrator cannot use its self-discovery mechanism to find available tooling — it must already know tool names. This affects the `discover_tools` → unlock → use flow that was designed in `docs/implementation-plan-backlog-unblock.md` (Item 1).

### Workaround

Manual knowledge: the orchestrator can call external MCP tools directly by name without using `discover_tools`. Tools are available, just not discoverable.

### Fix Direction

In the plugin initialization flow (around `create-plugin-module.ts`), after MCP tools are registered by OpenCode, populate the `McpDeferredRegistry` with ALL MCP tool IDs and descriptions — not just OMO-native ones. Or make `discover_tools` query OpenCode's full MCP tool inventory at runtime via the SDK.

### Related

- Issue #4345 (upstream) — same root cause, different symptom (subagent tool availability vs main-agent discovery)
- `docs/implementation-plan-backlog-unblock.md` Item 1 — architectural plan for `discover_tools`
- Astrolabe issue #956 — external MCP tools (astrolabe) not discoverable by AI agents
