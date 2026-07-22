import type { LoopDetectionConfig, ToolCallRecord } from "./types"

function hashArgs(args: Record<string, unknown>): string {
  const filePath = args.filePath ?? args.path ?? args.file_path ?? args.file ?? args.pattern ?? ""
  const tool = args.tool ?? ""
  return `${tool}:${filePath}`
}

export function detectToolLoop(
  records: readonly ToolCallRecord[],
  config: LoopDetectionConfig,
): { detected: boolean; tool?: string; count: number } {
  if (records.length < config.threshold) return { detected: false, count: 0 }

  const now = Date.now()
  const recent = records.filter((r) => now - r.timestamp < config.timeWindowMs)
  if (recent.length < config.threshold) return { detected: false, count: 0 }

  const counts = new Map<string, number>()
  for (const record of recent) {
    const key = `${record.tool}:${record.argsHash}`
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }

  for (const [key, count] of counts) {
    if (count >= config.threshold) {
      const [tool] = key.split(":")
      return { detected: true, tool, count }
    }
  }

  return { detected: false, count: 0 }
}

export function createToolCallRecord(
  tool: string,
  args: Record<string, unknown>,
): ToolCallRecord {
  return {
    tool,
    argsHash: hashArgs(args),
    timestamp: Date.now(),
  }
}
