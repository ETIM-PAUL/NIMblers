import type { Difficulty } from '../db/types.ts'

export type { Difficulty }

export interface Paragraph {
  id: string
  body: string
  difficulty: Difficulty
}

const ALL_DIFFICULTIES: Difficulty[] = ['easy', 'medium', 'hard']

/**
 * Deterministic per-calendar-day, per-difficulty hash. Uses the UTC date
 * only (not time of day), so every caller anywhere in the world gets the
 * same daily paragraph for a given tier.
 */
function dailyIndexSeed(date: Date, difficulty: Difficulty): number {
  const key = `${date.toISOString().slice(0, 10)}:${difficulty}` // YYYY-MM-DD:difficulty
  let hash = 0
  for (let i = 0; i < key.length; i++) {
    hash = (Math.imul(hash, 31) + key.charCodeAt(i)) >>> 0
  }
  return hash
}

/**
 * The single paragraph live for a given date and difficulty tier — each
 * tier gets its own daily paragraph (stakes differ by tier, so the text
 * that backs a duel has to be pinned to the tier it was staked for). Same
 * pool + same date + same difficulty always yields the same paragraph.
 */
export function getDailyParagraph(pool: Paragraph[], date: Date, difficulty: Difficulty): Paragraph {
  const candidates = pool.filter((paragraph) => paragraph.difficulty === difficulty)
  if (candidates.length === 0) throw new Error(`Paragraph pool has no ${difficulty} paragraphs.`)
  const index = dailyIndexSeed(date, difficulty) % candidates.length
  return candidates[index]
}

/** All three tiers' daily paragraphs for a given date, keyed by difficulty. */
export function getAllDailyParagraphs(pool: Paragraph[], date: Date = new Date()): Record<Difficulty, Paragraph> {
  return Object.fromEntries(
    ALL_DIFFICULTIES.map((difficulty) => [difficulty, getDailyParagraph(pool, date, difficulty)]),
  ) as Record<Difficulty, Paragraph>
}

/**
 * A paragraph for practice mode. Never returns a paragraph that's live as
 * today's daily paragraph for any tier a real duel could be staked at — a
 * practice run under one difficulty filter could otherwise leak the answer
 * to that tier's live duels. When `difficulty` is given, only that tier's
 * daily paragraph needs excluding (the pool is already filtered to that
 * tier, so the other two tiers' daily paragraphs never appear as
 * candidates anyway); with no filter, all three are excluded.
 */
export function getPracticeParagraph(
  pool: Paragraph[],
  date: Date = new Date(),
  rng: () => number = Math.random,
  difficulty?: Difficulty,
): Paragraph {
  const dailyIds = new Set(
    (difficulty ? [difficulty] : ALL_DIFFICULTIES).map((d) => getDailyParagraph(pool, date, d).id),
  )
  const candidates = pool.filter(
    (paragraph) => !dailyIds.has(paragraph.id) && (difficulty === undefined || paragraph.difficulty === difficulty),
  )
  if (candidates.length === 0) {
    throw new Error('Practice pool is empty: need at least 2 matching paragraphs to exclude the daily one.')
  }
  const index = Math.floor(rng() * candidates.length)
  return candidates[index]
}
