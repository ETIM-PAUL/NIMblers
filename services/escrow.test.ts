import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { beforeEach, test } from 'node:test'
import type { DatabaseSync } from 'node:sqlite'
import { closeDb, getDb } from '../server/db/client.ts'
import { migrateUp } from '../server/db/migrate.ts'
import { getBalance, payout, receiveStake, refund } from './escrow.ts'
import type { HouseWallet, HouseWalletTransaction } from './escrow.ts'

process.env.DB_PATH = ':memory:'

const HOUSE_ADDRESS = 'NQ07 HOUS EAAA AAAA AAAA AAAA AAAA AAAA AAAA'
const PLAYER_ADDRESS = 'NQ07 PLAY ERAA AAAA AAAA AAAA AAAA AAAA AAAA'

function createFakeWallet(overrides: Partial<HouseWallet> = {}): HouseWallet & { sentCalls: { recipient: string, valueLuna: number }[] } {
  const sentCalls: { recipient: string, valueLuna: number }[] = []
  let txCounter = 0

  const base: HouseWallet = {
    address: HOUSE_ADDRESS,
    async getBalance() {
      return 5_000_000
    },
    async send(recipient, valueLuna) {
      sentCalls.push({ recipient, valueLuna })
      txCounter += 1
      return {
        txHash: `fake-tx-${txCounter}`,
        senderAddress: HOUSE_ADDRESS,
        recipientAddress: recipient,
        valueLuna,
        state: 'confirmed',
        confirmations: 10,
      }
    },
    async getTransaction() {
      return null
    },
    async close() {},
  }

  return Object.assign({ ...base, ...overrides }, { sentCalls })
}

let db: DatabaseSync
let userId: string

beforeEach(() => {
  closeDb()
  migrateUp()
  db = getDb()
  userId = randomUUID()
  db.prepare('INSERT INTO users (id, nim_address, created_at) VALUES (?, ?, ?)').run(
    userId,
    PLAYER_ADDRESS,
    new Date().toISOString(),
  )
})

test('getBalance delegates to the wallet', async () => {
  const wallet = createFakeWallet({ async getBalance() { return 42 } })
  assert.equal(await getBalance(wallet), 42)
})

test('payout sends once and persists a PAYOUT row', async () => {
  const wallet = createFakeWallet()
  const record = await payout(db, wallet, {
    idempotencyKey: 'payout-1',
    userId,
    recipientAddress: PLAYER_ADDRESS,
    valueLuna: 180_000,
  })

  assert.equal(record.type, 'PAYOUT')
  assert.equal(record.amountLuna, 180_000)
  assert.ok(record.txHash)
  assert.equal(wallet.sentCalls.length, 1)

  const row = db.prepare('SELECT * FROM payouts WHERE id = ?').get(record.id) as { type: string, tx_hash: string }
  assert.equal(row.type, 'PAYOUT')
  assert.equal(row.tx_hash, record.txHash)
})

test('calling payout twice with the same idempotency key pays once', async () => {
  const wallet = createFakeWallet()
  const input = { idempotencyKey: 'same-key', userId, recipientAddress: PLAYER_ADDRESS, valueLuna: 100_000 }

  const first = await payout(db, wallet, input)
  const second = await payout(db, wallet, input)

  assert.deepEqual(first, second)
  assert.equal(wallet.sentCalls.length, 1, 'the wallet should only ever be asked to send once')

  const count = db.prepare('SELECT COUNT(*) c FROM payouts WHERE idempotency_key = ?').get('same-key') as { c: number }
  assert.equal(count.c, 1)
})

test('payout with different idempotency keys sends twice', async () => {
  const wallet = createFakeWallet()
  await payout(db, wallet, { idempotencyKey: 'key-a', userId, recipientAddress: PLAYER_ADDRESS, valueLuna: 50_000 })
  await payout(db, wallet, { idempotencyKey: 'key-b', userId, recipientAddress: PLAYER_ADDRESS, valueLuna: 50_000 })
  assert.equal(wallet.sentCalls.length, 2)
})

test('refund behaves like payout but records type REFUND', async () => {
  const wallet = createFakeWallet()
  const input = { idempotencyKey: 'refund-key', userId, recipientAddress: PLAYER_ADDRESS, valueLuna: 200_000 }

  const first = await refund(db, wallet, input)
  const second = await refund(db, wallet, input)

  assert.equal(first.type, 'REFUND')
  assert.deepEqual(first, second)
  assert.equal(wallet.sentCalls.length, 1)
})

test('a claimed-but-not-yet-fulfilled key rejects a second concurrent call instead of sending', async () => {
  // Simulate a claim that's in flight (e.g. a real concurrent retry that
  // won the race to INSERT): a payouts row with no tx_hash yet.
  db.prepare(
    `INSERT INTO payouts (id, idempotency_key, user_id, type, amount_luna, tx_hash, created_at)
     VALUES (?, ?, ?, 'PAYOUT', ?, NULL, ?)`,
  ).run(randomUUID(), 'in-flight-key', userId, 100_000, new Date().toISOString())

  const wallet = createFakeWallet()
  await assert.rejects(
    () => payout(db, wallet, { idempotencyKey: 'in-flight-key', userId, recipientAddress: PLAYER_ADDRESS, valueLuna: 100_000 }),
    /already claimed but not yet fulfilled/,
  )
  assert.equal(wallet.sentCalls.length, 0, 'must not send while another claim on the same key is in flight')
})

function confirmedTx(overrides: Partial<HouseWalletTransaction> = {}): HouseWalletTransaction {
  return {
    txHash: 'stake-tx-1',
    senderAddress: PLAYER_ADDRESS,
    recipientAddress: HOUSE_ADDRESS,
    valueLuna: 200_000,
    state: 'confirmed',
    confirmations: 5,
    ...overrides,
  }
}

test('receiveStake records a stake once the chain independently confirms it', async () => {
  const tx = confirmedTx()
  const wallet = createFakeWallet({ async getTransaction() { return tx } })

  const record = await receiveStake(db, wallet, {
    idempotencyKey: 'stake-1',
    userId,
    fromAddress: PLAYER_ADDRESS,
    valueLuna: 200_000,
    txHash: tx.txHash,
  })

  assert.equal(record.type, 'STAKE_RECEIVED')
  assert.equal(record.txHash, tx.txHash)
})

test('receiveStake calling twice with the same key only checks the chain once', async () => {
  let getTransactionCalls = 0
  const tx = confirmedTx()
  const wallet = createFakeWallet({
    async getTransaction() {
      getTransactionCalls += 1
      return tx
    },
  })
  const input = { idempotencyKey: 'stake-dup', userId, fromAddress: PLAYER_ADDRESS, valueLuna: 200_000, txHash: tx.txHash }

  const first = await receiveStake(db, wallet, input)
  const second = await receiveStake(db, wallet, input)

  assert.deepEqual(first, second)
  assert.equal(getTransactionCalls, 1)
})

test('receiveStake rejects a transaction that does not exist', async () => {
  const wallet = createFakeWallet({ async getTransaction() { return null } })
  await assert.rejects(
    () => receiveStake(db, wallet, { idempotencyKey: 's1', userId, fromAddress: PLAYER_ADDRESS, valueLuna: 1000, txHash: 'nope' }),
    /not found/,
  )
})

test('receiveStake rejects a transaction not sent to the house wallet', async () => {
  const tx = confirmedTx({ recipientAddress: 'NQ99 SOME ONEE LSEA DDRE SSAA AAAA AAAA AAAA' })
  const wallet = createFakeWallet({ async getTransaction() { return tx } })
  await assert.rejects(
    () => receiveStake(db, wallet, { idempotencyKey: 's2', userId, fromAddress: PLAYER_ADDRESS, valueLuna: 200_000, txHash: tx.txHash }),
    /not sent to the house wallet/,
  )
})

test('receiveStake rejects a sender address that does not match the claim', async () => {
  const tx = confirmedTx({ senderAddress: 'NQ99 SOME ONEE LSEA DDRE SSAA AAAA AAAA AAAA' })
  const wallet = createFakeWallet({ async getTransaction() { return tx } })
  await assert.rejects(
    () => receiveStake(db, wallet, { idempotencyKey: 's3', userId, fromAddress: PLAYER_ADDRESS, valueLuna: 200_000, txHash: tx.txHash }),
    /sender does not match/,
  )
})

test('receiveStake rejects a value lower than claimed', async () => {
  const tx = confirmedTx({ valueLuna: 100_000 })
  const wallet = createFakeWallet({ async getTransaction() { return tx } })
  await assert.rejects(
    () => receiveStake(db, wallet, { idempotencyKey: 's4', userId, fromAddress: PLAYER_ADDRESS, valueLuna: 200_000, txHash: tx.txHash }),
    /value is less than/,
  )
})

test('receiveStake rejects an unconfirmed transaction', async () => {
  const tx = confirmedTx({ state: 'pending' })
  const wallet = createFakeWallet({ async getTransaction() { return tx } })
  await assert.rejects(
    () => receiveStake(db, wallet, { idempotencyKey: 's5', userId, fromAddress: PLAYER_ADDRESS, valueLuna: 200_000, txHash: tx.txHash }),
    /not yet confirmed/,
  )
})

test('a failed claim releases the idempotency key so a corrected retry can succeed', async () => {
  let shouldFail = true
  const tx = confirmedTx()
  const wallet = createFakeWallet({
    async getTransaction() {
      return shouldFail ? null : tx
    },
  })
  const input = { idempotencyKey: 'retry-key', userId, fromAddress: PLAYER_ADDRESS, valueLuna: 200_000, txHash: tx.txHash }

  await assert.rejects(() => receiveStake(db, wallet, input), /not found/)

  const afterFailure = db.prepare('SELECT COUNT(*) c FROM payouts WHERE idempotency_key = ?').get('retry-key') as { c: number }
  assert.equal(afterFailure.c, 0, 'a failed claim must not leave a stuck row behind')

  shouldFail = false
  const record = await receiveStake(db, wallet, input)
  assert.equal(record.type, 'STAKE_RECEIVED')
})
