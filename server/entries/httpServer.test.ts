import assert from 'node:assert/strict'
import { after, before, beforeEach, test } from 'node:test'
import type { AddressInfo } from 'node:net'
import type { Server } from 'node:http'
import { closeDb, getDb } from '../db/client.ts'
import { migrateUp } from '../db/migrate.ts'
import { createRouter } from '../http/router.ts'
import { registerEntryRoutes } from './httpServer.ts'
import { setHouseWalletFactoryForTesting, setHouseWalletForTesting } from './houseWallet.ts'
import { DUEL_STAKE_LUNA_BY_DIFFICULTY } from './service.ts'
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

/** Reveals over HTTP and returns the paragraph actually shown — the only way to know it in advance, by design. */
async function revealViaHttp(stakeTxHash: string, difficulty: string): Promise<{ paragraphId: string, paragraphBody: string }> {
  const res = await fetch(`${baseUrl}/api/entries/reveal`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ nimAddress: PLAYER_ADDRESS, stakeTxHash, difficulty }),
  })
  assert.equal(res.status, 200, 'setup: reveal must succeed')
  return (await res.json()) as { paragraphId: string, paragraphBody: string }
}

function eventsFor(body: string): { key: string, tRelativeMs: number, resultingLength: number }[] {
  return body.split('').map((char, i) => ({ key: char, tRelativeMs: i * 100, resultingLength: i + 1 }))
}

test('GET /api/house-address returns the wallet address and the stake amount per difficulty', async () => {
  const res = await fetch(`${baseUrl}/api/house-address`)
  assert.equal(res.status, 200)
  const body = (await res.json()) as { address: string, stakes: Record<string, number> }
  assert.equal(body.address, HOUSE_ADDRESS)
  assert.deepEqual(body.stakes, DUEL_STAKE_LUNA_BY_DIFFICULTY)
})

test('POST /api/entries/reveal verifies the stake and reveals a freshly generated paragraph for that difficulty, with no timing data', async () => {
  const res = await fetch(`${baseUrl}/api/entries/reveal`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ nimAddress: PLAYER_ADDRESS, stakeTxHash: 'stake-tx-1', difficulty: 'easy' }),
  })
  const text = await res.text()
  assert.equal(res.status, 200)
  assertNoDurationLeak(text)

  const body = JSON.parse(text) as { paragraphId: string, paragraphBody: string }
  assert.ok(body.paragraphId)
  assert.ok(body.paragraphBody.length > 0)
})

test('POST /api/entries/reveal rejects an unverifiable stake', async () => {
  const res = await fetch(`${baseUrl}/api/entries/reveal`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ nimAddress: PLAYER_ADDRESS, stakeTxHash: 'nonexistent', difficulty: 'easy' }),
  })
  assert.equal(res.status, 422)
})

test('POST /api/entries/reveal rejects a missing or invalid difficulty', async () => {
  const res = await fetch(`${baseUrl}/api/entries/reveal`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ nimAddress: PLAYER_ADDRESS, stakeTxHash: 'stake-tx-1', difficulty: 'nightmare' }),
  })
  assert.equal(res.status, 400)
})

test('POST /api/entries creates an OPEN entry at the difficulty\'s stake amount, and the response never mentions a duration', async () => {
  setHouseWalletForTesting({
    ...fakeWallet(),
    async getTransaction(txHash) {
      return confirmedStakeTx({ txHash, valueLuna: DUEL_STAKE_LUNA_BY_DIFFICULTY.hard })
    },
  })
  const revealed = await revealViaHttp('stake-tx-hard', 'hard')
  const events = eventsFor(revealed.paragraphBody)

  const res = await fetch(`${baseUrl}/api/entries`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      nimAddress: PLAYER_ADDRESS,
      stakeTxHash: 'stake-tx-hard',
      difficulty: 'hard',
      events,
    }),
  })
  const text = await res.text()
  assert.equal(res.status, 201)
  assertNoDurationLeak(text)

  const body = JSON.parse(text) as { entryId: string, status: string, expiresAt: string, visibility: string, allowRematch: boolean }
  assert.equal(body.status, 'OPEN')
  assert.ok(body.entryId)
  assert.ok(body.expiresAt)
  assert.equal(body.visibility, 'PUBLIC', 'defaults to public when the caller does not specify')
  assert.equal(body.allowRematch, false, 'defaults to no rematch when the caller does not specify')
  // Exactly these five keys — nothing extra snuck into the response.
  assert.deepEqual(Object.keys(body).sort(), ['allowRematch', 'entryId', 'expiresAt', 'status', 'visibility'])

  const row = getDb().prepare('SELECT stake_luna FROM entries WHERE id = ?').get(body.entryId) as { stake_luna: number }
  assert.equal(row.stake_luna, DUEL_STAKE_LUNA_BY_DIFFICULTY.hard)
})

test('POST /api/entries stores PRIVATE when asked, and rejects a bogus visibility value', async () => {
  const revealed = await revealViaHttp('stake-tx-private', 'easy')
  const events = eventsFor(revealed.paragraphBody)

  const privateRes = await fetch(`${baseUrl}/api/entries`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ nimAddress: PLAYER_ADDRESS, stakeTxHash: 'stake-tx-private', difficulty: 'easy', events, visibility: 'PRIVATE' }),
  })
  assert.equal(privateRes.status, 201)
  const privateBody = (await privateRes.json()) as { visibility: string }
  assert.equal(privateBody.visibility, 'PRIVATE')

  const bogusEvents = eventsFor((await revealViaHttp('stake-tx-bogus', 'easy')).paragraphBody)
  const bogusRes = await fetch(`${baseUrl}/api/entries`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ nimAddress: PLAYER_ADDRESS, stakeTxHash: 'stake-tx-bogus', difficulty: 'easy', events: bogusEvents, visibility: 'SECRET' }),
  })
  assert.equal(bogusRes.status, 400)
})

test('POST /api/entries with a tampered run is rejected, with no timing data in the error response either', async () => {
  const revealed = await revealViaHttp('stake-tx-tampered', 'easy')
  const events = eventsFor(revealed.paragraphBody)
  events[2] = { ...events[2], tRelativeMs: events[1].tRelativeMs - 5 } // edited timestamp

  const res = await fetch(`${baseUrl}/api/entries`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ nimAddress: PLAYER_ADDRESS, stakeTxHash: 'stake-tx-tampered', difficulty: 'easy', events }),
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
    body: JSON.stringify({ nimAddress: PLAYER_ADDRESS, stakeTxHash: 'whatever', difficulty: 'easy' }),
  })
  assert.equal(res.status, 503)
  const body = (await res.json()) as { error: string }
  assert.match(body.error, /consensus/)
})
