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

let server: Server
let baseUrl: string

before(async () => {
  closeDb()
  migrateUp()
  const router = createRouter()
  registerLeaderboardRoutes(router)
  server = router.server
  await new Promise<void>((resolve) => server.listen(0, resolve))
  const { port } = server.address() as AddressInfo
  baseUrl = `http://localhost:${port}`
})

beforeEach(() => {
  const db = getDb()
  db.prepare('DELETE FROM payouts').run()
  db.prepare('DELETE FROM users').run()

  const alice = getOrCreateUser(db, ALICE)
  const bob = getOrCreateUser(db, BOB)
  const now = new Date().toISOString()
  db.prepare(
    `INSERT INTO payouts (id, idempotency_key, user_id, type, amount_luna, tx_hash, created_at)
     VALUES (?, ?, ?, 'PAYOUT', ?, ?, ?)`,
  ).run(randomUUID(), randomUUID(), alice, 180_000, `tx-${randomUUID()}`, now)
  db.prepare(
    `INSERT INTO payouts (id, idempotency_key, user_id, type, amount_luna, tx_hash, created_at)
     VALUES (?, ?, ?, 'PAYOUT', ?, ?, ?)`,
  ).run(randomUUID(), randomUUID(), bob, 900_000, `tx-${randomUUID()}`, now)
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
