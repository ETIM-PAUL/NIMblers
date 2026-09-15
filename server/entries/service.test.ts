import assert from 'node:assert/strict'
import { beforeEach, test } from 'node:test'
import type { DatabaseSync } from 'node:sqlite'
import { closeDb, getDb } from '../db/client.ts'
import { migrateUp } from '../db/migrate.ts'
import { getDailyParagraphForToday } from '../paragraphs/repository.ts'
import { PARAGRAPH_POOL } from '../paragraphs/pool-data.ts'
import { createEntry, DUEL_STAKE_LUNA, revealEntry } from './service.ts'
import type { HouseWallet, HouseWalletTransaction } from '../../services/escrow.ts'

process.env.DB_PATH = ':memory:'

const HOUSE_ADDRESS = 'NQ07 HOUS EAAA AAAA AAAA AAAA AAAA AAAA AAAA'
const PLAYER_ADDRESS = 'NQ07 PLAY ERAA AAAA AAAA AAAA AAAA AAAA AAAA'

function confirmedStakeTx(overrides: Partial<HouseWalletTransaction> = {}): HouseWalletTransaction {
  return {
    txHash: 'stake-tx-1',
    senderAddress: PLAYER_ADDRESS,
    recipientAddress: HOUSE_ADDRESS,
    valueLuna: DUEL_STAKE_LUNA,
    state: 'confirmed',
    confirmations: 5,
    ...overrides,
  }
}

function createFakeWallet(overrides: Partial<HouseWallet> = {}): HouseWallet & { getTransactionCalls: number } {
  let getTransactionCalls = 0
  return {
    address: HOUSE_ADDRESS,
    async getBalance() { return 5_000_000 },
    async send() {
      throw new Error('this test wallet should never need to send')
    },
    async getTransaction(txHash) {
      getTransactionCalls += 1
      return txHash === 'stake-tx-1' ? confirmedStakeTx() : null
    },
    async close() {},
    ...overrides,
    get getTransactionCalls() { return getTransactionCalls },
  }
}

function honestEventsFor(target: string, msPerChar = 100): { key: string, tRelativeMs: number, resultingLength: number }[] {
  return target.split('').map((char, i) => ({ key: char, tRelativeMs: i * msPerChar, resultingLength: i + 1 }))
}

let db: DatabaseSync

beforeEach(() => {
  closeDb()
  migrateUp()
  db = getDb()
  const insert = db.prepare('INSERT INTO paragraphs (id, body, difficulty, created_at) VALUES (?, ?, ?, ?)')
  const now = new Date().toISOString()
  for (const p of PARAGRAPH_POOL) insert.run(p.id, p.body, p.difficulty, now)
})

test('revealEntry verifies the stake and reveals today\'s daily paragraph', async () => {
  const wallet = createFakeWallet()
  const result = await revealEntry(db, wallet, { nimAddress: PLAYER_ADDRESS, stakeTxHash: 'stake-tx-1' })

  assert.equal(result.ok, true)
  if (!result.ok) return
  const today = getDailyParagraphForToday(db)
  assert.equal(result.paragraphId, today.id)
  assert.equal(result.paragraphBody, today.body)
})

test('revealEntry rejects when the stake transaction cannot be verified', async () => {
  const wallet = createFakeWallet({ async getTransaction() { return null } })
  const result = await revealEntry(db, wallet, { nimAddress: PLAYER_ADDRESS, stakeTxHash: 'does-not-exist' })
  assert.equal(result.ok, false)
})

test('revealEntry called twice with the same stakeTxHash does not re-check the chain', async () => {
  const wallet = createFakeWallet()
  await revealEntry(db, wallet, { nimAddress: PLAYER_ADDRESS, stakeTxHash: 'stake-tx-1' })
  await revealEntry(db, wallet, { nimAddress: PLAYER_ADDRESS, stakeTxHash: 'stake-tx-1' })
  assert.equal(wallet.getTransactionCalls, 1)
})

test('createEntry creates an OPEN entry and the result never contains a duration', async () => {
  const wallet = createFakeWallet()
  const today = getDailyParagraphForToday(db)
  const events = honestEventsFor(today.body)

  const result = await createEntry(db, wallet, { nimAddress: PLAYER_ADDRESS, stakeTxHash: 'stake-tx-1', events })

  assert.equal(result.ok, true)
  if (!result.ok) return
  assert.equal(result.status, 'OPEN')
  assert.ok(result.entryId)
  assert.ok(result.expiresAt)

  // Belt-and-suspenders on top of the type system: no key on the result
  // object even resembles a duration or timing value.
  const keys = Object.keys(result).join(',').toLowerCase()
  assert.ok(!keys.includes('duration'), `result keys leaked timing info: ${keys}`)

  const row = db.prepare('SELECT * FROM entries WHERE id = ?').get(result.entryId) as {
    status: string
    paragraph_id: string
    stake_luna: number
    stake_tx_hash: string
  }
  assert.equal(row.status, 'OPEN')
  assert.equal(row.paragraph_id, today.id)
  assert.equal(row.stake_luna, DUEL_STAKE_LUNA)
  assert.equal(row.stake_tx_hash, 'stake-tx-1')
})

test('createEntry rejects a run that does not match today\'s daily paragraph', async () => {
  const wallet = createFakeWallet()
  // Events spell out a completely different paragraph than what the server
  // would have revealed — even if the client claims a different paragraphId,
  // createEntry never trusts it; it independently re-derives today's paragraph.
  const events = honestEventsFor('this is definitely not the daily paragraph')

  const result = await createEntry(db, wallet, { nimAddress: PLAYER_ADDRESS, stakeTxHash: 'stake-tx-1', events })
  assert.equal(result.ok, false)

  const count = db.prepare('SELECT COUNT(*) c FROM entries').get() as { c: number }
  assert.equal(count.c, 0)
})

test('createEntry rejects when the stake cannot be verified, and creates no entry', async () => {
  const wallet = createFakeWallet({ async getTransaction() { return null } })
  const today = getDailyParagraphForToday(db)
  const events = honestEventsFor(today.body)

  const result = await createEntry(db, wallet, { nimAddress: PLAYER_ADDRESS, stakeTxHash: 'nope', events })
  assert.equal(result.ok, false)

  const count = db.prepare('SELECT COUNT(*) c FROM entries').get() as { c: number }
  assert.equal(count.c, 0)
})

test('createEntry is idempotent per stakeTxHash — a retried submit returns the same entry, not a second one', async () => {
  const wallet = createFakeWallet()
  const today = getDailyParagraphForToday(db)
  const events = honestEventsFor(today.body)
  const input = { nimAddress: PLAYER_ADDRESS, stakeTxHash: 'stake-tx-1', events }

  const first = await createEntry(db, wallet, input)
  const second = await createEntry(db, wallet, input)

  assert.deepEqual(first, second)
  const count = db.prepare('SELECT COUNT(*) c FROM entries').get() as { c: number }
  assert.equal(count.c, 1)
})

test('a stake with no completed submission creates no entry — closing the tab mid-run forfeits, it is not refunded', async () => {
  const wallet = createFakeWallet()

  // A stakes and the paragraph is revealed...
  const revealed = await revealEntry(db, wallet, { nimAddress: PLAYER_ADDRESS, stakeTxHash: 'stake-tx-1' })
  assert.equal(revealed.ok, true)

  // ...but A closes the tab and never calls createEntry.
  const entryCount = db.prepare('SELECT COUNT(*) c FROM entries').get() as { c: number }
  assert.equal(entryCount.c, 0, 'no entry should exist without a submitted run')

  // The stake was still real money that moved into the house wallet —
  // it's recorded, just with nothing to ever refund it automatically.
  const payout = db.prepare("SELECT * FROM payouts WHERE type = 'STAKE_RECEIVED'").get() as
    | { amount_luna: number, tx_hash: string }
    | undefined
  assert.ok(payout, 'the stake itself was still received and recorded')
  assert.equal(payout.amount_luna, DUEL_STAKE_LUNA)
  assert.equal(payout.tx_hash, 'stake-tx-1')

  // Phase 14's expiry/refund job only ever operates on `entries` rows —
  // with none here, there is nothing for it to find and refund.
})
