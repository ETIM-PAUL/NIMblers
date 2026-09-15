import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { beforeEach, test } from 'node:test'
import type { DatabaseSync } from 'node:sqlite'
import { closeDb, getDb } from '../db/client.ts'
import { migrateUp } from '../db/migrate.ts'
import { getOrCreateUser } from '../db/users.ts'
import { challengeEntry, listOpenEntries, submitChallenge } from './service.ts'
import type { HouseWallet, HouseWalletTransaction } from '../../services/escrow.ts'

process.env.DB_PATH = ':memory:'

const HOUSE_ADDRESS = 'NQ07 HOUS EAAA AAAA AAAA AAAA AAAA AAAA AAAA'
const CREATOR_ADDRESS = 'NQ07 CREA TORA AAAA AAAA AAAA AAAA AAAA AAAA'
const CHALLENGER_ADDRESS = 'NQ07 CHAL LENG ERAA AAAA AAAA AAAA AAAA AAAA'
const OTHER_CHALLENGER_ADDRESS = 'NQ07 OTHE RCHA LLEN GERA AAAA AAAA AAAA AAAA'
const TARGET = 'hi there'
const PARAGRAPH_ID = 'test-paragraph'
const STAKE_LUNA = 100_000

function honestEventsFor(target: string): { key: string, tRelativeMs: number, resultingLength: number }[] {
  return target.split('').map((char, i) => ({ key: char, tRelativeMs: i * 100, resultingLength: i + 1 }))
}

function fakeWallet(): HouseWallet {
  return {
    address: HOUSE_ADDRESS,
    async getBalance() { return 5_000_000 },
    async send() { throw new Error('should not send in this test') },
    async getTransaction(txHash): Promise<HouseWalletTransaction | null> {
      if (txHash === 'bad-tx') return null
      return {
        txHash,
        senderAddress: txHash.includes('challenger2') ? OTHER_CHALLENGER_ADDRESS : CHALLENGER_ADDRESS,
        recipientAddress: HOUSE_ADDRESS,
        valueLuna: STAKE_LUNA,
        state: 'confirmed',
        confirmations: 5,
      }
    },
    async close() {},
  }
}

let db: DatabaseSync
let entryId: string

beforeEach(() => {
  closeDb()
  migrateUp()
  db = getDb()
  const now = new Date().toISOString()
  db.prepare('INSERT INTO paragraphs (id, body, difficulty, created_at) VALUES (?, ?, ?, ?)').run(
    PARAGRAPH_ID,
    TARGET,
    'easy',
    now,
  )

  const creatorId = getOrCreateUser(db, CREATOR_ADDRESS)
  const runId = randomUUID()
  db.prepare(
    'INSERT INTO keystroke_runs (id, user_id, paragraph_id, events, duration_ms, created_at) VALUES (?, ?, ?, ?, ?, ?)',
  ).run(runId, creatorId, PARAGRAPH_ID, '[]', 5000, now)

  entryId = randomUUID()
  const expiresAt = new Date(Date.now() + 24 * 60 * 60_000).toISOString()
  db.prepare(
    `INSERT INTO entries (id, creator_user_id, paragraph_id, keystroke_run_id, stake_luna, status, created_at, expires_at, stake_tx_hash)
     VALUES (?, ?, ?, ?, ?, 'OPEN', ?, ?, ?)`,
  ).run(entryId, creatorId, PARAGRAPH_ID, runId, STAKE_LUNA, now, expiresAt, 'creator-stake-tx')
})

test('listOpenEntries returns opponent address, stake, and age — no time', () => {
  const list = listOpenEntries(db)
  assert.equal(list.length, 1)
  assert.equal(list[0].entryId, entryId)
  assert.equal(list[0].creatorAddress, CREATOR_ADDRESS)
  assert.equal(list[0].stakeLuna, STAKE_LUNA)
  assert.ok(list[0].createdAt)
  const keys = Object.keys(list[0]).join(',').toLowerCase()
  assert.ok(!keys.includes('duration'), `listing leaked timing info: ${keys}`)
})

test('listOpenEntries excludes the caller\'s own entries', () => {
  const list = listOpenEntries(db, CREATOR_ADDRESS)
  assert.equal(list.length, 0)
})

test('listOpenEntries excludes entries that are no longer OPEN', () => {
  db.prepare("UPDATE entries SET status = 'LOCKED' WHERE id = ?").run(entryId)
  assert.equal(listOpenEntries(db).length, 0)
})

test('listOpenEntries excludes entries past their 24h window', () => {
  db.prepare('UPDATE entries SET expires_at = ? WHERE id = ?').run(new Date(Date.now() - 1000).toISOString(), entryId)
  assert.equal(listOpenEntries(db).length, 0)
})

test('challengeEntry locks the entry, takes the stake, and reveals the paragraph', async () => {
  const wallet = fakeWallet()
  const result = await challengeEntry(db, wallet, {
    entryId,
    nimAddress: CHALLENGER_ADDRESS,
    stakeTxHash: 'challenger-stake-tx',
  })

  assert.equal(result.ok, true)
  if (!result.ok) return
  assert.equal(result.paragraphId, PARAGRAPH_ID)
  assert.equal(result.paragraphBody, TARGET)

  const entry = db.prepare('SELECT status FROM entries WHERE id = ?').get(entryId) as { status: string }
  assert.equal(entry.status, 'LOCKED')

  const duel = db.prepare('SELECT * FROM duels WHERE entry_id = ?').get(entryId) as { challenger_user_id: string }
  assert.ok(duel)
  const challengerId = getOrCreateUser(db, CHALLENGER_ADDRESS)
  assert.equal(duel.challenger_user_id, challengerId)
})

test('challengeEntry rejects challenging your own entry', async () => {
  const wallet = fakeWallet()
  const result = await challengeEntry(db, wallet, {
    entryId,
    nimAddress: CREATOR_ADDRESS,
    stakeTxHash: 'self-challenge-tx',
  })
  assert.equal(result.ok, false)

  const entry = db.prepare('SELECT status FROM entries WHERE id = ?').get(entryId) as { status: string }
  assert.equal(entry.status, 'OPEN', 'an entry must stay OPEN after a rejected self-challenge')
})

test('challengeEntry rejects an unknown entry', async () => {
  const wallet = fakeWallet()
  const result = await challengeEntry(db, wallet, {
    entryId: 'does-not-exist',
    nimAddress: CHALLENGER_ADDRESS,
    stakeTxHash: 'whatever',
  })
  assert.equal(result.ok, false)
})

test('two simultaneous challenge requests on the same entry produce one lock and one clean rejection', async () => {
  const wallet = fakeWallet()

  const [first, second] = await Promise.all([
    challengeEntry(db, wallet, { entryId, nimAddress: CHALLENGER_ADDRESS, stakeTxHash: 'challenger-race-tx' }),
    challengeEntry(db, wallet, { entryId, nimAddress: OTHER_CHALLENGER_ADDRESS, stakeTxHash: 'challenger2-race-tx' }),
  ])

  const outcomes = [first, second]
  const succeeded = outcomes.filter((r) => r.ok)
  const rejected = outcomes.filter((r) => !r.ok)

  assert.equal(succeeded.length, 1, 'exactly one challenger should win the lock')
  assert.equal(rejected.length, 1, 'exactly one challenger should get a clean rejection')

  const duelCount = db.prepare('SELECT COUNT(*) c FROM duels WHERE entry_id = ?').get(entryId) as { c: number }
  assert.equal(duelCount.c, 1, 'only one duel row must ever exist for this entry')

  const entry = db.prepare('SELECT status FROM entries WHERE id = ?').get(entryId) as { status: string }
  assert.equal(entry.status, 'LOCKED')
})

test('challengeEntry called twice by the same challenger is idempotent, not a race loss', async () => {
  const wallet = fakeWallet()
  const first = await challengeEntry(db, wallet, { entryId, nimAddress: CHALLENGER_ADDRESS, stakeTxHash: 'retry-tx' })
  const second = await challengeEntry(db, wallet, { entryId, nimAddress: CHALLENGER_ADDRESS, stakeTxHash: 'retry-tx' })

  assert.deepEqual(first, second)
  const duelCount = db.prepare('SELECT COUNT(*) c FROM duels WHERE entry_id = ?').get(entryId) as { c: number }
  assert.equal(duelCount.c, 1)
})

test('a failed stake releases the lock so someone else can challenge', async () => {
  const wallet = fakeWallet()
  const failed = await challengeEntry(db, wallet, { entryId, nimAddress: CHALLENGER_ADDRESS, stakeTxHash: 'bad-tx' })
  assert.equal(failed.ok, false)

  const entryAfterFailure = db.prepare('SELECT status FROM entries WHERE id = ?').get(entryId) as { status: string }
  assert.equal(entryAfterFailure.status, 'OPEN', 'the lock must be released after a failed stake')

  const retried = await challengeEntry(db, wallet, {
    entryId,
    nimAddress: OTHER_CHALLENGER_ADDRESS,
    stakeTxHash: 'challenger2-good-tx',
  })
  assert.equal(retried.ok, true)
})

async function lockEntryForChallenger(db: DatabaseSync): Promise<void> {
  const wallet = fakeWallet()
  const result = await challengeEntry(db, wallet, {
    entryId,
    nimAddress: CHALLENGER_ADDRESS,
    stakeTxHash: 'submit-test-stake-tx',
  })
  assert.equal(result.ok, true)
}

test('submitChallenge records the challenger\'s run with no duration in the response', async () => {
  await lockEntryForChallenger(db)
  const events = honestEventsFor(TARGET)
  const result = submitChallenge(db, { entryId, nimAddress: CHALLENGER_ADDRESS, events })

  assert.deepEqual(result, { ok: true })

  const duel = db.prepare('SELECT challenger_keystroke_run_id FROM duels WHERE entry_id = ?').get(entryId) as {
    challenger_keystroke_run_id: string | null
  }
  assert.ok(duel.challenger_keystroke_run_id)
})

test('submitChallenge rejects when the entry has not been challenged', () => {
  const result = submitChallenge(db, { entryId, nimAddress: CHALLENGER_ADDRESS, events: honestEventsFor(TARGET) })
  assert.equal(result.ok, false)
})

test('submitChallenge rejects a submission from someone other than the challenger', async () => {
  await lockEntryForChallenger(db)
  const result = submitChallenge(db, {
    entryId,
    nimAddress: OTHER_CHALLENGER_ADDRESS,
    events: honestEventsFor(TARGET),
  })
  assert.equal(result.ok, false)
})

test('submitChallenge rejects a tampered run and records nothing', async () => {
  await lockEntryForChallenger(db)
  const events = honestEventsFor(TARGET)
  events[2] = { ...events[2], tRelativeMs: events[1].tRelativeMs - 5 }
  const result = submitChallenge(db, { entryId, nimAddress: CHALLENGER_ADDRESS, events })
  assert.equal(result.ok, false)

  const duel = db.prepare('SELECT challenger_keystroke_run_id FROM duels WHERE entry_id = ?').get(entryId) as {
    challenger_keystroke_run_id: string | null
  }
  assert.equal(duel.challenger_keystroke_run_id, null)
})

test('submitChallenge is idempotent — calling it twice records the run once', async () => {
  await lockEntryForChallenger(db)
  const events = honestEventsFor(TARGET)
  const first = submitChallenge(db, { entryId, nimAddress: CHALLENGER_ADDRESS, events })
  const second = submitChallenge(db, { entryId, nimAddress: CHALLENGER_ADDRESS, events })

  assert.deepEqual(first, { ok: true })
  assert.deepEqual(second, { ok: true })

  const runCount = db.prepare('SELECT COUNT(*) c FROM keystroke_runs').get() as { c: number }
  assert.equal(runCount.c, 2) // creator's seeded run + challenger's one run, not two
})
