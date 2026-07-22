import type { CreatedHooks } from "../create-hooks"

export function createToolDefinitionHandler(args: {
  hooks: CreatedHooks
}): (
  input: { toolID: string },
  output: { description: string; parameters: unknown },
) => Promise<void> {
  const { hooks } = args
  return async (input, output) => {
    await hooks.todoDescriptionOverride?.["tool.definition"]?.(input, output)
    await hooks.mcpDeferredLoader?.["tool.definition"]?.(input, output)
  }
}
