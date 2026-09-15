import assert from 'node:assert/strict'
import { beforeEach, test } from 'node:test'
import type { DatabaseSync } from 'node:sqlite'
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

let db: DatabaseSync

beforeEach(() => {
  closeDb()
  migrateUp()
  db = getDb()
  db.prepare('INSERT INTO paragraphs (id, body, difficulty, created_at) VALUES (?, ?, ?, ?)').run(
    PARAGRAPH_ID,
    TARGET,
    'easy',
    new Date().toISOString(),
  )
})

test('a valid run is persisted with the server-computed duration', () => {
  const events = honestEvents()
  const result = submitRun(db, { nimAddress: 'NQtest1', paragraphId: PARAGRAPH_ID, events })

  assert.equal(result.ok, true)
  if (!result.ok) return
  assert.equal(result.durationMs, events[events.length - 1].tRelativeMs)

  const row = db.prepare('SELECT * FROM keystroke_runs WHERE id = ?').get(result.runId) as
    | { duration_ms: number, events: string, paragraph_id: string }
    | undefined
  assert.ok(row)
  assert.equal(row.duration_ms, result.durationMs)
  assert.equal(row.paragraph_id, PARAGRAPH_ID)
  assert.deepEqual(JSON.parse(row.events), events)
})

test('a tampered payload (edited timestamps) is rejected and nothing is persisted', () => {
  const events = honestEvents()
  events[2] = { ...events[2], tRelativeMs: events[1].tRelativeMs - 5 }

  const result = submitRun(db, { nimAddress: 'NQtest1', paragraphId: PARAGRAPH_ID, events })
  assert.equal(result.ok, false)

  const count = db.prepare('SELECT COUNT(*) c FROM keystroke_runs').get() as { c: number }
  assert.equal(count.c, 0)
})

test('a forged final string is rejected and nothing is persisted', () => {
  const events = TARGET.split('').map((_, i) => ({ key: 'z', tRelativeMs: i * 100, resultingLength: i + 1 }))

  const result = submitRun(db, { nimAddress: 'NQtest1', paragraphId: PARAGRAPH_ID, events })
  assert.equal(result.ok, false)

  const count = db.prepare('SELECT COUNT(*) c FROM keystroke_runs').get() as { c: number }
  assert.equal(count.c, 0)
})

test('an unknown paragraph id is rejected', () => {
  const result = submitRun(db, { nimAddress: 'NQtest1', paragraphId: 'does-not-exist', events: honestEvents() })
  assert.equal(result.ok, false)
})

test('submitting twice from the same address reuses one user row', () => {
  submitRun(db, { nimAddress: 'NQsame', paragraphId: PARAGRAPH_ID, events: honestEvents() })
  submitRun(db, { nimAddress: 'NQsame', paragraphId: PARAGRAPH_ID, events: honestEvents() })

  const count = db.prepare('SELECT COUNT(*) c FROM users WHERE nim_address = ?').get('NQsame') as { c: number }
  assert.equal(count.c, 1)

  const runCount = db.prepare('SELECT COUNT(*) c FROM keystroke_runs').get() as { c: number }
  assert.equal(runCount.c, 2)
})

test('a run far above the WPM ceiling is rejected and nothing is persisted', () => {
  const events = TARGET.split('').map((char, i) => ({ key: char, tRelativeMs: i * 5, resultingLength: i + 1 }))
  const result = submitRun(db, { nimAddress: 'NQtest1', paragraphId: PARAGRAPH_ID, events })
  assert.equal(result.ok, false)
  if (result.ok) return
  assert.match(result.reason, /WPM ceiling/)

  const count = db.prepare('SELECT COUNT(*) c FROM keystroke_runs').get() as { c: number }
  assert.equal(count.c, 0)
})

test('a flagged-but-authentic run is still persisted, with its flags recorded', () => {
  // A perfectly constant delay between every keystroke — authentic replay,
  // but statistically bot-like.
  const events = TARGET.split('').map((char, i) => ({ key: char, tRelativeMs: i * 90, resultingLength: i + 1 }))
  const result = submitRun(db, { nimAddress: 'NQtest1', paragraphId: PARAGRAPH_ID, events })

  assert.equal(result.ok, true)
  if (!result.ok) return
  assert.ok(result.flags.length > 0)

  const row = db.prepare('SELECT flags FROM keystroke_runs WHERE id = ?').get(result.runId) as { flags: string | null }
  assert.ok(row.flags)
  assert.deepEqual(JSON.parse(row.flags as string), result.flags)
})

test('exceeding the daily run limit for an address is rejected', () => {
  submitRun(db, { nimAddress: 'NQlimited', paragraphId: PARAGRAPH_ID, events: honestEvents() }, { dailyRunLimit: 1 })
  const second = submitRun(
    db,
    { nimAddress: 'NQlimited', paragraphId: PARAGRAPH_ID, events: honestEvents() },
    { dailyRunLimit: 1 },
  )

  assert.equal(second.ok, false)
  if (second.ok) return
  assert.match(second.reason, /daily run limit/)

  const runCount = db.prepare('SELECT COUNT(*) c FROM keystroke_runs').get() as { c: number }
  assert.equal(runCount.c, 1)
})
