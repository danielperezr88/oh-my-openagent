import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync, unlinkSync } from "fs"
import { join } from "path"
import { homedir } from "os"
import type { Instinct, InstinctIndex } from "../types"
import { parseInstinctFile, serializeInstinct } from "./instinct-parser"
import { resolveProjectHash } from "./project-resolver"
import { applyDecay } from "./confidence"

const OMO_DIR = process.env.OMO_DIR ?? join(homedir(), ".omo")
const INSTINCTS_BASE = join(OMO_DIR, "instincts")

function getScopeDir(scope: "project" | "global", subdir: string): string {
  if (scope === "global") return join(INSTINCTS_BASE, "global", subdir)
  const hash = resolveProjectHash()
  return join(INSTINCTS_BASE, hash, subdir)
}

export function listInstincts(scope: "project" | "global" = "project"): Instinct[] {
  const dir = getScopeDir(scope, "personal")
  if (!existsSync(dir)) return []

  const instincts: Instinct[] = []
  for (const file of readdirSync(dir)) {
    if (!file.endsWith(".yaml") && !file.endsWith(".md")) continue
    try {
      const content = readFileSync(join(dir, file), "utf-8")
      const instinct = parseInstinctFile(content)
      if (instinct) instincts.push(applyDecayedConfidence(instinct))
    } catch {
      // Skip unreadable files
    }
  }
  return instincts
}

export function listAllInstincts(): Instinct[] {
  return [...listInstincts("project"), ...listInstincts("global")]
}

export function saveInstinct(instinct: Instinct): void {
  const dir = getScopeDir(instinct.scope, "personal")
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  const path = join(dir, `${instinct.id}.yaml`)
  writeFileSync(path, serializeInstinct(instinct), "utf-8")
}

export function deleteInstinct(id: string, scope: "project" | "global" = "project"): boolean {
  const dir = getScopeDir(scope, "personal")
  for (const ext of [".yaml", ".md"]) {
    const path = join(dir, `${id}${ext}`)
    if (existsSync(path)) {
      unlinkSync(path)
      return true
    }
  }
  return false
}

export function findInstinctById(id: string): Instinct | null {
  const all = listAllInstincts()
  return all.find((i) => i.id === id) ?? null
}

export function buildInstinctIndex(instincts: readonly Instinct[]): InstinctIndex {
  const byDomain: Record<string, Instinct[]> = {}
  const byTriggerKeyword = new Map<string, Instinct[]>()

  let totalProject = 0
  let totalGlobal = 0

  for (const instinct of instincts) {
    if (instinct.scope === "project") totalProject++
    else totalGlobal++

    if (!byDomain[instinct.domain]) byDomain[instinct.domain] = []
    byDomain[instinct.domain].push(instinct)

    for (const keyword of extractKeywords(instinct.trigger)) {
      const existing = byTriggerKeyword.get(keyword) ?? []
      existing.push(instinct)
      byTriggerKeyword.set(keyword, existing)
    }
  }

  return {
    instincts,
    byDomain,
    byTriggerKeyword,
    totalProject,
    totalGlobal,
  }
}

function applyDecayedConfidence(instinct: Instinct): Instinct {
  const decayed = applyDecay(instinct.confidence, instinct.lastConfirmed)
  if (decayed === instinct.confidence) return instinct
  return { ...instinct, confidence: decayed }
}

export function extractKeywords(text: string): string[] {
  const stopWords = new Set(["the", "a", "an", "when", "for", "and", "or", "to", "in", "of", "with", "is", "are"])
  return text
    .toLowerCase()
    .split(/[\s,.;]+/)
    .filter((w) => w.length > 2 && !stopWords.has(w))
}
