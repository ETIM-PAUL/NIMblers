import assert from 'node:assert/strict'
import { beforeEach, test } from 'node:test'
import type { DatabaseSync } from 'node:sqlite'
import { closeDb, getDb } from '../db/client.ts'
import { migrateUp } from '../db/migrate.ts'
import { createEntry, DUEL_STAKE_LUNA_BY_DIFFICULTY, revealEntry } from './service.ts'
import type { HouseWallet, HouseWalletTransaction } from '../../services/escrow.ts'

process.env.DB_PATH = ':memory:'

const HOUSE_ADDRESS = 'NQ07 HOUS EAAA AAAA AAAA AAAA AAAA AAAA AAAA'
const PLAYER_ADDRESS = 'NQ07 PLAY ERAA AAAA AAAA AAAA AAAA AAAA AAAA'

function confirmedStakeTx(overrides: Partial<HouseWalletTransaction> = {}): HouseWalletTransaction {
  return {
    txHash: 'stake-tx-1',
    senderAddress: PLAYER_ADDRESS,
    recipientAddress: HOUSE_ADDRESS,
    valueLuna: DUEL_STAKE_LUNA_BY_DIFFICULTY.easy,
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

/** Reveals (staking with the given wallet/difficulty), asserts it worked, and returns the paragraph the player was actually shown — the only way to know it in advance, by design. */
async function revealParagraph(
  db: DatabaseSync,
  wallet: HouseWallet,
  input: { stakeTxHash: string, difficulty: 'easy' | 'medium' | 'hard' },
): Promise<{ paragraphId: string, paragraphBody: string }> {
  const revealed = await revealEntry(db, wallet, { nimAddress: PLAYER_ADDRESS, ...input })
  assert.equal(revealed.ok, true, 'setup: reveal must succeed')
  if (!revealed.ok) throw new Error('unreachable')
  return revealed
}

let db: DatabaseSync

beforeEach(() => {
  closeDb()
  migrateUp()
  db = getDb()
})

test('revealEntry verifies the stake and generates a fresh paragraph for that difficulty', async () => {
  const wallet = createFakeWallet()
  const result = await revealEntry(db, wallet, { nimAddress: PLAYER_ADDRESS, stakeTxHash: 'stake-tx-1', difficulty: 'easy' })

  assert.equal(result.ok, true)
  if (!result.ok) return
  assert.ok(result.paragraphId)
  assert.ok(result.paragraphBody.length > 0)
})

test('revealEntry is idempotent per stakeTxHash — a retry sees the same paragraph, not a freshly generated different one', async () => {
  const wallet = createFakeWallet()
  const first = await revealEntry(db, wallet, { nimAddress: PLAYER_ADDRESS, stakeTxHash: 'stake-tx-1', difficulty: 'easy' })
  const second = await revealEntry(db, wallet, { nimAddress: PLAYER_ADDRESS, stakeTxHash: 'stake-tx-1', difficulty: 'easy' })
  assert.deepEqual(first, second)
})

test('two different stakes reveal two different paragraphs — nothing is guessable in advance from an earlier duel', async () => {
  const wallet = createFakeWallet({
    async getTransaction(txHash) {
      return txHash === 'stake-tx-1' || txHash === 'stake-tx-2' ? confirmedStakeTx({ txHash }) : null
    },
  })
  const first = await revealEntry(db, wallet, { nimAddress: PLAYER_ADDRESS, stakeTxHash: 'stake-tx-1', difficulty: 'easy' })
  const second = await revealEntry(db, wallet, { nimAddress: PLAYER_ADDRESS, stakeTxHash: 'stake-tx-2', difficulty: 'easy' })
  assert.equal(first.ok, true)
  assert.equal(second.ok, true)
  if (!first.ok || !second.ok) return
  assert.notEqual(first.paragraphId, second.paragraphId)
  assert.notEqual(first.paragraphBody, second.paragraphBody)
})

test('revealEntry rejects when the stake amount does not match the difficulty tier', async () => {
  // Claims "hard" (5 NIM) but the on-chain transaction only carries the
  // easy tier's 1 NIM.
  const wallet = createFakeWallet()
  const result = await revealEntry(db, wallet, { nimAddress: PLAYER_ADDRESS, stakeTxHash: 'stake-tx-1', difficulty: 'hard' })
  assert.equal(result.ok, false)
})

test('revealEntry rejects when the stake transaction cannot be verified', async () => {
  const wallet = createFakeWallet({ async getTransaction() { return null } })
  const result = await revealEntry(db, wallet, { nimAddress: PLAYER_ADDRESS, stakeTxHash: 'does-not-exist', difficulty: 'easy' })
  assert.equal(result.ok, false)
})

test('revealEntry called twice with the same stakeTxHash does not re-check the chain', async () => {
  const wallet = createFakeWallet()
  await revealEntry(db, wallet, { nimAddress: PLAYER_ADDRESS, stakeTxHash: 'stake-tx-1', difficulty: 'easy' })
  await revealEntry(db, wallet, { nimAddress: PLAYER_ADDRESS, stakeTxHash: 'stake-tx-1', difficulty: 'easy' })
  assert.equal(wallet.getTransactionCalls, 1)
})

test('createEntry creates an OPEN entry at the tier\'s stake amount, and the result never contains a duration', async () => {
  const wallet = createFakeWallet({
    async getTransaction(txHash) {
      return txHash === 'stake-tx-1' ? confirmedStakeTx({ valueLuna: DUEL_STAKE_LUNA_BY_DIFFICULTY.medium }) : null
    },
  })
  const revealed = await revealParagraph(db, wallet, { stakeTxHash: 'stake-tx-1', difficulty: 'medium' })
  const events = honestEventsFor(revealed.paragraphBody)

  const result = await createEntry(db, wallet, { nimAddress: PLAYER_ADDRESS, stakeTxHash: 'stake-tx-1', difficulty: 'medium', events })

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
  assert.equal(row.paragraph_id, revealed.paragraphId)
  assert.equal(row.stake_luna, DUEL_STAKE_LUNA_BY_DIFFICULTY.medium)
  assert.equal(row.stake_tx_hash, 'stake-tx-1')
})

test('each difficulty tier requires its own stake amount', async () => {
  for (const difficulty of ['easy', 'medium', 'hard'] as const) {
    const wallet = createFakeWallet({
      async getTransaction(txHash) {
        return txHash === `stake-${difficulty}`
          ? confirmedStakeTx({ txHash: `stake-${difficulty}`, valueLuna: DUEL_STAKE_LUNA_BY_DIFFICULTY[difficulty] })
          : null
      },
    })
    const revealed = await revealParagraph(db, wallet, { stakeTxHash: `stake-${difficulty}`, difficulty })
    const result = await createEntry(db, wallet, {
      nimAddress: PLAYER_ADDRESS,
      stakeTxHash: `stake-${difficulty}`,
      difficulty,
      events: honestEventsFor(revealed.paragraphBody),
    })
    assert.equal(result.ok, true, `${difficulty} entry should be created with its own ${DUEL_STAKE_LUNA_BY_DIFFICULTY[difficulty]} Luna stake`)
    if (!result.ok) continue
    const row = db.prepare('SELECT stake_luna FROM entries WHERE id = ?').get(result.entryId) as { stake_luna: number }
    assert.equal(row.stake_luna, DUEL_STAKE_LUNA_BY_DIFFICULTY[difficulty])
  }
})

test('createEntry rejects a run that does not match the paragraph generated for this stake', async () => {
  const wallet = createFakeWallet()
  await revealParagraph(db, wallet, { stakeTxHash: 'stake-tx-1', difficulty: 'easy' })
  // Events spell out completely different text than what was revealed —
  // even if the client claims a different paragraphId, createEntry never
  // trusts it; it independently re-derives the paragraph for this stake.
  const events = honestEventsFor('this is definitely not the revealed paragraph')

  const result = await createEntry(db, wallet, { nimAddress: PLAYER_ADDRESS, stakeTxHash: 'stake-tx-1', difficulty: 'easy', events })
  assert.equal(result.ok, false)

  const count = db.prepare('SELECT COUNT(*) c FROM entries').get() as { c: number }
  assert.equal(count.c, 0)
})

test('createEntry rejects when the stake cannot be verified, and creates no entry', async () => {
  const wallet = createFakeWallet({ async getTransaction() { return null } })
  const events = honestEventsFor('anything, since the stake never verifies')

  const result = await createEntry(db, wallet, { nimAddress: PLAYER_ADDRESS, stakeTxHash: 'nope', difficulty: 'easy', events })
  assert.equal(result.ok, false)

  const count = db.prepare('SELECT COUNT(*) c FROM entries').get() as { c: number }
  assert.equal(count.c, 0)
})

test('createEntry is idempotent per stakeTxHash — a retried submit returns the same entry, not a second one', async () => {
  const wallet = createFakeWallet()
  const revealed = await revealParagraph(db, wallet, { stakeTxHash: 'stake-tx-1', difficulty: 'easy' })
  const events = honestEventsFor(revealed.paragraphBody)
  const input = { nimAddress: PLAYER_ADDRESS, stakeTxHash: 'stake-tx-1', difficulty: 'easy' as const, events }

  const first = await createEntry(db, wallet, input)
  const second = await createEntry(db, wallet, input)

  assert.deepEqual(first, second)
  const count = db.prepare('SELECT COUNT(*) c FROM entries').get() as { c: number }
  assert.equal(count.c, 1)
})

test('createEntry defaults to PUBLIC when visibility is not specified', async () => {
  const wallet = createFakeWallet()
  const revealed = await revealParagraph(db, wallet, { stakeTxHash: 'stake-tx-1', difficulty: 'easy' })
  const result = await createEntry(db, wallet, {
    nimAddress: PLAYER_ADDRESS,
    stakeTxHash: 'stake-tx-1',
    difficulty: 'easy',
    events: honestEventsFor(revealed.paragraphBody),
  })

  assert.equal(result.ok, true)
  if (!result.ok) return
  assert.equal(result.visibility, 'PUBLIC')
  const row = db.prepare('SELECT visibility FROM entries WHERE id = ?').get(result.entryId) as { visibility: string }
  assert.equal(row.visibility, 'PUBLIC')
})

test('createEntry stores PRIVATE when the caller asks for it', async () => {
  const wallet = createFakeWallet()
  const revealed = await revealParagraph(db, wallet, { stakeTxHash: 'stake-tx-1', difficulty: 'easy' })
  const result = await createEntry(db, wallet, {
    nimAddress: PLAYER_ADDRESS,
    stakeTxHash: 'stake-tx-1',
    difficulty: 'easy',
    events: honestEventsFor(revealed.paragraphBody),
    visibility: 'PRIVATE',
  })

  assert.equal(result.ok, true)
  if (!result.ok) return
  assert.equal(result.visibility, 'PRIVATE')
  const row = db.prepare('SELECT visibility FROM entries WHERE id = ?').get(result.entryId) as { visibility: string }
  assert.equal(row.visibility, 'PRIVATE')
})

test('a stake with no completed submission creates no entry — closing the tab mid-run forfeits, it is not refunded', async () => {
  const wallet = createFakeWallet()

  // A stakes and the paragraph is revealed...
  const revealed = await revealEntry(db, wallet, { nimAddress: PLAYER_ADDRESS, stakeTxHash: 'stake-tx-1', difficulty: 'easy' })
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
  assert.equal(payout.amount_luna, DUEL_STAKE_LUNA_BY_DIFFICULTY.easy)
  assert.equal(payout.tx_hash, 'stake-tx-1')

  // Phase 14's expiry/refund job only ever operates on `entries` rows —
  // with none here, there is nothing for it to find and refund.
})
