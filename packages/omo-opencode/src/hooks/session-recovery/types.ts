export type {
  StoredMessageMeta,
  StoredTextPart,
  StoredToolPart,
  StoredReasoningPart,
  StoredStepPart,
  StoredPart,
  MessageData,
} from "../anthropic-context-window-limit-recovery/storage/types"

export type ContentPartType = "text" | "tool" | "tool_use" | "tool_result"

export interface ResumeConfig {
  sessionID: string
  agent?: string
  model?: {
    providerID: string
    modelID: string
    variant?: string
  }
  tools?: Record<string, boolean>
}
