import { randomUUID } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'
import type { Difficulty, ParagraphRow } from '../db/types.ts'
import { generateParagraph } from './generator.ts'
import type { Paragraph } from './service.ts'
import { getPracticeParagraph } from './service.ts'

export function listParagraphs(db: DatabaseSync): Paragraph[] {
  const rows = db.prepare('SELECT id, body, difficulty FROM paragraphs ORDER BY id').all() as Pick<
    ParagraphRow,
    'id' | 'body' | 'difficulty'
  >[]
  return rows
}

/**
 * The paragraph a specific stake's reveal already showed the player, or a
 * freshly generated one if this is the first time — see
 * server/paragraphs/generator.ts for why duels no longer draw from the
 * fixed daily pool. Idempotent per `stakeTxHash`: a retried reveal call
 * (network hiccup, client retry) finds the same text again instead of
 * generating a second one that would no longer match what the player was
 * actually shown and typed against.
 */
export function getOrGenerateParagraphForStake(db: DatabaseSync, stakeTxHash: string, difficulty: Difficulty): Paragraph {
  const existing = db
    .prepare('SELECT id, body, difficulty FROM paragraphs WHERE reveal_stake_tx_hash = ?')
    .get(stakeTxHash) as Pick<ParagraphRow, 'id' | 'body' | 'difficulty'> | undefined
  // Normalized to a plain object — node:sqlite rows come back with a null
  // prototype, which would otherwise make this branch's return value
  // subtly different in shape from the freshly-generated one below.
  if (existing) return { id: existing.id, body: existing.body, difficulty: existing.difficulty }

  const id = randomUUID()
  const body = generateParagraph(difficulty)
  db.prepare(
    'INSERT INTO paragraphs (id, body, difficulty, created_at, reveal_stake_tx_hash) VALUES (?, ?, ?, ?, ?)',
  ).run(id, body, difficulty, new Date().toISOString(), stakeTxHash)
  return { id, body, difficulty }
}

export function getPracticeParagraphForToday(
  db: DatabaseSync,
  date: Date = new Date(),
  difficulty?: Difficulty,
): Paragraph {
  return getPracticeParagraph(listParagraphs(db), date, Math.random, difficulty)
}
