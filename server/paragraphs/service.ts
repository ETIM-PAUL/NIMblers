import type { Difficulty } from '../db/types.ts'

export interface Paragraph {
  id: string
  body: string
  difficulty: Difficulty
}

/**
 * Deterministic per-calendar-day hash. Uses the UTC date only (not time of
 * day), so every caller anywhere in the world gets the same daily paragraph.
 */
function dailyIndexSeed(date: Date): number {
  const key = date.toISOString().slice(0, 10) // YYYY-MM-DD
  let hash = 0
  for (let i = 0; i < key.length; i++) {
    hash = (Math.imul(hash, 31) + key.charCodeAt(i)) >>> 0
  }
  return hash
}

/** The single paragraph live for a given date. Same pool + same date always yields the same paragraph. */
export function getDailyParagraph(pool: Paragraph[], date: Date = new Date()): Paragraph {
  if (pool.length === 0) throw new Error('Paragraph pool is empty.')
  const index = dailyIndexSeed(date) % pool.length
  return pool[index]
}

/**
 * A paragraph for practice mode. Never returns the paragraph that's live as
 * today's daily paragraph, so practicing can't leak the answer to today's
 * duel-starting text.
 */
export function getPracticeParagraph(
  pool: Paragraph[],
  date: Date = new Date(),
  rng: () => number = Math.random,
): Paragraph {
  const daily = getDailyParagraph(pool, date)
  const candidates = pool.filter((paragraph) => paragraph.id !== daily.id)
  if (candidates.length === 0) {
    throw new Error('Practice pool is empty: need at least 2 paragraphs to exclude the daily one.')
  }
  const index = Math.floor(rng() * candidates.length)
  return candidates[index]
}
