export type PipelineStage =
  | "experimental.chat.messages.transform"
  | "event"
  | "tool.execute.after"
  | "tool.definition"

export type DispatchEntry<H = unknown> = { name: string; handler: H }

export class DispatchRegistry {
  private readonly entries = new Map<PipelineStage, DispatchEntry[]>()

  register<H>(stage: PipelineStage, name: string, handler: H): void {
    if (!this.entries.has(stage)) {
      this.entries.set(stage, [])
    }
    this.entries.get(stage)!.push({ name, handler })
  }

  getHandlers<H>(stage: PipelineStage): Array<{ name: string; handler: H }> {
    return (this.entries.get(stage) ?? []) as Array<{ name: string; handler: H }>
  }
}

export function createDispatchRegistry(): DispatchRegistry {
  return new DispatchRegistry()
}
