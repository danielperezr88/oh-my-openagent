import { describe, expect, test } from "bun:test"
import { existsSync } from "node:fs"
import { join } from "node:path"

const SRC = import.meta.dir

describe("merge-survival: custom features exist after v4.19.1 merge", () => {
  test("ECC integration feature directory exists", () => {
    expect(existsSync(join(SRC, "features/ecc-integration/index.ts"))).toBe(true)
  })

  test("continuous learning instinct store exists", () => {
    expect(existsSync(join(SRC, "features/ecc-integration/continuous-learning/instinct-store/storage.ts"))).toBe(true)
  })

  test("context monitor hook exists", () => {
    expect(existsSync(join(SRC, "features/ecc-integration/context-monitor/hook.ts"))).toBe(true)
  })

  test("cost tracker hook exists", () => {
    expect(existsSync(join(SRC, "features/ecc-integration/cost-tracker/hook.ts"))).toBe(true)
  })

  test("security scanner exists", () => {
    expect(existsSync(join(SRC, "features/ecc-integration/security-scanner/scanner.ts"))).toBe(true)
  })

  test("stack detector exists", () => {
    expect(existsSync(join(SRC, "features/ecc-integration/stack-detector/detector.ts"))).toBe(true)
  })

  test("local embeddings feature exists", () => {
    expect(existsSync(join(SRC, "features/local-embeddings/index.ts"))).toBe(true)
  })

  test("telemetry subsystem exists", () => {
    expect(existsSync(join(SRC, "telemetry/index.ts"))).toBe(true)
  })

  test("doc-store tools exist", () => {
    expect(existsSync(join(SRC, "tools/doc-store/tools.ts"))).toBe(true)
  })

  test("discover-tools feature exists", () => {
    expect(existsSync(join(SRC, "tools/discover-tools/create-discover-tools.ts"))).toBe(true)
  })

  test("astrolabe MCP config exists", () => {
    expect(existsSync(join(SRC, "mcp/astrolabe.ts"))).toBe(true)
  })

  test("checkpoint-undo hook exists", () => {
    expect(existsSync(join(SRC, "hooks/checkpoint-undo/hook.ts"))).toBe(true)
  })

  test("transcript-archival hook exists", () => {
    expect(existsSync(join(SRC, "hooks/transcript-archival/hook.ts"))).toBe(true)
  })

  test("mcp-deferred-loader hook exists", () => {
    expect(existsSync(join(SRC, "hooks/mcp-deferred-loader/hook.ts"))).toBe(true)
  })

  test("dispatch-registry exists", () => {
    expect(existsSync(join(SRC, "plugin/dispatch-registry.ts"))).toBe(true)
  })

  test("register-dispatch-hooks exists", () => {
    expect(existsSync(join(SRC, "plugin/register-dispatch-hooks.ts"))).toBe(true)
  })
})

describe("merge-survival: converged features removed", () => {
  test("native LSP tools directory does NOT exist (converged to upstream MCP)", () => {
    expect(existsSync(join(SRC, "tools/lsp"))).toBe(false)
  })

  test("native ast-grep tools directory does NOT exist (converged to upstream skill)", () => {
    expect(existsSync(join(SRC, "tools/ast-grep"))).toBe(false)
  })

  test("root src/ directory does NOT exist (converged to packages/omo-opencode/src/)", () => {
    const rootSrc = join(import.meta.dir, "..", "..", "..", "..", "..", "src")
    expect(existsSync(rootSrc)).toBe(false)
  })
})