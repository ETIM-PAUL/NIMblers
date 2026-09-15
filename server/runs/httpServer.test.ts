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
  migrateUp()
  getDb()
    .prepare('INSERT INTO paragraphs (id, body, difficulty, created_at) VALUES (?, ?, ?, ?)')
    .run(PARAGRAPH_ID, TARGET, 'easy', new Date().toISOString())

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
