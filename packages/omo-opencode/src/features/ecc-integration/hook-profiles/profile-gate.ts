import { log } from "../../../shared/logger"
import { DEFAULT_PROFILE, PROFILE_ORDER, VALID_PROFILES, type ProfileLevel } from "./types"

export function resolveProfile(
  envValue: string | undefined,
  configValue: string | undefined,
): ProfileLevel {
  const raw = envValue ?? configValue ?? DEFAULT_PROFILE
  if (VALID_PROFILES.includes(raw as ProfileLevel)) {
    return raw as ProfileLevel
  }
  log(`[hook-profiles] Invalid profile "${raw}", falling back to "${DEFAULT_PROFILE}"`)
  return DEFAULT_PROFILE
}

export function isHookEnabledByProfile(
  hookName: string,
  hookProfile: ProfileLevel,
  activeProfile: ProfileLevel,
): boolean {
  const required = PROFILE_ORDER[hookProfile]
  const active = PROFILE_ORDER[activeProfile]
  return active >= required
}
