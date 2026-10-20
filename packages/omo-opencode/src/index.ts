import type { PluginModule } from "@opencode-ai/plugin"
import { createPluginModule } from "./testing/create-plugin-module"
import { createV2PluginDefinition } from "./plugin-v2"

const pluginModule: PluginModule = createPluginModule()

export const omoPlugin = pluginModule.server

// Dual-export entry: V2 hosts read id + setup(), V1 hosts call server().
// Documented pattern from the OpenCode V2 plugin migration guide.
const v2Definition = createV2PluginDefinition()

const dualExport: typeof v2Definition & Pick<PluginModule, "server"> = {
  ...v2Definition,
  server: pluginModule.server,
}

export default dualExport

export type {
  AgentName,
  AgentOverrideConfig,
  AgentOverrides,
  BuiltinCommandName,
  HookName,
  McpName,
  OhMyOpenCodeConfig,
} from "./config"

export type { ConfigLoadError } from "./shared/config-errors"
