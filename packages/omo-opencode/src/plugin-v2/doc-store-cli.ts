import { spawn } from "node:child_process"
import { join } from "node:path"
import { homedir } from "node:os"

export const DEFAULT_DOC_STORE_CLI = join(homedir(), "doc-store", "src", "cli", "index.ts")

export interface DocStoreCliOptions {
  readonly cliPath?: string
  readonly sessionID?: string
}

function spawnDocStore(cliPath: string, args: string[], input: string | null, sessionID: string | undefined): Promise<string> {
  return new Promise((resolve, reject) => {
    const env: Record<string, string | undefined> = { ...process.env }
    if (sessionID) {
      env.OPENAGENT_SESSION_ID = sessionID
    }

    // No shell: on Windows cmd.exe concatenates args without quoting, so any
    // space-bearing argument (queries, file paths) splits into multiple argv
    // entries. bun resolves as a real executable, so a direct spawn is safe.
    const proc = spawn("bun", ["run", cliPath, "--json", ...args], {
      stdio: input === null ? ["ignore", "pipe", "pipe"] : ["pipe", "pipe", "pipe"],
      env,
    })

    if (!proc.stdout || !proc.stderr || (input !== null && !proc.stdin)) {
      proc.kill()
      reject(new Error("failed to open stdio pipes for doc-store CLI"))
      return
    }

    const stdout = proc.stdout
    const stderr = proc.stderr

    const chunks: Buffer[] = []
    const errChunks: Buffer[] = []

    stdout.on("data", (d: Buffer) => chunks.push(d))
    stderr.on("data", (d: Buffer) => errChunks.push(d))
    if (input !== null && proc.stdin) {
      proc.stdin.write(input)
      proc.stdin.end()
    }

    proc.on("close", (code) => {
      const stdout = Buffer.concat(chunks).toString("utf-8")
      const stderr = Buffer.concat(errChunks).toString("utf-8")
      if (code !== 0) {
        reject(new Error(stderr.trim() || stdout.trim() || `Exit code ${code}`))
      } else {
        resolve(stdout.trim())
      }
    })

    proc.on("error", (err) => reject(err))
  })
}

export async function runDocStore(args: string[], options: DocStoreCliOptions = {}): Promise<string> {
  return spawnDocStore(options.cliPath ?? DEFAULT_DOC_STORE_CLI, args, null, options.sessionID)
}

export async function runDocStoreWithInput(args: string[], input: string, options: DocStoreCliOptions = {}): Promise<string> {
  return spawnDocStore(options.cliPath ?? DEFAULT_DOC_STORE_CLI, args, input, options.sessionID)
}
