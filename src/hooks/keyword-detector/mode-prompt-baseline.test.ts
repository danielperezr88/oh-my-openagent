import { describe, expect, test } from "bun:test"
import { createHash } from "node:crypto"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { ANALYZE_MESSAGE, HYPERPLAN_MESSAGE, SEARCH_MESSAGE, TEAM_MESSAGE } from "./constants"

type PromptBaseline = {
  readonly name: string
  readonly message: string
  readonly sha256: string
  readonly byteLength: number
}

type ShimBaseline = {
  readonly name: string
  readonly filePath: string
}

const MODE_PROMPT_BASELINES: readonly PromptBaseline[] = [
  {
    name: "search",
    message: SEARCH_MESSAGE,
    sha256: "1bac446cca412182c4ddee143038952426b03ea60d727f8a4e025d4d0405edaf",
    byteLength: 317,
  },
  {
    name: "analyze",
    message: ANALYZE_MESSAGE,
    sha256: "d6549369964eed6938dba116686d1f6b4ea745c8fa0ea564dce1742a283e5a95",
    byteLength: 881,
  },
  {
    name: "team",
    message: TEAM_MESSAGE,
    sha256: "f93c457ded32f94da2860a7a847fe7fa7d6fe2e465742fdcdb006695f62e9bda",
    byteLength: 616,
  },
  {
    name: "hyperplan",
    message: HYPERPLAN_MESSAGE,
    sha256: "7b6fc1db3852642467551d87687e9cf14a2c46a39d474eb66005b512d4315792",
    byteLength: 1525,
  },
]

const KEYWORD_DETECTOR_DIR = dirname(fileURLToPath(import.meta.url))

const MODE_SHIMS: readonly ShimBaseline[] = [
  { name: "search", filePath: join(KEYWORD_DETECTOR_DIR, "search", "default.ts") },
  { name: "analyze", filePath: join(KEYWORD_DETECTOR_DIR, "analyze", "default.ts") },
  { name: "team", filePath: join(KEYWORD_DETECTOR_DIR, "team", "default.ts") },
  { name: "hyperplan", filePath: join(KEYWORD_DETECTOR_DIR, "hyperplan", "default.ts") },
]

describe("keyword-detector mode prompt baselines", () => {
  test("#given captured prompt baselines #then each mode message keeps the same bytes", () => {
    for (const baseline of MODE_PROMPT_BASELINES) {
      expect(hashPrompt(baseline.message), baseline.name).toBe(baseline.sha256)
      expect(Buffer.byteLength(baseline.message, "utf8"), baseline.name).toBe(baseline.byteLength)
    }
  })

  test("#given migrated mode shims #then each shim stays within the LOC ceiling", async () => {
    for (const shim of MODE_SHIMS) {
      const source = await Bun.file(shim.filePath).text()

      expect(countPureLoc(source), shim.name).toBeLessThanOrEqual(20)
    }
  })
})

function hashPrompt(prompt: string): string {
  return createHash("sha256").update(prompt, "utf8").digest("hex")
}

function countPureLoc(source: string): number {
  let pureLoc = 0
  let insideBlockComment = false

  for (const rawLine of source.split("\n")) {
    const line = rawLine.trim()
    if (line.length === 0) continue
    if (insideBlockComment) {
      insideBlockComment = !line.includes("*/")
      continue
    }
    if (line.startsWith("/*")) {
      insideBlockComment = !line.includes("*/")
      continue
    }
    if (line.startsWith("//")) continue
    pureLoc += 1
  }

  return pureLoc
}
