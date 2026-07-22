/**
 * Doc-Store Explorer Server
 *
 * Generates data from the codebase, bundles the Remotion UI,
 * serves it at http://localhost:3210, and executes doc-store
 * tools on demand so the UI can drive the state machines live.
 */
import { spawn } from "node:child_process"
import { join } from "node:path"
import { homedir } from "node:os"
import { existsSync, readFileSync } from "node:fs"
import { generateExplorerData } from "./generate-data"

const PORT = 3210
const EXPLORER_DIR = import.meta.dir
const UI_DIR = join(EXPLORER_DIR, "ui")
const DOC_STORE_CLI = join(homedir(), "doc-store", "src", "cli", "index.ts")

// ─── Execution history ───────────────────────────────────────────────

interface ExecutionEntry {
  id: string
  tool: string
  args: Record<string, string>
  timestamp: string
  status: "success" | "error"
  result: string
  durationMs: number
  fromState?: string
  toState?: string
}

const executionHistory: ExecutionEntry[] = []
let execCounter = 0

// ─── Doc-Store CLI execution ─────────────────────────────────────────

function runDocStore(args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const proc = spawn("bun", ["run", DOC_STORE_CLI, "--json", ...args], {
      stdio: ["ignore", "pipe", "pipe"],
      shell: true,
      env: { ...process.env, OPENAGENT_SESSION_ID: "explorer-ui" },
    })

    const chunks: Buffer[] = []
    const errChunks: Buffer[] = []

    proc.stdout.on("data", (d: Buffer) => chunks.push(d))
    proc.stderr.on("data", (d: Buffer) => errChunks.push(d))

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

function runDocStoreWithInput(args: string[], input: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const proc = spawn("bun", ["run", DOC_STORE_CLI, "--json", ...args], {
      stdio: ["pipe", "pipe", "pipe"],
      shell: true,
      env: { ...process.env, OPENAGENT_SESSION_ID: "explorer-ui" },
    })

    const chunks: Buffer[] = []
    const errChunks: Buffer[] = []

    proc.stdout.on("data", (d: Buffer) => chunks.push(d))
    proc.stderr.on("data", (d: Buffer) => errChunks.push(d))

    proc.stdin.write(input)
    proc.stdin.end()

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

// ─── Tool → CLI arg mapping ──────────────────────────────────────────

function buildCliArgs(tool: string, args: Record<string, string>): string[] {
  switch (tool) {
    case "doc_store_status": {
      const a = ["status"]
      if (args.vault) a.push(args.vault)
      return a
    }
    case "doc_store_ingest":
      return ["ingest", args.vault, args.path,
        ...(args.tags ? ["--tags", args.tags] : []),
        ...(args.categories ? ["--categories", args.categories] : []),
      ]
    case "doc_store_consolidate_prepare":
      return ["consolidate-prepare", args.vault, "--doc-id", args.doc_id]
    case "doc_store_consolidate_store":
      return ["consolidate-store", args.vault, "--doc-id", args.doc_id, "--job-id", args.job_id]
    case "doc_store_consolidate_list":
      return ["consolidate-list", args.vault]
    case "doc_store_search": {
      const a = ["search", args.vault, args.query]
      if (args.top) a.push("--top", args.top)
      return a
    }
    case "doc_store_query":
      return ["query", args.vault, args.question]
    case "doc_store_lint":
      return ["lint", args.vault]
    case "doc_store_maintain":
      return ["maintain", args.vault]
    default:
      throw new Error(`Unknown tool: ${tool}`)
  }
}

// Tools that need stdin for JSON payload
const STDIN_TOOLS = new Set(["doc_store_consolidate_store"])

// ─── State machine transition mapping ────────────────────────────────

function getStateTransition(tool: string, result: string): { from?: string; to?: string } {
  // Consolidation pipeline transitions
  if (tool === "doc_store_consolidate_list") {
    return { from: "pending", to: "discovered" }
  }
  if (tool === "doc_store_consolidate_prepare") {
    return { from: "discovered", to: "awaiting_agent" }
  }
  if (tool === "doc_store_consolidate_store") {
    try {
      const parsed = JSON.parse(result)
      if (parsed.status === "success") {
        return { from: "awaiting_agent", to: "consolidated" }
      }
      return { from: "awaiting_agent", to: "validation_error" }
    } catch {
      return { from: "awaiting_agent", to: "consolidated" }
    }
  }
  // Agent lifecycle transitions
  if (tool === "doc_store_search" || tool === "doc_store_query") {
    return { from: "start", to: "check_existing" }
  }
  if (tool === "doc_store_ingest") {
    return { from: "primary_work", to: "ingest_sources" }
  }
  return {}
}

// ─── Execute a tool ──────────────────────────────────────────────────

async function executeTool(tool: string, args: Record<string, string>): Promise<ExecutionEntry> {
  const id = `exec-${++execCounter}`
  const start = Date.now()

  try {
    const cliArgs = buildCliArgs(tool, args)
    let result: string

    if (STDIN_TOOLS.has(tool) && args.result_json) {
      result = await runDocStoreWithInput(cliArgs, args.result_json)
    } else {
      result = await runDocStore(cliArgs)
    }

    const durationMs = Date.now() - start
    const transition = getStateTransition(tool, result)

    const entry: ExecutionEntry = {
      id,
      tool,
      args,
      timestamp: new Date().toISOString(),
      status: "success",
      result,
      durationMs,
      ...transition,
    }

    executionHistory.unshift(entry)
    console.log(`  [exec] ${tool} -> ${entry.status} (${durationMs}ms)${transition.to ? ` state: ${transition.from} -> ${transition.to}` : ""}`)
    return entry
  } catch (err: any) {
    const durationMs = Date.now() - start
    const entry: ExecutionEntry = {
      id,
      tool,
      args,
      timestamp: new Date().toISOString(),
      status: "error",
      result: err?.message || String(err),
      durationMs,
    }

    executionHistory.unshift(entry)
    console.log(`  [exec] ${tool} -> error: ${entry.result.slice(0, 80)} (${durationMs}ms)`)
    return entry
  }
}

// ─── Bundle cache ────────────────────────────────────────────────────

let cachedJs: string | null = null

async function buildBundle(): Promise<string> {
  if (cachedJs) return cachedJs

  const entryPoint = join(UI_DIR, "index.tsx")

  if (!existsSync(entryPoint)) {
    throw new Error(`UI entry point not found: ${entryPoint}`)
  }

  const buildResult = await Bun.build({
    entrypoints: [entryPoint],
    outdir: join(EXPLORER_DIR, ".bundle"),
    target: "browser",
    format: "esm",
    minify: true,
    define: {
      "process.env.NODE_ENV": JSON.stringify("production"),
    },
    external: [],
  })

  if (!buildResult.success) {
    console.error("Build failed:", buildResult.logs)
    throw new Error("Build failed: " + buildResult.logs.map((l) => l.message).join(", "))
  }

  const jsFile = buildResult.outputs[0]
  cachedJs = readFileSync(jsFile.path, "utf-8")
  return cachedJs
}

const HTML = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Doc-Store Explorer</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { background: #0a0a0f; overflow: hidden; }
    #root { width: 100vw; height: 100vh; }
  </style>
</head>
<body>
  <div id="root"></div>
  <script type="module" src="/bundle.js"></script>
</body>
</html>`

// ─── Server ──────────────────────────────────────────────────────────

const server = Bun.serve({
  port: PORT,
  async fetch(req) {
    const url = new URL(req.url)

    // CORS for local dev
    const corsHeaders = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    }

    if (req.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders })
    }

    // API: Data
    if (url.pathname === "/api/data") {
      const data = generateExplorerData()
      return new Response(JSON.stringify(data), {
        headers: { "Content-Type": "application/json", ...corsHeaders },
      })
    }

    // API: Refresh data + rebuild
    if (url.pathname === "/api/refresh") {
      cachedJs = null
      return new Response(JSON.stringify({ ok: true }), {
        headers: { "Content-Type": "application/json", ...corsHeaders },
      })
    }

    // API: Execute a tool
    if (url.pathname === "/api/execute" && req.method === "POST") {
      try {
        const body = (await req.json()) as { tool: string; args: Record<string, string> }
        if (!body.tool) {
          return new Response(JSON.stringify({ error: "Missing 'tool' field" }), {
            status: 400,
            headers: { "Content-Type": "application/json", ...corsHeaders },
          })
        }
        const entry = await executeTool(body.tool, body.args || {})
        return new Response(JSON.stringify(entry), {
          headers: { "Content-Type": "application/json", ...corsHeaders },
        })
      } catch (err: any) {
        return new Response(JSON.stringify({ error: err?.message || String(err) }), {
          status: 500,
          headers: { "Content-Type": "application/json", ...corsHeaders },
        })
      }
    }

    // API: Execution history
    if (url.pathname === "/api/history") {
      return new Response(JSON.stringify(executionHistory.slice(0, 50)), {
        headers: { "Content-Type": "application/json", ...corsHeaders },
      })
    }

    // API: Clear history
    if (url.pathname === "/api/history/clear" && req.method === "POST") {
      executionHistory.length = 0
      return new Response(JSON.stringify({ ok: true }), {
        headers: { "Content-Type": "application/json", ...corsHeaders },
      })
    }

    // Serve JS bundle
    if (url.pathname === "/bundle.js") {
      try {
        const js = await buildBundle()
        return new Response(js, {
          headers: { "Content-Type": "application/javascript", ...corsHeaders },
        })
      } catch (err: any) {
        return new Response(`console.error("Build failed:", ${JSON.stringify(err?.message || err)})`, {
          status: 500,
          headers: { "Content-Type": "application/javascript" },
        })
      }
    }

    // Serve the HTML page
    if (url.pathname === "/" || url.pathname === "/index.html") {
      return new Response(HTML, {
        headers: { "Content-Type": "text/html" },
      })
    }

    return new Response("Not found", { status: 404 })
  },
})

console.log(`\n  Doc-Store Explorer running at http://localhost:${PORT}\n`)
console.log(`  Endpoints:`)
console.log(`    GET  /            - UI`)
console.log(`    GET  /api/data    - Explorer data JSON`)
console.log(`    POST /api/execute - Execute a tool: { tool, args }`)
console.log(`    GET  /api/history - Execution history`)
console.log(`\n  Press Ctrl+C to stop\n`)
