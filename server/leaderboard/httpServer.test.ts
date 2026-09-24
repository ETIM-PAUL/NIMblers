import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { after, before, beforeEach, test } from 'node:test'
import type { AddressInfo } from 'node:net'
import type { Server } from 'node:http'
import { closeDb, getDb } from '../db/client.ts'
import { migrateUp } from '../db/migrate.ts'
import { getOrCreateUser } from '../db/users.ts'
import { createRouter } from '../http/router.ts'
import { registerLeaderboardRoutes } from './httpServer.ts'

process.env.DB_PATH = ':memory:'

const ALICE = 'NQ07 ALIC EAAA AAAA AAAA AAAA AAAA AAAA AAAA'
const BOB = 'NQ07 BOBB AAAA AAAA AAAA AAAA AAAA AAAA AAAA'
const CAROL = 'NQ07 CARO LAAA AAAA AAAA AAAA AAAA AAAA AAAA'

let server: Server
let baseUrl: string

before(async () => {
  closeDb()
  await migrateUp()
  const router = createRouter()
  registerLeaderboardRoutes(router)
  server = router.server
  await new Promise<void>((resolve) => server.listen(0, resolve))
  const { port } = server.address() as AddressInfo
  baseUrl = `http://localhost:${port}`
})

beforeEach(async () => {
  const db = await getDb()
  await db.execute('DELETE FROM payouts')
  await db.execute('DELETE FROM users')

  const alice = await getOrCreateUser(db, ALICE)
  const bob = await getOrCreateUser(db, BOB)
  const now = new Date().toISOString()
  await db.execute({
    sql: `INSERT INTO payouts (id, idempotency_key, user_id, type, amount_luna, tx_hash, created_at)
     VALUES (?, ?, ?, 'PAYOUT', ?, ?, ?)`,
    args: [randomUUID(), randomUUID(), alice, 180_000, `tx-${randomUUID()}`, now],
  })
  await db.execute({
    sql: `INSERT INTO payouts (id, idempotency_key, user_id, type, amount_luna, tx_hash, created_at)
     VALUES (?, ?, ?, 'PAYOUT', ?, ?, ?)`,
    args: [randomUUID(), randomUUID(), bob, 900_000, `tx-${randomUUID()}`, now],
  })
})

after(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()))
  closeDb()
})

test('GET /api/leaderboard returns players ranked by total won', async () => {
  const res = await fetch(`${baseUrl}/api/leaderboard`)
  assert.equal(res.status, 200)
  const body = (await res.json()) as { leaderboard: { rank: number, nimAddress: string, totalWonLuna: number, wins: number }[] }

  assert.equal(body.leaderboard.length, 2)
  assert.equal(body.leaderboard[0].nimAddress, BOB)
  assert.equal(body.leaderboard[0].rank, 1)
  assert.equal(body.leaderboard[0].totalWonLuna, 900_000)
  assert.equal(body.leaderboard[1].nimAddress, ALICE)
})

test('GET /api/leaderboard?limit=1 respects the limit', async () => {
  const res = await fetch(`${baseUrl}/api/leaderboard?limit=1`)
  const body = (await res.json()) as { leaderboard: unknown[] }
  assert.equal(body.leaderboard.length, 1)
})

test('GET /api/leaderboard ignores a bogus limit and falls back to the default', async () => {
  const res = await fetch(`${baseUrl}/api/leaderboard?limit=not-a-number`)
  assert.equal(res.status, 200)
  const body = (await res.json()) as { leaderboard: unknown[] }
  assert.equal(body.leaderboard.length, 2)
})

test('GET /api/leaderboard/all-time includes a win from long before this week, which the weekly board excludes', async () => {
  const db = await getDb()
  const carol = await getOrCreateUser(db, CAROL)
  await db.execute({
    sql: `INSERT INTO payouts (id, idempotency_key, user_id, type, amount_luna, tx_hash, created_at)
     VALUES (?, ?, ?, 'PAYOUT', ?, ?, ?)`,
    args: [randomUUID(), randomUUID(), carol, 50_000, `tx-${randomUUID()}`, '2020-01-01T00:00:00.000Z'],
  })

  const weeklyRes = await fetch(`${baseUrl}/api/leaderboard`)
  const weeklyBody = (await weeklyRes.json()) as { leaderboard: { nimAddress: string }[] }
  assert.ok(!weeklyBody.leaderboard.some((e) => e.nimAddress === CAROL), 'the weekly board should not include a win from 2020')

  const allTimeRes = await fetch(`${baseUrl}/api/leaderboard/all-time`)
  assert.equal(allTimeRes.status, 200)
  const allTimeBody = (await allTimeRes.json()) as { leaderboard: { nimAddress: string, totalWonLuna: number }[] }
  assert.equal(allTimeBody.leaderboard.length, 3)
  const carolEntry = allTimeBody.leaderboard.find((e) => e.nimAddress === CAROL)
  assert.ok(carolEntry, 'the all-time board should include the 2020 win')
  assert.equal(carolEntry.totalWonLuna, 50_000)
})

test('GET /api/leaderboard/all-time?limit=1 respects the limit', async () => {
  const res = await fetch(`${baseUrl}/api/leaderboard/all-time?limit=1`)
  const body = (await res.json()) as { leaderboard: unknown[] }
  assert.equal(body.leaderboard.length, 1)
})
