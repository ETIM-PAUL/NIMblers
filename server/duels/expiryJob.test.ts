import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { beforeEach, test } from 'node:test'
import type { DatabaseSync } from 'node:sqlite'
import { closeDb, getDb } from '../db/client.ts'
import { migrateUp } from '../db/migrate.ts'
import { getOrCreateUser } from '../db/users.ts'
import { challengeEntry } from './service.ts'
import { DEFAULT_LOCK_TTL_MS } from './stateMachine.ts'
import { runExpirySweep } from './expiryJob.ts'
import type { HouseWallet, HouseWalletTransaction } from '../../services/escrow.ts'

process.env.DB_PATH = ':memory:'

const HOUSE_ADDRESS = 'NQ07 HOUS EAAA AAAA AAAA AAAA AAAA AAAA AAAA'
const CREATOR_ADDRESS = 'NQ07 CREA TORA AAAA AAAA AAAA AAAA AAAA AAAA'
const CHALLENGER_ADDRESS = 'NQ07 CHAL LENG ERAA AAAA AAAA AAAA AAAA AAAA'
const OTHER_CHALLENGER_ADDRESS = 'NQ07 OTHE RCHA LLEN GERA AAAA AAAA AAAA AAAA'
const PARAGRAPH_ID = 'test-paragraph'
const TARGET = 'hi there'
const STAKE_LUNA = 100_000

function fakeWallet(): HouseWallet {
  let sendCount = 0
  return {
    address: HOUSE_ADDRESS,
    async getBalance() { return 5_000_000 },
    async send(recipientAddress, valueLuna) {
      sendCount += 1
      return { txHash: `refund-tx-${sendCount}`, senderAddress: HOUSE_ADDRESS, recipientAddress, valueLuna, state: 'confirmed', confirmations: 5 }
    },
    async getTransaction(txHash): Promise<HouseWalletTransaction | null> {
      const sender = txHash.includes('other') ? OTHER_CHALLENGER_ADDRESS : CHALLENGER_ADDRESS
      return { txHash, senderAddress: sender, recipientAddress: HOUSE_ADDRESS, valueLuna: STAKE_LUNA, state: 'confirmed', confirmations: 5 }
    },
    async close() {},
  }
}

/** A wallet whose send() always fails, to test the refund-failure rollback path. */
function failingWallet(): HouseWallet {
  return {
    ...fakeWallet(),
    async send() { throw new Error('network is down') },
  }
}

let db: DatabaseSync
let creatorId: string

function insertOpenEntry(hoursOld: number): string {
  const entryId = randomUUID()
  const runId = randomUUID()
  const createdAt = new Date(Date.now() - hoursOld * 60 * 60_000).toISOString()
  const expiresAt = new Date(Date.now() - (hoursOld - 24) * 60 * 60_000).toISOString()
  db.prepare(
    'INSERT INTO keystroke_runs (id, user_id, paragraph_id, events, duration_ms, created_at) VALUES (?, ?, ?, ?, ?, ?)',
  ).run(runId, creatorId, PARAGRAPH_ID, '[]', 5000, createdAt)
  db.prepare(
    `INSERT INTO entries (id, creator_user_id, paragraph_id, keystroke_run_id, stake_luna, status, created_at, expires_at, stake_tx_hash)
     VALUES (?, ?, ?, ?, ?, 'OPEN', ?, ?, ?)`,
  ).run(entryId, creatorId, PARAGRAPH_ID, runId, STAKE_LUNA, createdAt, expiresAt, `stake-tx-${entryId}`)
  return entryId
}

async function insertLockedEntry(hoursSinceLocked: number): Promise<string> {
  const entryId = insertOpenEntry(1) // fresh entry, plenty of time left on its own 24h clock
  const wallet = fakeWallet()
  const result = await challengeEntry(db, wallet, {
    entryId,
    nimAddress: CHALLENGER_ADDRESS,
    stakeTxHash: `lock-stake-${entryId}`,
  })
  assert.equal(result.ok, true, 'setup: challenge must succeed')

  const lockedAt = new Date(Date.now() - hoursSinceLocked * 60 * 60_000).toISOString()
  const lockTtlExpiresAt = new Date(new Date(lockedAt).getTime() + DEFAULT_LOCK_TTL_MS).toISOString()
  db.prepare('UPDATE duels SET locked_at = ?, lock_ttl_expires_at = ? WHERE entry_id = ?').run(lockedAt, lockTtlExpiresAt, entryId)
  return entryId
}

beforeEach(() => {
  closeDb()
  migrateUp()
  db = getDb()
  const now = new Date().toISOString()
  db.prepare('INSERT INTO paragraphs (id, body, difficulty, created_at) VALUES (?, ?, ?, ?)').run(PARAGRAPH_ID, TARGET, 'easy', now)
  creatorId = getOrCreateUser(db, CREATOR_ADDRESS)
})

test('refunds an entry whose 24h window elapsed with no challenger', async () => {
  const entryId = insertOpenEntry(25) // created 25h ago
  const wallet = fakeWallet()

  const result = await runExpirySweep(db, wallet)

  assert.deepEqual(result.refundedEntries, [entryId])
  assert.deepEqual(result.releasedLocks, [])
  assert.deepEqual(result.errors, [])

  const entry = db.prepare('SELECT status FROM entries WHERE id = ?').get(entryId) as { status: string }
  assert.equal(entry.status, 'EXPIRED')

  const refundRow = db.prepare("SELECT amount_luna, tx_hash FROM payouts WHERE type = 'REFUND' AND user_id = ?").get(creatorId) as {
    amount_luna: number
    tx_hash: string | null
  }
  assert.ok(refundRow, 'expected a REFUND row for the creator')
  assert.equal(refundRow.amount_luna, STAKE_LUNA)
  assert.ok(refundRow.tx_hash)
})

test('leaves an entry alone until its 24h window actually elapses', async () => {
  const entryId = insertOpenEntry(1) // only 1h old
  const result = await runExpirySweep(db, fakeWallet())

  assert.deepEqual(result.refundedEntries, [])
  const entry = db.prepare('SELECT status FROM entries WHERE id = ?').get(entryId) as { status: string }
  assert.equal(entry.status, 'OPEN')
})

test('an entry created 25 hours ago is refunded exactly once across three consecutive sweeps', async () => {
  const entryId = insertOpenEntry(25)
  const wallet = fakeWallet()

  const first = await runExpirySweep(db, wallet)
  const second = await runExpirySweep(db, wallet)
  const third = await runExpirySweep(db, wallet)

  assert.deepEqual(first.refundedEntries, [entryId])
  assert.deepEqual(second.refundedEntries, [])
  assert.deepEqual(third.refundedEntries, [])

  const refundCount = db.prepare("SELECT COUNT(*) c FROM payouts WHERE type = 'REFUND'").get() as { c: number }
  assert.equal(refundCount.c, 1, 'must refund exactly once, not once per sweep run')

  const entry = db.prepare('SELECT status FROM entries WHERE id = ?').get(entryId) as { status: string }
  assert.equal(entry.status, 'EXPIRED')
})

test('releases a stale challenger lock back to OPEN and forfeits nothing back to the challenger', async () => {
  const entryId = await insertLockedEntry(3) // locked 3h ago, TTL is 2h
  const result = await runExpirySweep(db, fakeWallet())

  assert.deepEqual(result.releasedLocks, [entryId])
  assert.deepEqual(result.refundedEntries, [])

  const entry = db.prepare('SELECT status FROM entries WHERE id = ?').get(entryId) as { status: string }
  assert.equal(entry.status, 'OPEN')

  const duelCount = db.prepare('SELECT COUNT(*) c FROM duels WHERE entry_id = ?').get(entryId) as { c: number }
  assert.equal(duelCount.c, 0, 'the stale duel row must be gone so a fresh challenge can happen')

  // The challenger's stake was already received (Phase 12) and is forfeited, not refunded.
  const challengerId = getOrCreateUser(db, CHALLENGER_ADDRESS)
  const refundToChallenger = db.prepare("SELECT COUNT(*) c FROM payouts WHERE type = 'REFUND' AND user_id = ?").get(challengerId) as { c: number }
  assert.equal(refundToChallenger.c, 0)
})

test('leaves a lock alone until its TTL actually elapses', async () => {
  const entryId = await insertLockedEntry(0) // just locked
  const result = await runExpirySweep(db, fakeWallet())

  assert.deepEqual(result.releasedLocks, [])
  const entry = db.prepare('SELECT status FROM entries WHERE id = ?').get(entryId) as { status: string }
  assert.equal(entry.status, 'LOCKED')
})

test('never releases a lock whose challenger already submitted a run', async () => {
  const entryId = await insertLockedEntry(3)
  const runId = randomUUID()
  const challengerId = getOrCreateUser(db, CHALLENGER_ADDRESS)
  db.prepare(
    'INSERT INTO keystroke_runs (id, user_id, paragraph_id, events, duration_ms, created_at) VALUES (?, ?, ?, ?, ?, ?)',
  ).run(runId, challengerId, PARAGRAPH_ID, '[]', 4000, new Date().toISOString())
  db.prepare('UPDATE duels SET challenger_keystroke_run_id = ? WHERE entry_id = ?').run(runId, entryId)

  const result = await runExpirySweep(db, fakeWallet())

  assert.deepEqual(result.releasedLocks, [])
  const entry = db.prepare('SELECT status FROM entries WHERE id = ?').get(entryId) as { status: string }
  assert.equal(entry.status, 'LOCKED')
})

test('after a stale lock is released, a different challenger can take the reopened entry', async () => {
  const entryId = await insertLockedEntry(3)
  await runExpirySweep(db, fakeWallet())

  const wallet = fakeWallet()
  const result = await challengeEntry(db, wallet, {
    entryId,
    nimAddress: OTHER_CHALLENGER_ADDRESS,
    stakeTxHash: 'other-challenger-tx',
  })
  assert.equal(result.ok, true, 'a stale duel row must not block a fresh challenger')

  const entry = db.prepare('SELECT status FROM entries WHERE id = ?').get(entryId) as { status: string }
  assert.equal(entry.status, 'LOCKED')
})

test('a failed refund reverts the entry to OPEN so the next sweep retries instead of stranding the stake', async () => {
  const entryId = insertOpenEntry(25)
  const wallet = failingWallet()

  const result = await runExpirySweep(db, wallet)
  assert.deepEqual(result.refundedEntries, [])
  assert.equal(result.errors.length, 1)
  assert.equal(result.errors[0].entryId, entryId)

  const entry = db.prepare('SELECT status FROM entries WHERE id = ?').get(entryId) as { status: string }
  assert.equal(entry.status, 'OPEN', 'must revert to OPEN, not get stuck EXPIRED with no money sent')

  const payoutCount = db.prepare('SELECT COUNT(*) c FROM payouts').get() as { c: number }
  assert.equal(payoutCount.c, 0, 'a failed send must not leave a half-claimed payout row behind')

  // A later sweep, once the wallet is healthy again, successfully retries.
  const retry = await runExpirySweep(db, fakeWallet())
  assert.deepEqual(retry.refundedEntries, [entryId])
})
