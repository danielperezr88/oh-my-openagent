import { mkdirSync, existsSync, appendFileSync, statSync, renameSync, readdirSync, readFileSync, writeFileSync, unlinkSync } from "fs"
import { join, dirname } from "path"
import { homedir } from "os"
import type { Observation } from "../types"

const OMO_DIR = process.env.OMO_DIR ?? join(homedir(), ".omo")
const OBSERVATIONS_DIR = join(OMO_DIR, "observations")
const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024

export function getProjectObservationsDir(projectHash: string): string {
  return join(OBSERVATIONS_DIR, projectHash)
}

export function getObservationsPath(projectHash: string): string {
  return join(getProjectObservationsDir(projectHash), "observations.jsonl")
}

export function getPatternsPath(projectHash: string): string {
  return join(getProjectObservationsDir(projectHash), "patterns.json")
}

export function appendObservation(projectHash: string, observation: Observation): void {
  const filePath = getObservationsPath(projectHash)
  const dir = dirname(filePath)
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
  }

  if (existsSync(filePath)) {
    const stats = statSync(filePath)
    if (stats.size >= MAX_FILE_SIZE_BYTES) {
      rotateObservations(projectHash)
    }
  }

  appendFileSync(filePath, JSON.stringify(observation) + "\n", "utf-8")
}

function rotateObservations(projectHash: string): void {
  const dir = getProjectObservationsDir(projectHash)
  const archiveDir = join(dir, "archive")
  if (!existsSync(archiveDir)) {
    mkdirSync(archiveDir, { recursive: true })
  }

  const currentPath = getObservationsPath(projectHash)
  if (!existsSync(currentPath)) return

  const timestamp = new Date().toISOString().replace(/[:.]/g, "-")
  const rotatedPath = join(archiveDir, `observations-${timestamp}.jsonl`)
  renameSync(currentPath, rotatedPath)

  pruneOldArchives(archiveDir)
}

function pruneOldArchives(archiveDir: string): void {
  const files = readdirSync(archiveDir)
    .filter((f) => f.endsWith(".jsonl"))
    .map((f) => ({ name: f, path: join(archiveDir, f), mtime: statSync(join(archiveDir, f)).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime)

  const MAX_ARCHIVE_FILES = 5
  for (const file of files.slice(MAX_ARCHIVE_FILES)) {
    try {
      unlinkSync(file.path)
    } catch {
      // Best-effort cleanup
    }
  }
}

export function purgeOldObservations(projectHash: string, retentionDays: number): void {
  const filePath = getObservationsPath(projectHash)
  if (!existsSync(filePath)) return

  const cutoff = Date.now() - retentionDays * 24 * 60 * 60 * 1000
  const lines = readFileSync(filePath, "utf-8").split("\n").filter((l) => l.trim())

  const kept = lines.filter((line) => {
    try {
      const obs = JSON.parse(line) as Observation
      return new Date(obs.timestamp).getTime() >= cutoff
    } catch {
      return false
    }
  })

  if (kept.length < lines.length) {
    writeFileSync(filePath, kept.join("\n") + "\n", "utf-8")
  }
}

export function readObservationTail(projectHash: string, maxLines: number): Observation[] {
  const filePath = getObservationsPath(projectHash)
  if (!existsSync(filePath)) return []

  const content = readFileSync(filePath, "utf-8")
  const lines = content.split("\n").filter((l) => l.trim())
  const tail = lines.slice(-maxLines)

  const observations: Observation[] = []
  for (const line of tail) {
    try {
      observations.push(JSON.parse(line) as Observation)
    } catch {
      // Skip malformed lines
    }
  }
  return observations
}

export function countObservations(projectHash: string): number {
  const filePath = getObservationsPath(projectHash)
  if (!existsSync(filePath)) return 0

  const content = readFileSync(filePath, "utf-8")
  return content.split("\n").filter((l) => l.trim()).length
}
