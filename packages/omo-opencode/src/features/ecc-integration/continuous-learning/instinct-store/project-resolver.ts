import { execSync } from "child_process"
import { createHash } from "crypto"

let cachedHash: string | null = null

/**
 * Resolve a project identifier from the git remote URL.
 * Falls back to a hash of the current working directory when not in a git repo.
 * The same repo cloned on different machines produces the same hash.
 */
export function resolveProjectHash(): string {
  if (cachedHash !== null) return cachedHash

  try {
    const remoteUrl = execSync("git remote get-url origin", {
      encoding: "utf-8",
      timeout: 3000,
      stdio: ["pipe", "pipe", "pipe"],
    }).trim()

    if (remoteUrl) {
      const normalized = remoteUrl
        .replace(/\.git$/, "")
        .replace(/^https?:\/\/[^/]+\//, "")
        .replace(/^git@[^:]+:/, "")

      cachedHash = createHash("sha256").update(normalized).digest("hex").slice(0, 12)
      return cachedHash
    }
  } catch {
  }

  cachedHash = createHash("sha256").update(process.cwd()).digest("hex").slice(0, 12)
  return cachedHash
}

export function clearProjectHashCache(): void {
  cachedHash = null
}
