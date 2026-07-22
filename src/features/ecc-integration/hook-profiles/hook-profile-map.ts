import { DEFAULT_PROFILE, type ProfileLevel } from "./types"

const HOOK_PROFILE_MAP: Record<string, ProfileLevel> = {
  "fact-force-gate": "strict",
  "config-protection": "strict",
  "post-edit-diagnostics": "strict",
  "env-injector": "standard",
  "context-monitor": "standard",
  "cost-tracker": "standard",
  "continuous-learning-observe": "standard",
  "continuous-learning-consolidate": "standard",
  "continuous-learning-inject": "standard",
  "comment-checker": "standard",
  "rules-injector": "standard",
  "hashline-read-enhancer": "standard",
  "todo-description-override": "standard",
  "webfetch-redirect-guard": "standard",
  "write-existing-file-guard": "standard",
  "bash-file-read-guard": "standard",
  "read-image-resizer": "standard",
  "identity-reinjection": "standard",
  "path-scoped-rules": "standard",
  "checkpoint-undo": "standard",
  "background-result-injection": "standard",
  "mcp-deferred-loader": "standard",
  "edit-error-recovery": "standard",
  "json-error-recovery": "standard",
  "transcript-archival": "minimal",
  "auto-update-checker": "minimal",
  "startup-toast": "minimal",
  "legacy-plugin-toast": "minimal",
}

export function getHookProfile(hookName: string): ProfileLevel {
  return HOOK_PROFILE_MAP[hookName] ?? DEFAULT_PROFILE
}
