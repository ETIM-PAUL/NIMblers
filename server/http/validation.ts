import type { Difficulty, EntryVisibility } from '../db/types.ts'

export interface RawEvent {
  key: string
  tRelativeMs: number
  resultingLength: number
}

function isRawEvent(value: unknown): value is RawEvent {
  if (typeof value !== 'object' || value === null) return false
  const v = value as Record<string, unknown>
  return typeof v.key === 'string' && typeof v.tRelativeMs === 'number' && typeof v.resultingLength === 'number'
}

/** Parses the client-submitted keystroke event array shape (not its validity — that's validateRun's job). */
export function parseEvents(value: unknown): RawEvent[] | null {
  if (!Array.isArray(value)) return null
  return value.every(isRawEvent) ? value : null
}

export function parseStakeBody(body: unknown): { nimAddress: string, stakeTxHash: string } | null {
  if (typeof body !== 'object' || body === null) return null
  const v = body as Record<string, unknown>
  if (typeof v.nimAddress !== 'string' || typeof v.stakeTxHash !== 'string') return null
  return { nimAddress: v.nimAddress, stakeTxHash: v.stakeTxHash }
}

export function isDifficulty(value: unknown): value is Difficulty {
  return value === 'easy' || value === 'medium' || value === 'hard'
}

/** Optional — undefined means "not specified" (createEntry defaults that to PUBLIC), not invalid. */
export function isVisibilityOrUndefined(value: unknown): value is EntryVisibility | undefined {
  return value === undefined || value === 'PUBLIC' || value === 'PRIVATE'
}

/** Optional — undefined means "not specified" (createEntry defaults that to false), not invalid. */
export function isBooleanOrUndefined(value: unknown): value is boolean | undefined {
  return value === undefined || typeof value === 'boolean'
}
