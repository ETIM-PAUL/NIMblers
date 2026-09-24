import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { beforeEach, test } from 'node:test'
import type { Db } from '../db/client.ts'
import { closeDb, getDb } from '../db/client.ts'
import { migrateUp } from '../db/migrate.ts'
import { getOrCreateUser } from '../db/users.ts'
import { DEFAULT_LEADERBOARD_LIMIT, getAllTimeLeaderboard, getLeaderboard, startOfWeekUtc } from './service.ts'

process.env.DB_PATH = ':memory:'

const ALICE = 'NQ07 ALIC EAAA AAAA AAAA AAAA AAAA AAAA AAAA'
const BOB = 'NQ07 BOBB AAAA AAAA AAAA AAAA AAAA AAAA AAAA'
const CAROL = 'NQ07 CARO LAAA AAAA AAAA AAAA AAAA AAAA AAAA'

let db: Db

async function insertPayout(
  userId: string,
  type: 'PAYOUT' | 'REFUND' | 'STAKE_RECEIVED',
  amountLuna: number,
  options: { fulfilled?: boolean, createdAt?: string } = {},
): Promise<void> {
  const fulfilled = options.fulfilled ?? true
  await db.execute({
    sql: `INSERT INTO payouts (id, idempotency_key, user_id, type, amount_luna, tx_hash, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    args: [randomUUID(), randomUUID(), userId, type, amountLuna, fulfilled ? `tx-${randomUUID()}` : null, options.createdAt ?? new Date().toISOString()],
  })
}

beforeEach(async () => {
  closeDb()
  await migrateUp()
  db = await getDb()
})

test('ranks players by total won, highest first', async () => {
  const alice = await getOrCreateUser(db, ALICE)
  const bob = await getOrCreateUser(db, BOB)
  await insertPayout(alice, 'PAYOUT', 180_000)
  await insertPayout(bob, 'PAYOUT', 900_000)

  const board = await getLeaderboard(db)

  assert.equal(board.length, 2)
  assert.deepEqual(board.map((e) => e.nimAddress), [BOB, ALICE])
  assert.equal(board[0].rank, 1)
  assert.equal(board[0].totalWonLuna, 900_000)
  assert.equal(board[1].rank, 2)
})

test('sums multiple wins for the same player', async () => {
  const alice = await getOrCreateUser(db, ALICE)
  await insertPayout(alice, 'PAYOUT', 180_000)
  await insertPayout(alice, 'PAYOUT', 540_000)

  const board = await getLeaderboard(db)

  assert.equal(board.length, 1)
  assert.equal(board[0].totalWonLuna, 720_000)
  assert.equal(board[0].wins, 2)
})

test('excludes stakes and refunds — only winnings count', async () => {
  const alice = await getOrCreateUser(db, ALICE)
  await insertPayout(alice, 'STAKE_RECEIVED', 100_000)
  await insertPayout(alice, 'REFUND', 100_000)

  const board = await getLeaderboard(db)

  assert.equal(board.length, 0, 'a player with only stakes/refunds has no winnings and should not appear')
})

test('excludes a payout that is claimed but not yet fulfilled', async () => {
  const alice = await getOrCreateUser(db, ALICE)
  await insertPayout(alice, 'PAYOUT', 180_000, { fulfilled: false })

  const board = await getLeaderboard(db)

  assert.equal(board.length, 0, 'an in-flight payout has not actually won anything yet')
})

test('respects the limit', async () => {
  const alice = await getOrCreateUser(db, ALICE)
  const bob = await getOrCreateUser(db, BOB)
  const carol = await getOrCreateUser(db, CAROL)
  await insertPayout(alice, 'PAYOUT', 100_000)
  await insertPayout(bob, 'PAYOUT', 200_000)
  await insertPayout(carol, 'PAYOUT', 300_000)

  const board = await getLeaderboard(db, 2)

  assert.equal(board.length, 2)
  assert.deepEqual(board.map((e) => e.nimAddress), [CAROL, BOB])
})

test('an empty leaderboard is an empty array, not an error', async () => {
  assert.deepEqual(await getLeaderboard(db), [])
})

// --- Weekly reset ---

test('startOfWeekUtc finds Monday 00:00:00 UTC for any day in that week', () => {
  const monday = '2026-01-05T00:00:00.000Z'
  assert.equal(startOfWeekUtc(new Date('2026-01-07T15:30:00Z')).toISOString(), monday, 'a midweek Wednesday')
  assert.equal(startOfWeekUtc(new Date('2026-01-11T23:59:59Z')).toISOString(), monday, 'the last instant of Sunday, still the same week')
  assert.equal(startOfWeekUtc(new Date(monday)).toISOString(), monday, 'Monday itself, already at the reset instant')
})

test('startOfWeekUtc rolls over to the next Monday right after Sunday 23:59:59 UTC', () => {
  assert.equal(startOfWeekUtc(new Date('2026-01-12T00:00:00.000Z')).toISOString(), '2026-01-12T00:00:00.000Z')
})

test('getLeaderboard only counts winnings from the current week — last week\'s wins have already reset off the board', async () => {
  const alice = await getOrCreateUser(db, ALICE)
  const now = new Date('2026-01-07T12:00:00Z') // a Wednesday
  await insertPayout(alice, 'PAYOUT', 500_000, { createdAt: '2026-01-04T23:59:59.000Z' }) // last week (Sunday, just before reset)
  await insertPayout(alice, 'PAYOUT', 100_000, { createdAt: '2026-01-05T00:00:00.000Z' }) // this week (Monday, right at reset)

  const board = await getLeaderboard(db, DEFAULT_LEADERBOARD_LIMIT, now)

  assert.equal(board.length, 1)
  assert.equal(board[0].totalWonLuna, 100_000, 'only this week\'s win should count')
  assert.equal(board[0].wins, 1)
})

test('getLeaderboard drops a player entirely once all their wins are from a prior week', async () => {
  const alice = await getOrCreateUser(db, ALICE)
  await insertPayout(alice, 'PAYOUT', 500_000, { createdAt: '2026-01-04T12:00:00.000Z' })

  const board = await getLeaderboard(db, DEFAULT_LEADERBOARD_LIMIT, new Date('2026-01-07T12:00:00Z'))

  assert.deepEqual(board, [])
})

// --- All-time ---

test('getAllTimeLeaderboard includes a win no matter how long ago it settled', async () => {
  const alice = await getOrCreateUser(db, ALICE)
  await insertPayout(alice, 'PAYOUT', 500_000, { createdAt: '2020-01-01T00:00:00.000Z' })

  const board = await getAllTimeLeaderboard(db)

  assert.equal(board.length, 1)
  assert.equal(board[0].totalWonLuna, 500_000)
})

test('getAllTimeLeaderboard sums wins across every week, not just the current one', async () => {
  const alice = await getOrCreateUser(db, ALICE)
  await insertPayout(alice, 'PAYOUT', 500_000, { createdAt: '2020-01-01T00:00:00.000Z' })
  await insertPayout(alice, 'PAYOUT', 100_000, { createdAt: new Date().toISOString() })

  const board = await getAllTimeLeaderboard(db)

  assert.equal(board.length, 1)
  assert.equal(board[0].totalWonLuna, 600_000)
  assert.equal(board[0].wins, 2)
})

test('getAllTimeLeaderboard still excludes stakes, refunds, and unfulfilled payouts', async () => {
  const alice = await getOrCreateUser(db, ALICE)
  await insertPayout(alice, 'STAKE_RECEIVED', 100_000, { createdAt: '2020-01-01T00:00:00.000Z' })
  await insertPayout(alice, 'REFUND', 100_000, { createdAt: '2020-01-01T00:00:00.000Z' })
  await insertPayout(alice, 'PAYOUT', 100_000, { createdAt: '2020-01-01T00:00:00.000Z', fulfilled: false })

  assert.deepEqual(await getAllTimeLeaderboard(db), [])
})
