import { MCP_TOOL_ID_PREFIX, MCP_TOOL_ID_SEPARATOR } from "./constants"

export class McpDeferredRegistry {
  private readonly discovered = new Set<string>()
  private readonly alwaysLoadServers: Set<string>
  private allMcpToolIDs: string[] = []
  private toolDescriptions = new Map<string, string>()

  constructor(alwaysLoadServers: string[] = []) {
    this.alwaysLoadServers = new Set(alwaysLoadServers)
  }

  isMcpTool(toolID: string): boolean {
    return toolID.startsWith(MCP_TOOL_ID_PREFIX)
  }

  getServerName(toolID: string): string | undefined {
    if (!this.isMcpTool(toolID)) return undefined
    const parts = toolID.split(MCP_TOOL_ID_SEPARATOR)
    if (parts.length < 3) return undefined
    return parts[1]
  }

  isAlwaysLoaded(toolID: string): boolean {
    const serverName = this.getServerName(toolID)
    if (!serverName) return false
    return this.alwaysLoadServers.has(serverName)
  }

  isDiscovered(toolID: string): boolean {
    return this.discovered.has(toolID)
  }

  markDiscovered(toolIDs: string[]): void {
    for (const id of toolIDs) {
      this.discovered.add(id)
    }
  }

  setAllMcpToolIDs(ids: string[]): void {
    this.allMcpToolIDs = ids
  }

  /**
   * Record a single MCP tool ID at runtime.
   * Idempotent — ignores duplicates.
   * Use when tool IDs are discovered dynamically (e.g., via tool.definition hook)
   * rather than known at init time.
   */
  recordToolID(toolID: string): void {
    if (!this.allMcpToolIDs.includes(toolID)) {
      this.allMcpToolIDs.push(toolID)
    }
  }

  /** Store tool descriptions for semantic search */
  setToolDescriptions(descriptions: Map<string, string>): void {
    this.toolDescriptions = new Map(descriptions)
  }

  /**
   * Record a single tool description at runtime.
   * Use alongside recordToolID() for dynamic tool discovery.
   */
  recordToolDescription(toolID: string, description: string): void {
    this.toolDescriptions.set(toolID, description)
  }

  /** Get stored tool description */
  getToolDescription(toolID: string): string | undefined {
    return this.toolDescriptions.get(toolID)
  }

  /** Get all stored tool descriptions */
  getAllToolDescriptions(): Map<string, string> {
    return new Map(this.toolDescriptions)
  }

  getUndiscoveredTools(): string[] {
    return this.allMcpToolIDs.filter(id => !this.discovered.has(id) && !this.isAlwaysLoaded(id))
  }

  clear(): void {
    this.discovered.clear()
  }
}
