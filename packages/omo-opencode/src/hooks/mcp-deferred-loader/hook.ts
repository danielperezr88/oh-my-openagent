import type { Message, Part } from "@opencode-ai/sdk"
import { log } from "../../shared/logger"
import { McpDeferredRegistry } from "./registry"
import { DEFAULT_MCP_DEFERRED_CONFIG } from "./constants"
import { autoDiscoverFromMessage } from "../../tools/discover-tools/create-discover-tools"
import { getLocalToolEmbedder } from "../../features/local-embeddings"

export interface McpDeferredLoaderOptions {
  enabled?: boolean
  alwaysLoad?: string[]
  stubDescription?: string
  /** @deprecated Use local embeddings instead. Kept for backward compatibility. */
  semanticUrl?: string
}

type MessageWithParts = {
  info: Message
  parts: Part[]
}

type MessagesTransformOutput = { messages: MessageWithParts[] }

export function createMcpDeferredLoaderHook(
  registry: McpDeferredRegistry,
  options?: McpDeferredLoaderOptions,
) {
  const stubDescription = options?.stubDescription ?? DEFAULT_MCP_DEFERRED_CONFIG.stub_description
  let autoDiscoveryAttempted = false

  return {
    "tool.definition": async (
      input: { toolID: string },
      output: { description: string; parameters: unknown },
    ) => {
      if (!registry.isMcpTool(input.toolID)) return
      if (registry.isAlwaysLoaded(input.toolID)) return

      // Record the tool ID and description so discover_tools can find them.
      // This populates the registry dynamically from external MCP tools that
      // OpenCode discovers after plugin init (e.g., from .mcp.json, opencode.json).
      registry.recordToolID(input.toolID)
      registry.recordToolDescription(input.toolID, output.description)

      if (registry.isDiscovered(input.toolID)) return

      const originalDescription = output.description
      output.description = stubDescription
      output.parameters = { type: "object", properties: {} }

      log("[mcp-deferred-loader] Stubbed tool definition", {
        toolID: input.toolID,
        originalDescriptionLength: originalDescription.length,
      })
    },

    "experimental.chat.messages.transform": async (
      _input: Record<string, never>,
      output: MessagesTransformOutput,
    ) => {
      // Auto-discover relevant tools from the first user message
      if (!autoDiscoveryAttempted) {
        for (const msg of output.messages) {
          if (msg.info.role === "user") {
            const textParts = msg.parts.filter(
              (p): p is Part & { type: "text"; text: string } => p.type === "text",
            )
            if (textParts.length > 0 && textParts[0].text.length > 5) {
              autoDiscoveryAttempted = true
              const count = await autoDiscoverFromMessage(textParts[0].text, registry)
              if (count > 0) {
                log("[mcp-deferred-loader] Auto-discovered tools before model sees stubs", { count })
              }
            }
            break
          }
        }
      }

      const undiscovered = registry.getUndiscoveredTools()
      if (undiscovered.length === 0) return

      for (const msg of output.messages) {
        if (msg.info.role === "user") {
          const textParts = msg.parts.filter(
            (p): p is Part & { type: "text"; text: string } => p.type === "text",
          )
          if (textParts.length > 0) {
            const firstText = textParts[0]
            if (typeof firstText.text === "string" && !firstText.text.includes("<available-deferred-tools>")) {
              const toolList = undiscovered.join(", ")
              firstText.text =
                `<available-deferred-tools>\n${toolList}\nUse discover_tools(query) to search and unlock tool schemas.\n</available-deferred-tools>\n\n${firstText.text}`
            }
          }
          break
        }
      }
    },
  }
}
