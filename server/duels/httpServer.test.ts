import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { after, before, beforeEach, test } from 'node:test'
import type { AddressInfo } from 'node:net'
import type { Server } from 'node:http'
import { closeDb, getDb } from '../db/client.ts'
import { migrateUp } from '../db/migrate.ts'
import { getOrCreateUser } from '../db/users.ts'
import { createRouter } from '../http/router.ts'
import { registerDuelRoutes } from './httpServer.ts'
import { setHouseWalletForTesting } from '../entries/houseWallet.ts'
import type { HouseWallet, HouseWalletTransaction } from '../../services/escrow.ts'

process.env.DB_PATH = ':memory:'

const HOUSE_ADDRESS = 'NQ07 HOUS EAAA AAAA AAAA AAAA AAAA AAAA AAAA'
const CREATOR_ADDRESS = 'NQ07 CREA TORA AAAA AAAA AAAA AAAA AAAA AAAA'
const CHALLENGER_ADDRESS = 'NQ07 CHAL LENG ERAA AAAA AAAA AAAA AAAA AAAA'
const OTHER_CHALLENGER_ADDRESS = 'NQ07 OTHE RCHA LLEN GERA AAAA AAAA AAAA AAAA'
const TARGET = 'hi there'
const PARAGRAPH_ID = 'test-paragraph'
const STAKE_LUNA = 100_000

function fakeWallet(): HouseWallet {
  let sendCount = 0
  return {
    address: HOUSE_ADDRESS,
    async getBalance() { return 5_000_000 },
    async send(recipientAddress, valueLuna) {
      sendCount += 1
      return { txHash: `settlement-tx-${sendCount}`, senderAddress: HOUSE_ADDRESS, recipientAddress, valueLuna, state: 'confirmed', confirmations: 5 }
    },
    async getTransaction(txHash): Promise<HouseWalletTransaction | null> {
      const sender = txHash.includes('other') ? OTHER_CHALLENGER_ADDRESS : CHALLENGER_ADDRESS
      return { txHash, senderAddress: sender, recipientAddress: HOUSE_ADDRESS, valueLuna: STAKE_LUNA, state: 'confirmed', confirmations: 5 }
    },
    async close() {},
  }
}

let server: Server
let baseUrl: string
let entryId: string

before(async () => {
  closeDb()
  migrateUp()
  const router = createRouter()
  registerDuelRoutes(router)
  server = router.server
  await new Promise<void>((resolve) => server.listen(0, resolve))
  const { port } = server.address() as AddressInfo
  baseUrl = `http://localhost:${port}`
})

beforeEach(() => {
  setHouseWalletForTesting(fakeWallet())
  const db = getDb()
  db.prepare('DELETE FROM payouts').run()
  db.prepare('DELETE FROM duels').run()
  db.prepare('DELETE FROM entries').run()
  db.prepare('DELETE FROM keystroke_runs').run()
  db.prepare('DELETE FROM paragraphs').run()
  db.prepare('DELETE FROM users').run()

  const now = new Date().toISOString()
  db.prepare('INSERT INTO paragraphs (id, body, difficulty, created_at) VALUES (?, ?, ?, ?)').run(
    PARAGRAPH_ID,
    TARGET,
    'easy',
    now,
  )
  const creatorId = getOrCreateUser(db, CREATOR_ADDRESS)
  const runId = randomUUID()
  db.prepare(
    'INSERT INTO keystroke_runs (id, user_id, paragraph_id, events, duration_ms, created_at) VALUES (?, ?, ?, ?, ?, ?)',
  ).run(runId, creatorId, PARAGRAPH_ID, '[]', 5000, now)
  entryId = randomUUID()
  const expiresAt = new Date(Date.now() + 24 * 60 * 60_000).toISOString()
  db.prepare(
    `INSERT INTO entries (id, creator_user_id, paragraph_id, keystroke_run_id, stake_luna, status, created_at, expires_at, stake_tx_hash)
     VALUES (?, ?, ?, ?, ?, 'OPEN', ?, ?, ?)`,
  ).run(entryId, creatorId, PARAGRAPH_ID, runId, STAKE_LUNA, now, expiresAt, `creator-stake-${entryId}`)
})

after(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()))
  closeDb()
})

test('GET /api/entries lists the open entry with no timing data', async () => {
  const res = await fetch(`${baseUrl}/api/entries`)
  assert.equal(res.status, 200)
  const text = await res.text()
  assert.ok(!/duration/i.test(text), `listing leaked timing info: ${text}`)

  const body = JSON.parse(text) as { entries: { entryId: string, creatorAddress: string, stakeLuna: number }[] }
  assert.equal(body.entries.length, 1)
  assert.equal(body.entries[0].entryId, entryId)
  assert.equal(body.entries[0].creatorAddress, CREATOR_ADDRESS)
})

test('GET /api/entries?exclude=<address> hides that address\'s own entries', async () => {
  const res = await fetch(`${baseUrl}/api/entries?exclude=${encodeURIComponent(CREATOR_ADDRESS)}`)
  const body = (await res.json()) as { entries: unknown[] }
  assert.equal(body.entries.length, 0)
})

test('GET /api/entries excludes a PRIVATE entry from the dashboard listing', async () => {
  getDb().prepare("UPDATE entries SET visibility = 'PRIVATE' WHERE id = ?").run(entryId)
  const res = await fetch(`${baseUrl}/api/entries`)
  const body = (await res.json()) as { entries: unknown[] }
  assert.equal(body.entries.length, 0)
})

test('GET /api/entries/lookup finds a PRIVATE entry by id, even though it is hidden from the dashboard', async () => {
  getDb().prepare("UPDATE entries SET visibility = 'PRIVATE' WHERE id = ?").run(entryId)

  const res = await fetch(`${baseUrl}/api/entries/lookup?entryId=${encodeURIComponent(entryId)}`)
  assert.equal(res.status, 200)
  const body = (await res.json()) as { entry: { entryId: string, creatorAddress: string, visibility: string } }
  assert.equal(body.entry.entryId, entryId)
  assert.equal(body.entry.creatorAddress, CREATOR_ADDRESS)
  assert.equal(body.entry.visibility, 'PRIVATE')
})

test('GET /api/entries/lookup 404s on an unknown id', async () => {
  const res = await fetch(`${baseUrl}/api/entries/lookup?entryId=does-not-exist`)
  assert.equal(res.status, 404)
})

test('GET /api/entries/lookup 400s without an entryId', async () => {
  const res = await fetch(`${baseUrl}/api/entries/lookup`)
  assert.equal(res.status, 400)
})

test('a PRIVATE entry found via lookup can be challenged through the normal flow', async () => {
  getDb().prepare("UPDATE entries SET visibility = 'PRIVATE' WHERE id = ?").run(entryId)

  const lookup = await fetch(`${baseUrl}/api/entries/lookup?entryId=${encodeURIComponent(entryId)}`)
  const { entry } = (await lookup.json()) as { entry: { entryId: string } }

  const res = await fetch(`${baseUrl}/api/entries/challenge`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ entryId: entry.entryId, nimAddress: CHALLENGER_ADDRESS, stakeTxHash: 'private-link-challenge-tx' }),
  })
  assert.equal(res.status, 200)
})

test('POST /api/entries/challenge locks the entry and reveals the paragraph, no duration anywhere', async () => {
  const res = await fetch(`${baseUrl}/api/entries/challenge`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ entryId, nimAddress: CHALLENGER_ADDRESS, stakeTxHash: 'challenger-tx-1' }),
  })
  const text = await res.text()
  assert.equal(res.status, 200)
  assert.ok(!/duration/i.test(text), `challenge response leaked timing info: ${text}`)
  const body = JSON.parse(text) as { paragraphBody: string }
  assert.equal(body.paragraphBody, TARGET)
})

test('two simultaneous HTTP challenge requests on the same entry produce one lock and one clean rejection', async () => {
  const [resA, resB] = await Promise.all([
    fetch(`${baseUrl}/api/entries/challenge`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ entryId, nimAddress: CHALLENGER_ADDRESS, stakeTxHash: 'race-tx-1' }),
    }),
    fetch(`${baseUrl}/api/entries/challenge`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ entryId, nimAddress: OTHER_CHALLENGER_ADDRESS, stakeTxHash: 'other-race-tx-1' }),
    }),
  ])

  const statuses = [resA.status, resB.status].sort()
  assert.deepEqual(statuses, [200, 409], `expected one 200 and one 409, got ${statuses}`)

  const db = getDb()
  const duelCount = db.prepare('SELECT COUNT(*) c FROM duels WHERE entry_id = ?').get(entryId) as { c: number }
  assert.equal(duelCount.c, 1)
})

test('POST /api/entries/challenge/submit settles the duel and reveals both times, the delta, and a tx hash', async () => {
  await fetch(`${baseUrl}/api/entries/challenge`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ entryId, nimAddress: CHALLENGER_ADDRESS, stakeTxHash: 'submit-test-tx' }),
  })

  // Creator's seeded run is 5000ms; typing at 100ms/char finishes this 8-char target well under that.
  const events = TARGET.split('').map((char, i) => ({ key: char, tRelativeMs: i * 100, resultingLength: i + 1 }))
  const res = await fetch(`${baseUrl}/api/entries/challenge/submit`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ entryId, nimAddress: CHALLENGER_ADDRESS, events }),
  })
  const text = await res.text()
  assert.equal(res.status, 201)
  const body = JSON.parse(text) as {
    ok: boolean
    outcome: string
    creatorDurationMs: number
    challengerDurationMs: number
    deltaMs: number
    txHashes: string[]
  }
  assert.equal(body.ok, true)
  assert.equal(body.outcome, 'challenger')
  assert.equal(body.creatorDurationMs, 5000)
  assert.equal(body.challengerDurationMs, 700)
  assert.equal(body.deltaMs, 4300)
  assert.equal(body.txHashes.length, 1)

  const entry = await fetch(`${baseUrl}/api/entries?exclude=nobody`)
  const entryBody = (await entry.json()) as { entries: unknown[] }
  assert.equal(entryBody.entries.length, 0, 'a settled entry must no longer appear as open')
})

test('POST /api/entries/challenge/submit rejects submitting to an unchallenged entry', async () => {
  const events = TARGET.split('').map((char, i) => ({ key: char, tRelativeMs: i * 100, resultingLength: i + 1 }))
  const res = await fetch(`${baseUrl}/api/entries/challenge/submit`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ entryId, nimAddress: CHALLENGER_ADDRESS, events }),
  })
  assert.equal(res.status, 422)
})
