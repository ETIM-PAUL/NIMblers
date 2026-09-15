import { createServer } from 'node:http'
import type { IncomingMessage, Server, ServerResponse } from 'node:http'
import { getDb } from '../db/client.ts'
import { submitRun } from './service.ts'

interface RawEvent {
  key: string
  tRelativeMs: number
  resultingLength: number
}

function isRawEvent(value: unknown): value is RawEvent {
  if (typeof value !== 'object' || value === null) return false
  const v = value as Record<string, unknown>
  return typeof v.key === 'string' && typeof v.tRelativeMs === 'number' && typeof v.resultingLength === 'number'
}

function parseEvents(value: unknown): RawEvent[] | null {
  if (!Array.isArray(value)) return null
  return value.every(isRawEvent) ? value : null
}

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = []
  for await (const chunk of req) chunks.push(chunk as Buffer)
  return Buffer.concat(chunks).toString('utf-8')
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body)
  res.writeHead(status, { 'Content-Type': 'application/json' })
  res.end(payload)
}

async function handleSubmitRun(req: IncomingMessage, res: ServerResponse): Promise<void> {
  let parsedBody: unknown
  try {
    const raw = await readBody(req)
    parsedBody = raw ? JSON.parse(raw) : null
  }
  catch {
    sendJson(res, 400, { error: 'invalid JSON body' })
    return
  }

  if (typeof parsedBody !== 'object' || parsedBody === null) {
    sendJson(res, 400, { error: 'request body must be a JSON object' })
    return
  }
  const body = parsedBody as Record<string, unknown>

  if (typeof body.nimAddress !== 'string' || typeof body.paragraphId !== 'string') {
    sendJson(res, 400, { error: 'nimAddress and paragraphId must be strings' })
    return
  }

  const events = parseEvents(body.events)
  if (events === null) {
    sendJson(res, 400, { error: 'events must be an array of { key, tRelativeMs, resultingLength }' })
    return
  }

  const result = submitRun(getDb(), { nimAddress: body.nimAddress, paragraphId: body.paragraphId, events })
  if (!result.ok) {
    sendJson(res, 422, { error: result.reason })
    return
  }

  sendJson(res, 201, { runId: result.runId, durationMs: result.durationMs })
}

/**
 * Minimal `node:http` server — one route so far, so a routing framework
 * isn't worth a new dependency yet. Revisit once more routes land
 * (entries, duels, payouts in later phases).
 */
export function createRunsServer(): Server {
  return createServer((req, res) => {
    if (req.method === 'POST' && req.url === '/api/runs') {
      void handleSubmitRun(req, res)
      return
    }
    sendJson(res, 404, { error: 'not found' })
  })
}
