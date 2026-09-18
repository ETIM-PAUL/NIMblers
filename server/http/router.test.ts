import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, before, test } from 'node:test'
import type { AddressInfo } from 'node:net'
import { createRouter, sendJson } from './router.ts'
import type { Router } from './router.ts'

let staticDir: string
let router: Router
let baseUrl: string

before(async () => {
  staticDir = mkdtempSync(join(tmpdir(), 'router-test-'))
  writeFileSync(join(staticDir, 'index.html'), '<html>spa shell</html>')
  writeFileSync(join(staticDir, 'app.js'), 'console.log("hi")')

  router = createRouter({ staticDir })
  router.get('/api/health', (_req, res) => sendJson(res, 200, { ok: true }))
  await new Promise<void>((resolve) => router.server.listen(0, resolve))
  const { port } = router.server.address() as AddressInfo
  baseUrl = `http://localhost:${port}`
})

after(async () => {
  await new Promise<void>((resolve) => router.server.close(() => resolve()))
  rmSync(staticDir, { recursive: true, force: true })
})

test('registered API routes still take priority over the static fallback', async () => {
  const res = await fetch(`${baseUrl}/api/health`)
  assert.equal(res.status, 200)
  assert.deepEqual(await res.json(), { ok: true })
})

test('a request for an existing static file serves it with the right content type', async () => {
  const res = await fetch(`${baseUrl}/app.js`)
  assert.equal(res.status, 200)
  assert.match(res.headers.get('content-type') ?? '', /javascript/)
  assert.equal(await res.text(), 'console.log("hi")')
})

test('an unmatched GET route falls back to index.html, the SPA rewrite', async () => {
  const res = await fetch(`${baseUrl}/leaderboard`)
  assert.equal(res.status, 200)
  assert.match(res.headers.get('content-type') ?? '', /html/)
  assert.equal(await res.text(), '<html>spa shell</html>')
})

test('without a staticDir, an unmatched route still 404s as JSON', async () => {
  const bareRouter = createRouter()
  await new Promise<void>((resolve) => bareRouter.server.listen(0, resolve))
  const { port } = bareRouter.server.address() as AddressInfo
  try {
    const res = await fetch(`http://localhost:${port}/anything`)
    assert.equal(res.status, 404)
    assert.deepEqual(await res.json(), { error: 'not found' })
  }
  finally {
    await new Promise<void>((resolve) => bareRouter.server.close(() => resolve()))
  }
})
