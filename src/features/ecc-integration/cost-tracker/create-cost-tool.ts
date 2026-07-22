import { tool, type ToolDefinition } from "@opencode-ai/plugin"
import { getAccumulatedCost, getSessionTotal } from "./tracker"
import { listKnownModels } from "./pricing-table"

function formatCost(amount: number): string {
  if (amount < 0.01) return `$${amount.toFixed(6)}`
  if (amount < 1) return `$${amount.toFixed(4)}`
  return `$${amount.toFixed(2)}`
}

export function createSessionCostTool(): ToolDefinition {
  return tool({
    description:
      "Report token usage and estimated cost for the current session or accumulated across all sessions. " +
      "Use to track spending and budget. Estimates are based on model pricing tables.",
    args: {
      scope: tool.schema
        .string()
        .optional()
        .describe('"session" for current session costs, "total" for accumulated costs across all sessions. Defaults to "session".'),
    },
    async execute(args: { scope?: string }) {
      if (args.scope === "total") {
        const total = getAccumulatedCost()
        const modelBreakdown = Object.entries(total.byModel)
          .map(([model, data]) => `  ${model}: ${data.input.toLocaleString()} in / ${data.output.toLocaleString()} out = ${formatCost(data.cost)}`)
          .join("\n")

        return [
          `Accumulated Cost (${total.sessions} session(s))`,
          `Total input tokens: ${total.totalInputTokens.toLocaleString()}`,
          `Total output tokens: ${total.totalOutputTokens.toLocaleString()}`,
          `Total estimated cost: ${formatCost(total.totalEstimatedCost)}`,
          "",
          "By model:",
          modelBreakdown || "  (no data yet)",
          "",
          `Known models in pricing table: ${listKnownModels().join(", ")}`,
        ].join("\n")
      }

      const sessionID = process.env.OPENAGENT_SESSION_ID ?? "current"
      const session = getSessionTotal(sessionID)
      return [
        `Session Cost (${sessionID})`,
        `Input tokens: ${session.inputTokens.toLocaleString()}`,
        `Output tokens: ${session.outputTokens.toLocaleString()}`,
        `Estimated cost: ${formatCost(session.estimatedCost)}`,
      ].join("\n")
    },
  })
}
