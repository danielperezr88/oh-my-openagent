import { execSync, type ExecSyncOptionsWithStringEncoding } from "child_process"
import { createHash } from "crypto"

function hashOf(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 12)
}

function normalizeRemote(remoteUrl: string): string {
  return remoteUrl
    .replace(/\.git$/, "")
    .replace(/^https?:\/\/[^/]+\//, "")
    .replace(/^git@[^:]+:/, "")
}

function readRemoteUrl(directory: string): string | null {
  const execOptions: ExecSyncOptionsWithStringEncoding = {
    encoding: "utf-8",
    timeout: 3000,
    cwd: directory,
    stdio: ["pipe", "pipe", "pipe"],
  }
  try {
    const remotes = execSync("git remote", execOptions)
      .split("\n")
      .map((name) => name.trim())
      .filter(Boolean)
    const preferred = remotes.find((name) => name === "origin") ?? remotes[0]
    if (!preferred) return null
    const url = execSync(`git remote get-url ${preferred}`, execOptions).trim()
    return url || null
  } catch {
    return null
  }
}

/**
 * Dir-aware variant of instinct-store/project-resolver's resolveProjectHash().
 * The V2 background service hosts multiple projects in one process, so
 * process.cwd() cannot identify the location; the plugin resolves per
 * ctx.location.directory instead. Prefers origin, then the first remote.
 */
export function resolveProjectHashForDirectory(directory: string): string {
  const remote = readRemoteUrl(directory)
  if (remote) return hashOf(normalizeRemote(remote))
  return hashOf(directory)
}
