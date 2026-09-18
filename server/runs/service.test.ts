import assert from 'node:assert/strict'
import { beforeEach, test } from 'node:test'
import type { Db } from '../db/client.ts'
import { closeDb, getDb } from '../db/client.ts'
import { migrateUp } from '../db/migrate.ts'
import { submitRun } from './service.ts'

process.env.DB_PATH = ':memory:'

const TARGET = 'hi there'
const PARAGRAPH_ID = 'test-paragraph'

function honestEvents(): { key: string, tRelativeMs: number, resultingLength: number }[] {
  let typed = ''
  return TARGET.split('').map((char, i) => {
    typed += char
    return { key: char, tRelativeMs: i * 100, resultingLength: typed.length }
  })
}

let db: Db

beforeEach(async () => {
  closeDb()
  await migrateUp()
  db = await getDb()
  await db.execute({
    sql: 'INSERT INTO paragraphs (id, body, difficulty, created_at) VALUES (?, ?, ?, ?)',
    args: [PARAGRAPH_ID, TARGET, 'easy', new Date().toISOString()],
  })
})

test('a valid run is persisted with the server-computed duration', async () => {
  const events = honestEvents()
  const result = await submitRun(db, { nimAddress: 'NQtest1', paragraphId: PARAGRAPH_ID, events })

  assert.equal(result.ok, true)
  if (!result.ok) return
  assert.equal(result.durationMs, events[events.length - 1].tRelativeMs)

  const row = (await db.execute({ sql: 'SELECT * FROM keystroke_runs WHERE id = ?', args: [result.runId] }))
    .rows[0] as unknown as { duration_ms: number, events: string, paragraph_id: string } | undefined
  assert.ok(row)
  assert.equal(row.duration_ms, result.durationMs)
  assert.equal(row.paragraph_id, PARAGRAPH_ID)
  assert.deepEqual(JSON.parse(row.events), events)
})

test('a tampered payload (edited timestamps) is rejected and nothing is persisted', async () => {
  const events = honestEvents()
  events[2] = { ...events[2], tRelativeMs: events[1].tRelativeMs - 5 }

  const result = await submitRun(db, { nimAddress: 'NQtest1', paragraphId: PARAGRAPH_ID, events })
  assert.equal(result.ok, false)

  const count = (await db.execute('SELECT COUNT(*) c FROM keystroke_runs')).rows[0] as unknown as { c: number }
  assert.equal(count.c, 0)
})

test('a forged final string is rejected and nothing is persisted', async () => {
  const events = TARGET.split('').map((_, i) => ({ key: 'z', tRelativeMs: i * 100, resultingLength: i + 1 }))

  const result = await submitRun(db, { nimAddress: 'NQtest1', paragraphId: PARAGRAPH_ID, events })
  assert.equal(result.ok, false)

  const count = (await db.execute('SELECT COUNT(*) c FROM keystroke_runs')).rows[0] as unknown as { c: number }
  assert.equal(count.c, 0)
})

test('an unknown paragraph id is rejected', async () => {
  const result = await submitRun(db, { nimAddress: 'NQtest1', paragraphId: 'does-not-exist', events: honestEvents() })
  assert.equal(result.ok, false)
})

test('submitting twice from the same address reuses one user row', async () => {
  await submitRun(db, { nimAddress: 'NQsame', paragraphId: PARAGRAPH_ID, events: honestEvents() })
  await submitRun(db, { nimAddress: 'NQsame', paragraphId: PARAGRAPH_ID, events: honestEvents() })

  const count = (await db.execute({ sql: 'SELECT COUNT(*) c FROM users WHERE nim_address = ?', args: ['NQsame'] }))
    .rows[0] as unknown as { c: number }
  assert.equal(count.c, 1)

  const runCount = (await db.execute('SELECT COUNT(*) c FROM keystroke_runs')).rows[0] as unknown as { c: number }
  assert.equal(runCount.c, 2)
})

test('a run far above the WPM ceiling is rejected and nothing is persisted', async () => {
  const events = TARGET.split('').map((char, i) => ({ key: char, tRelativeMs: i * 5, resultingLength: i + 1 }))
  const result = await submitRun(db, { nimAddress: 'NQtest1', paragraphId: PARAGRAPH_ID, events })
  assert.equal(result.ok, false)
  if (result.ok) return
  assert.match(result.reason, /WPM ceiling/)

  const count = (await db.execute('SELECT COUNT(*) c FROM keystroke_runs')).rows[0] as unknown as { c: number }
  assert.equal(count.c, 0)
})

test('a flagged-but-authentic run is still persisted, with its flags recorded', async () => {
  // A perfectly constant delay between every keystroke — authentic replay,
  // but statistically bot-like.
  const events = TARGET.split('').map((char, i) => ({ key: char, tRelativeMs: i * 90, resultingLength: i + 1 }))
  const result = await submitRun(db, { nimAddress: 'NQtest1', paragraphId: PARAGRAPH_ID, events })

  assert.equal(result.ok, true)
  if (!result.ok) return
  assert.ok(result.flags.length > 0)

  const row = (await db.execute({ sql: 'SELECT flags FROM keystroke_runs WHERE id = ?', args: [result.runId] }))
    .rows[0] as unknown as { flags: string | null }
  assert.ok(row.flags)
  assert.deepEqual(JSON.parse(row.flags as string), result.flags)
})

test('exceeding the daily run limit for an address is rejected', async () => {
  await submitRun(db, { nimAddress: 'NQlimited', paragraphId: PARAGRAPH_ID, events: honestEvents() }, { dailyRunLimit: 1 })
  const second = await submitRun(
    db,
    { nimAddress: 'NQlimited', paragraphId: PARAGRAPH_ID, events: honestEvents() },
    { dailyRunLimit: 1 },
  )

  assert.equal(second.ok, false)
  if (second.ok) return
  assert.match(second.reason, /daily run limit/)

  const runCount = (await db.execute('SELECT COUNT(*) c FROM keystroke_runs')).rows[0] as unknown as { c: number }
  assert.equal(runCount.c, 1)
})
