import assert from 'node:assert/strict'
import { after, before, beforeEach, test } from 'node:test'
import type { AddressInfo } from 'node:net'
import type { Server } from 'node:http'
import { closeDb, getDb } from '../db/client.ts'
import { migrateUp } from '../db/migrate.ts'
import { getDailyParagraphForToday } from '../paragraphs/repository.ts'
import { PARAGRAPH_POOL } from '../paragraphs/pool-data.ts'
import { createRouter } from '../http/router.ts'
import { registerEntryRoutes } from './httpServer.ts'
import { setHouseWalletFactoryForTesting, setHouseWalletForTesting } from './houseWallet.ts'
import { DUEL_STAKE_LUNA } from './service.ts'
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

function fakeWallet(): HouseWallet {
  return {
    address: HOUSE_ADDRESS,
    async getBalance() { return 5_000_000 },
    async send() { throw new Error('should not send in this test') },
    async getTransaction(txHash) {
      return txHash === 'nonexistent' ? null : confirmedStakeTx({ txHash })
    },
    async close() {},
  }
}

let server: Server
let baseUrl: string

before(async () => {
  closeDb()
  migrateUp()
  const insert = getDb().prepare('INSERT INTO paragraphs (id, body, difficulty, created_at) VALUES (?, ?, ?, ?)')
  const now = new Date().toISOString()
  for (const p of PARAGRAPH_POOL) insert.run(p.id, p.body, p.difficulty, now)

  const router = createRouter()
  registerEntryRoutes(router)
  server = router.server
  await new Promise<void>((resolve) => server.listen(0, resolve))
  const { port } = server.address() as AddressInfo
  baseUrl = `http://localhost:${port}`
})

beforeEach(() => {
  setHouseWalletForTesting(fakeWallet())
})

after(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()))
  closeDb()
})

function assertNoDurationLeak(responseText: string): void {
  assert.ok(
    !/duration/i.test(responseText),
    `network response leaked timing info: ${responseText}`,
  )
}

test('GET /api/house-address returns the wallet address and the fixed stake amount', async () => {
  const res = await fetch(`${baseUrl}/api/house-address`)
  assert.equal(res.status, 200)
  const body = (await res.json()) as { address: string, stakeLuna: number }
  assert.equal(body.address, HOUSE_ADDRESS)
  assert.equal(body.stakeLuna, DUEL_STAKE_LUNA)
})

test('POST /api/entries/reveal verifies the stake and reveals today\'s paragraph, with no timing data', async () => {
  const res = await fetch(`${baseUrl}/api/entries/reveal`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ nimAddress: PLAYER_ADDRESS, stakeTxHash: 'stake-tx-1' }),
  })
  const text = await res.text()
  assert.equal(res.status, 200)
  assertNoDurationLeak(text)

  const body = JSON.parse(text) as { paragraphId: string, paragraphBody: string }
  const today = getDailyParagraphForToday(getDb())
  assert.equal(body.paragraphId, today.id)
  assert.equal(body.paragraphBody, today.body)
})

test('POST /api/entries/reveal rejects an unverifiable stake', async () => {
  const res = await fetch(`${baseUrl}/api/entries/reveal`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ nimAddress: PLAYER_ADDRESS, stakeTxHash: 'nonexistent' }),
  })
  assert.equal(res.status, 422)
})

test('POST /api/entries creates an OPEN entry, and the response never mentions a duration', async () => {
  const today = getDailyParagraphForToday(getDb())
  const events = today.body.split('').map((char, i) => ({ key: char, tRelativeMs: i * 100, resultingLength: i + 1 }))

  const res = await fetch(`${baseUrl}/api/entries`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ nimAddress: PLAYER_ADDRESS, stakeTxHash: 'stake-tx-1', events }),
  })
  const text = await res.text()
  assert.equal(res.status, 201)
  assertNoDurationLeak(text)

  const body = JSON.parse(text) as { entryId: string, status: string, expiresAt: string }
  assert.equal(body.status, 'OPEN')
  assert.ok(body.entryId)
  assert.ok(body.expiresAt)
  // Exactly these three keys — nothing extra snuck into the response.
  assert.deepEqual(Object.keys(body).sort(), ['entryId', 'expiresAt', 'status'])
})

test('POST /api/entries with a tampered run is rejected, with no timing data in the error response either', async () => {
  const today = getDailyParagraphForToday(getDb())
  const events = today.body.split('').map((char, i) => ({ key: char, tRelativeMs: i * 100, resultingLength: i + 1 }))
  events[2] = { ...events[2], tRelativeMs: events[1].tRelativeMs - 5 } // edited timestamp

  const res = await fetch(`${baseUrl}/api/entries`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ nimAddress: PLAYER_ADDRESS, stakeTxHash: 'stake-tx-tampered', events }),
  })
  const text = await res.text()
  assert.equal(res.status, 422)
  assertNoDurationLeak(text)
})

test('POST /api/entries rejects a malformed body', async () => {
  const res = await fetch(`${baseUrl}/api/entries`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ nimAddress: PLAYER_ADDRESS }),
  })
  assert.equal(res.status, 400)
})

test('a house wallet connection failure returns 503 instead of hanging the request', async () => {
  setHouseWalletFactoryForTesting(() => Promise.reject(new Error('Timed out waiting for Nimiq testnet consensus')))

  const res = await fetch(`${baseUrl}/api/entries/reveal`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ nimAddress: PLAYER_ADDRESS, stakeTxHash: 'whatever' }),
  })
  assert.equal(res.status, 503)
  const body = (await res.json()) as { error: string }
  assert.match(body.error, /consensus/)
})
