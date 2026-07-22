export type ProfileLevel = "minimal" | "standard" | "strict"

export const PROFILE_ORDER: Record<ProfileLevel, number> = {
  minimal: 0,
  standard: 1,
  strict: 2,
}

export const DEFAULT_PROFILE: ProfileLevel = "standard"

export const VALID_PROFILES: readonly ProfileLevel[] = ["minimal", "standard", "strict"] as const
