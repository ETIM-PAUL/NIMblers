import type { Difficulty } from '../../server/paragraphs/service.ts'

/** Just the two Web Storage methods this module needs, so tests can inject a fake. */
export interface StorageLike {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

const STORAGE_KEY = 'typing-duel:personal-best'

type PersonalBests = Partial<Record<Difficulty, number>>

function readAll(storage: StorageLike): PersonalBests {
  try {
    const raw = storage.getItem(STORAGE_KEY)
    if (!raw) return {}
    const parsed: unknown = JSON.parse(raw)
    return typeof parsed === 'object' && parsed !== null ? (parsed as PersonalBests) : {}
  }
  catch {
    return {}
  }
}

function writeAll(storage: StorageLike, bests: PersonalBests): void {
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(bests))
  }
  catch {
    // Storage unavailable, full, or blocked (private browsing, restricted
    // webview) — personal best is a nice-to-have, not worth crashing over.
  }
}

export function getPersonalBest(storage: StorageLike, difficulty: Difficulty): number | null {
  return readAll(storage)[difficulty] ?? null
}

export interface RecordResultOutcome {
  best: number
  isNewBest: boolean
}

/** Records a completed run's duration, keeping only the fastest per difficulty. */
export function recordResult(storage: StorageLike, difficulty: Difficulty, durationMs: number): RecordResultOutcome {
  const bests = readAll(storage)
  const current = bests[difficulty]

  if (current === undefined || durationMs < current) {
    writeAll(storage, { ...bests, [difficulty]: durationMs })
    return { best: durationMs, isNewBest: true }
  }
  return { best: current, isNewBest: false }
}
