import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import type { AddressInfo } from 'node:net'
import type { Server } from 'node:http'
import { closeDb, getDb } from '../db/client.ts'
import { migrateUp } from '../db/migrate.ts'
import { createRunsServer } from './httpServer.ts'

process.env.DB_PATH = ':memory:'

const TARGET = 'hi'
const PARAGRAPH_ID = 'http-test-paragraph'

let server: Server
let baseUrl: string

before(async () => {
  closeDb()
  await migrateUp()
  const db = await getDb()
  await db.execute({
    sql: 'INSERT INTO paragraphs (id, body, difficulty, created_at) VALUES (?, ?, ?, ?)',
    args: [PARAGRAPH_ID, TARGET, 'easy', new Date().toISOString()],
  })

  server = createRunsServer()
  await new Promise<void>((resolve) => server.listen(0, resolve))
  const { port } = server.address() as AddressInfo
  baseUrl = `http://localhost:${port}`
})

after(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()))
  closeDb()
})

test('POST /api/runs accepts a valid run over real HTTP and returns the server-computed duration', async () => {
  const events = [
    { key: 'h', tRelativeMs: 0, resultingLength: 1 },
    { key: 'i', tRelativeMs: 200, resultingLength: 2 },
  ]
  const res = await fetch(`${baseUrl}/api/runs`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ nimAddress: 'NQhttp', paragraphId: PARAGRAPH_ID, events }),
  })
  assert.equal(res.status, 201)
  const body = (await res.json()) as { durationMs: number, runId: string, flags: string[] }
  assert.equal(body.durationMs, 200)
  assert.equal(typeof body.runId, 'string')
  assert.ok(Array.isArray(body.flags))
})

test('POST /api/runs rejects a tampered payload (edited timestamps) over real HTTP', async () => {
  const events = [
    { key: 'h', tRelativeMs: 0, resultingLength: 1 },
    { key: 'i', tRelativeMs: -10, resultingLength: 2 },
  ]
  const res = await fetch(`${baseUrl}/api/runs`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ nimAddress: 'NQhttp', paragraphId: PARAGRAPH_ID, events }),
  })
  assert.equal(res.status, 422)
  const body = (await res.json()) as { error: string }
  assert.equal(typeof body.error, 'string')
})

test('POST /api/runs rejects a malformed body', async () => {
  const res = await fetch(`${baseUrl}/api/runs`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ nimAddress: 'NQhttp' }),
  })
  assert.equal(res.status, 400)
})

test('unknown routes return 404', async () => {
  const res = await fetch(`${baseUrl}/api/nonsense`)
  assert.equal(res.status, 404)
})

test('GET /api/runs/weak-keys 400s without a nimAddress', async () => {
  const res = await fetch(`${baseUrl}/api/runs/weak-keys`)
  assert.equal(res.status, 400)
})

test('GET /api/runs/weak-keys returns an empty list for an address with no runs', async () => {
  const res = await fetch(`${baseUrl}/api/runs/weak-keys?nimAddress=NQ-nobody`)
  assert.equal(res.status, 200)
  const body = (await res.json()) as { weakKeys: unknown[] }
  assert.deepEqual(body.weakKeys, [])
})

test('GET /api/runs/weak-keys surfaces a character mistyped-then-corrected in a real submitted run', async () => {
  const heatmapTarget = 'aaaaa bbbbb'
  const heatmapParagraphId = 'http-test-paragraph-heatmap'
  const db = await getDb()
  await db.execute({
    sql: 'INSERT INTO paragraphs (id, body, difficulty, created_at) VALUES (?, ?, ?, ?)',
    args: [heatmapParagraphId, heatmapTarget, 'easy', new Date().toISOString()],
  })

  // Types a wrong character first, backspaces it, then types the real
  // first letter ('a') correctly — followed by the rest of the target
  // typed cleanly.
  let t = -150
  let typed = ''
  const events: { key: string, tRelativeMs: number, resultingLength: number }[] = []
  typed += 'z'
  events.push({ key: 'z', tRelativeMs: (t += 150), resultingLength: typed.length })
  typed = typed.slice(0, -1)
  events.push({ key: 'Backspace', tRelativeMs: (t += 150), resultingLength: typed.length })
  for (const char of heatmapTarget) {
    typed += char
    events.push({ key: char, tRelativeMs: (t += 150), resultingLength: typed.length })
  }

  const submitRes = await fetch(`${baseUrl}/api/runs`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ nimAddress: 'NQ-weak-keys-player', paragraphId: heatmapParagraphId, events }),
  })
  assert.equal(submitRes.status, 201, await submitRes.text())

  const res = await fetch(`${baseUrl}/api/runs/weak-keys?nimAddress=NQ-weak-keys-player`)
  assert.equal(res.status, 200)
  const body = (await res.json()) as { weakKeys: { key: string, mistakes: number, occurrences: number, mistakeRate: number }[] }
  const a = body.weakKeys.find((w) => w.key === 'a')
  assert.ok(a, `expected 'a' in ${JSON.stringify(body.weakKeys)}`)
  assert.equal(a.mistakes, 1)
  assert.equal(a.occurrences, 5)
})
