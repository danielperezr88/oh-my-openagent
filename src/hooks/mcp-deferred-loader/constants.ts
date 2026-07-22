export const DEFAULT_STUB_DESCRIPTION = "Deferred MCP tool. Use discover_tools(query) to search and unlock its schema."
export const MCP_TOOL_ID_PREFIX = "mcp__"
export const MCP_TOOL_ID_SEPARATOR = "__"

export const DEFAULT_MCP_DEFERRED_CONFIG = {
  enabled: true,
  always_load: [] as string[],
  stub_description: DEFAULT_STUB_DESCRIPTION,
} as const
