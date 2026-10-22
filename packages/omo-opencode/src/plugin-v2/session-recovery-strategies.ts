import type { RecoveryErrorType } from "../hooks/session-recovery/detect-error-type"
import { CANCELLED_TOOL_RESULT_TEXT, UNAVAILABLE_TOOL_RESULT_TEXT } from "./session-recovery-tool-results"

export interface ArmedRecovery {
  readonly stripMedia: boolean
  readonly toolResultText: string | null
}

export interface RecoveryAction {
  readonly armPatch: Partial<ArmedRecovery>
  readonly resumeText: string
}

const IMAGE_RESUME_TEXT =
  "[session recovery] The previous request failed because the active model only accepts text content. " +
  "Image attachments in the conversation history are now replaced with text placeholders in outgoing requests. " +
  "Continue the user's task from where it stopped, using text content only."

const TOOL_RESULT_RESUME_TEXT =
  "[session recovery] The previous request failed because a tool call in the conversation history has no matching tool result. " +
  "Cancelled tool results are now injected for those calls in outgoing requests. " +
  "Continue the user's task from where it stopped."

const UNAVAILABLE_TOOL_RESUME_TEXT =
  "[session recovery] The previous request failed because the model called a tool that is not available. " +
  "Tool results reporting the tool as unavailable are now injected for those calls in outgoing requests. " +
  "Continue the user's task without the unavailable tool."

export function emptyArmedRecovery(): ArmedRecovery {
  return { stripMedia: false, toolResultText: null }
}

export function mergeArmedRecovery(current: ArmedRecovery, patch: Partial<ArmedRecovery>): ArmedRecovery {
  return {
    stripMedia: current.stripMedia || patch.stripMedia === true,
    toolResultText: patch.toolResultText ?? current.toolResultText,
  }
}

export function resolveRecoveryAction(errorType: RecoveryErrorType): RecoveryAction | null {
  if (errorType === "image_content_invalid") {
    return { armPatch: { stripMedia: true }, resumeText: IMAGE_RESUME_TEXT }
  }
  if (errorType === "tool_result_missing") {
    return { armPatch: { toolResultText: CANCELLED_TOOL_RESULT_TEXT }, resumeText: TOOL_RESULT_RESUME_TEXT }
  }
  if (errorType === "unavailable_tool") {
    return { armPatch: { toolResultText: UNAVAILABLE_TOOL_RESULT_TEXT }, resumeText: UNAVAILABLE_TOOL_RESUME_TEXT }
  }
  return null
}
