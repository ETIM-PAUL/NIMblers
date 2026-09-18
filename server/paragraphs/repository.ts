import { randomUUID } from 'node:crypto'
import type { Db } from '../db/client.ts'
import { isUniqueConstraintError } from '../db/client.ts'
import type { Difficulty, ParagraphRow } from '../db/types.ts'
import { generateParagraph } from './generator.ts'
import type { Paragraph } from './service.ts'
import { getPracticeParagraph } from './service.ts'

export async function listParagraphs(db: Db): Promise<Paragraph[]> {
  const rows = (await db.execute('SELECT id, body, difficulty FROM paragraphs ORDER BY id')).rows as unknown as Pick<
    ParagraphRow,
    'id' | 'body' | 'difficulty'
  >[]
  return rows.map((row) => ({ id: row.id, body: row.body, difficulty: row.difficulty }))
}

/**
 * The paragraph a specific stake's reveal already showed the player, or a
 * freshly generated one if this is the first time — see
 * server/paragraphs/generator.ts for why duels no longer draw from the
 * fixed daily pool. Idempotent per `stakeTxHash`: a retried reveal call
 * (network hiccup, client retry) finds the same text again instead of
 * generating a second one that would no longer match what the player was
 * actually shown and typed against. `reveal_stake_tx_hash` is `UNIQUE`, so
 * two such retries racing each other resolve to a constraint error on the
 * losing insert rather than two different paragraphs — that one just
 * re-reads what the winner wrote.
 */
export async function getOrGenerateParagraphForStake(db: Db, stakeTxHash: string, difficulty: Difficulty): Promise<Paragraph> {
  const existing = (await db.execute({
    sql: 'SELECT id, body, difficulty FROM paragraphs WHERE reveal_stake_tx_hash = ?',
    args: [stakeTxHash],
  })).rows[0] as unknown as Pick<ParagraphRow, 'id' | 'body' | 'difficulty'> | undefined
  if (existing) return { id: existing.id, body: existing.body, difficulty: existing.difficulty }

  const id = randomUUID()
  const body = generateParagraph(difficulty)
  try {
    await db.execute({
      sql: 'INSERT INTO paragraphs (id, body, difficulty, created_at, reveal_stake_tx_hash) VALUES (?, ?, ?, ?, ?)',
      args: [id, body, difficulty, new Date().toISOString(), stakeTxHash],
    })
    return { id, body, difficulty }
  }
  catch (error) {
    if (!isUniqueConstraintError(error)) throw error
    const row = (await db.execute({
      sql: 'SELECT id, body, difficulty FROM paragraphs WHERE reveal_stake_tx_hash = ?',
      args: [stakeTxHash],
    })).rows[0] as unknown as Pick<ParagraphRow, 'id' | 'body' | 'difficulty'> | undefined
    if (!row) throw error
    return { id: row.id, body: row.body, difficulty: row.difficulty }
  }
}

export async function getPracticeParagraphForToday(
  db: Db,
  date: Date = new Date(),
  difficulty?: Difficulty,
): Promise<Paragraph> {
  return getPracticeParagraph(await listParagraphs(db), date, Math.random, difficulty)
}
