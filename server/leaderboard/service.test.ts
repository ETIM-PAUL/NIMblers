import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { beforeEach, test } from 'node:test'
import type { DatabaseSync } from 'node:sqlite'
import { closeDb, getDb } from '../db/client.ts'
import { migrateUp } from '../db/migrate.ts'
import { getOrCreateUser } from '../db/users.ts'
import { getLeaderboard } from './service.ts'

process.env.DB_PATH = ':memory:'

const ALICE = 'NQ07 ALIC EAAA AAAA AAAA AAAA AAAA AAAA AAAA'
const BOB = 'NQ07 BOBB AAAA AAAA AAAA AAAA AAAA AAAA AAAA'
const CAROL = 'NQ07 CARO LAAA AAAA AAAA AAAA AAAA AAAA AAAA'

let db: DatabaseSync

function insertPayout(userId: string, type: 'PAYOUT' | 'REFUND' | 'STAKE_RECEIVED', amountLuna: number, options: { fulfilled?: boolean } = {}): void {
  const fulfilled = options.fulfilled ?? true
  db.prepare(
    `INSERT INTO payouts (id, idempotency_key, user_id, type, amount_luna, tx_hash, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(randomUUID(), randomUUID(), userId, type, amountLuna, fulfilled ? `tx-${randomUUID()}` : null, new Date().toISOString())
}

beforeEach(() => {
  closeDb()
  migrateUp()
  db = getDb()
})

test('ranks players by total won, highest first', () => {
  const alice = getOrCreateUser(db, ALICE)
  const bob = getOrCreateUser(db, BOB)
  insertPayout(alice, 'PAYOUT', 180_000)
  insertPayout(bob, 'PAYOUT', 900_000)

  const board = getLeaderboard(db)

  assert.equal(board.length, 2)
  assert.deepEqual(board.map((e) => e.nimAddress), [BOB, ALICE])
  assert.equal(board[0].rank, 1)
  assert.equal(board[0].totalWonLuna, 900_000)
  assert.equal(board[1].rank, 2)
})

test('sums multiple wins for the same player', () => {
  const alice = getOrCreateUser(db, ALICE)
  insertPayout(alice, 'PAYOUT', 180_000)
  insertPayout(alice, 'PAYOUT', 540_000)

  const board = getLeaderboard(db)

  assert.equal(board.length, 1)
  assert.equal(board[0].totalWonLuna, 720_000)
  assert.equal(board[0].wins, 2)
})

test('excludes stakes and refunds — only winnings count', () => {
  const alice = getOrCreateUser(db, ALICE)
  insertPayout(alice, 'STAKE_RECEIVED', 100_000)
  insertPayout(alice, 'REFUND', 100_000)

  const board = getLeaderboard(db)

  assert.equal(board.length, 0, 'a player with only stakes/refunds has no winnings and should not appear')
})

test('excludes a payout that is claimed but not yet fulfilled', () => {
  const alice = getOrCreateUser(db, ALICE)
  insertPayout(alice, 'PAYOUT', 180_000, { fulfilled: false })

  const board = getLeaderboard(db)

  assert.equal(board.length, 0, 'an in-flight payout has not actually won anything yet')
})

test('respects the limit', () => {
  const alice = getOrCreateUser(db, ALICE)
  const bob = getOrCreateUser(db, BOB)
  const carol = getOrCreateUser(db, CAROL)
  insertPayout(alice, 'PAYOUT', 100_000)
  insertPayout(bob, 'PAYOUT', 200_000)
  insertPayout(carol, 'PAYOUT', 300_000)

  const board = getLeaderboard(db, 2)

  assert.equal(board.length, 2)
  assert.deepEqual(board.map((e) => e.nimAddress), [CAROL, BOB])
})

test('an empty leaderboard is an empty array, not an error', () => {
  assert.deepEqual(getLeaderboard(db), [])
})
