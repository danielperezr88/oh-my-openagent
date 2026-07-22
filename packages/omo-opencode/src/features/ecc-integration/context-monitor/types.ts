export interface ToolCallRecord {
  readonly tool: string
  readonly argsHash: string
  readonly timestamp: number
}

export interface LoopDetectionConfig {
  readonly windowSize: number
  readonly threshold: number
  readonly timeWindowMs: number
}

export const DEFAULT_LOOP_CONFIG: LoopDetectionConfig = {
  windowSize: 10,
  threshold: 3,
  timeWindowMs: 120000,
}

export interface ScopeDriftConfig {
  readonly maxMessagesTracked: number
  readonly driftThreshold: number
}

export const DEFAULT_DRIFT_CONFIG: ScopeDriftConfig = {
  maxMessagesTracked: 20,
  driftThreshold: 0.15,
}
