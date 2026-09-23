import { randomUUID } from 'node:crypto'
import type { Db } from '../db/client.ts'
import { isUniqueConstraintError } from '../db/client.ts'
import type { Difficulty, Language, ParagraphRow } from '../db/types.ts'
import { generateParagraph } from './generator.ts'
import type { Paragraph } from './service.ts'
import { getPracticeParagraph } from './service.ts'

export async function listParagraphs(db: Db): Promise<Paragraph[]> {
  const rows = (await db.execute('SELECT id, body, difficulty, language FROM paragraphs ORDER BY id')).rows as unknown as Pick<
    ParagraphRow,
    'id' | 'body' | 'difficulty' | 'language'
  >[]
  return rows.map((row) => ({ id: row.id, body: row.body, difficulty: row.difficulty, language: row.language }))
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
export async function getOrGenerateParagraphForStake(
  db: Db,
  stakeTxHash: string,
  difficulty: Difficulty,
  language: Language = 'en',
): Promise<Paragraph> {
  const existing = (await db.execute({
    sql: 'SELECT id, body, difficulty, language FROM paragraphs WHERE reveal_stake_tx_hash = ?',
    args: [stakeTxHash],
  })).rows[0] as unknown as Pick<ParagraphRow, 'id' | 'body' | 'difficulty' | 'language'> | undefined
  if (existing) return { id: existing.id, body: existing.body, difficulty: existing.difficulty, language: existing.language }

  const id = randomUUID()
  const body = generateParagraph(difficulty, language)
  try {
    await db.execute({
      sql: 'INSERT INTO paragraphs (id, body, difficulty, language, created_at, reveal_stake_tx_hash) VALUES (?, ?, ?, ?, ?, ?)',
      args: [id, body, difficulty, language, new Date().toISOString(), stakeTxHash],
    })
    return { id, body, difficulty, language }
  }
  catch (error) {
    if (!isUniqueConstraintError(error)) throw error
    const row = (await db.execute({
      sql: 'SELECT id, body, difficulty, language FROM paragraphs WHERE reveal_stake_tx_hash = ?',
      args: [stakeTxHash],
    })).rows[0] as unknown as Pick<ParagraphRow, 'id' | 'body' | 'difficulty' | 'language'> | undefined
    if (!row) throw error
    return { id: row.id, body: row.body, difficulty: row.difficulty, language: row.language }
  }
}

export async function getPracticeParagraphForToday(
  db: Db,
  date: Date = new Date(),
  difficulty?: Difficulty,
  language: Language = 'en',
): Promise<Paragraph> {
  return getPracticeParagraph(await listParagraphs(db), date, Math.random, difficulty, language)
}
