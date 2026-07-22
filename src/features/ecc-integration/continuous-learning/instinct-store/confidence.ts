const DECAY_PER_WEEK = 0.02
const MIN_CONFIDENCE = 0.1
const MS_PER_WEEK = 7 * 24 * 60 * 60 * 1000

export function confidenceFromObservationCount(count: number): number {
  if (count <= 0) return 0
  if (count <= 2) return 0.3
  if (count <= 5) return 0.5
  if (count <= 10) return 0.7
  return 0.85
}

export function applyDecay(currentConfidence: number, lastConfirmed: string, now: Date = new Date()): number {
  const lastDate = new Date(lastConfirmed)
  const weeksSince = (now.getTime() - lastDate.getTime()) / MS_PER_WEEK
  if (weeksSince <= 0) return Math.max(currentConfidence, MIN_CONFIDENCE)

  const decayed = currentConfidence - weeksSince * DECAY_PER_WEEK
  return Math.max(decayed, MIN_CONFIDENCE)
}

export function shouldPromote(currentConfidence: number, newObservationCount: number): boolean {
  const newConfidence = confidenceFromObservationCount(newObservationCount)
  return newConfidence > currentConfidence + 0.1
}

export function shouldEvict(currentConfidence: number, minThreshold: number): boolean {
  return currentConfidence < minThreshold
}
