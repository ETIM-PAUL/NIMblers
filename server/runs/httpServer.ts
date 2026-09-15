import type { Server } from 'node:http'
import { getDb } from '../db/client.ts'
import { readJsonBody, sendJson, createRouter } from '../http/router.ts'
import type { Router } from '../http/router.ts'
import { parseEvents } from '../http/validation.ts'
import { submitRun } from './service.ts'

/** Registers POST /api/runs — a standalone endpoint for validating a run without creating a duel entry. */
export function registerRunRoutes(router: Router): void {
  router.post('/api/runs', async (req, res) => {
    let parsedBody: unknown
    try {
      parsedBody = await readJsonBody(req)
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

    sendJson(res, 201, { runId: result.runId, durationMs: result.durationMs, flags: result.flags })
  })
}

/** Standalone single-route server, used by this module's own tests. */
export function createRunsServer(): Server {
  const router = createRouter()
  registerRunRoutes(router)
  return router.server
}
