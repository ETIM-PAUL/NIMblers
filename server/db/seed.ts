import type { Db } from './client.ts'
import { closeDb, getDb } from './client.ts'
import { migrateUp } from './migrate.ts'
import { PARAGRAPH_POOL } from '../paragraphs/pool-data.ts'

// Fixed ids so re-running the seed is a no-op rather than a duplicate insert.
const SEED_USER_ID = 'seed-user-a'
const SEED_PARAGRAPH_ID = PARAGRAPH_POOL[0].id
const SEED_RUN_ID = 'seed-run-a'
const SEED_ENTRY_ID = 'seed-entry-1'

export async function seedParagraphPool(db: Db): Promise<void> {
  const nowIso = new Date().toISOString()
  for (const paragraph of PARAGRAPH_POOL) {
    await db.execute({
      sql: 'INSERT OR IGNORE INTO paragraphs (id, body, difficulty, language, created_at) VALUES (?, ?, ?, ?, ?)',
      args: [paragraph.id, paragraph.body, paragraph.difficulty, paragraph.language, nowIso],
    })
  }
}

export async function seed(): Promise<void> {
  await migrateUp()
  const db = await getDb()
  const now = new Date()
  const nowIso = now.toISOString()
  const expiresIso = new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString()

  await db.execute({
    sql: 'INSERT OR IGNORE INTO users (id, nim_address, created_at) VALUES (?, ?, ?)',
    args: [SEED_USER_ID, 'NQ07 0000 0000 0000 0000 0000 0000 0000 0000', nowIso],
  })

  await seedParagraphPool(db)

  await db.execute({
    sql: `INSERT OR IGNORE INTO keystroke_runs
      (id, user_id, paragraph_id, events, duration_ms, created_at)
      VALUES (?, ?, ?, ?, ?, ?)`,
    args: [SEED_RUN_ID, SEED_USER_ID, SEED_PARAGRAPH_ID, '[]', 8420, nowIso],
  })

  await db.execute({
    sql: `INSERT OR IGNORE INTO entries
      (id, creator_user_id, paragraph_id, keystroke_run_id, stake_luna, status, created_at, expires_at)
      VALUES (?, ?, ?, ?, ?, 'OPEN', ?, ?)`,
    args: [SEED_ENTRY_ID, SEED_USER_ID, SEED_PARAGRAPH_ID, SEED_RUN_ID, 200_000, nowIso, expiresIso],
  })

  console.log(`Seeded OPEN entry ${SEED_ENTRY_ID}.`)
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await seed()
  closeDb()
}
