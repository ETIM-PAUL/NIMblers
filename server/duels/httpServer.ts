import { getDb } from '../db/client.ts'
import { readJsonBody, sendJson, getQueryParams } from '../http/router.ts'
import type { Router } from '../http/router.ts'
import { parseEvents, parseStakeBody } from '../http/validation.ts'
import { getHouseWallet } from '../entries/houseWallet.ts'
import { challengeEntry, listOpenEntries, submitChallenge } from './service.ts'

/**
 * Registers Player B's flow: browse open entries, challenge one (stake
 * first, then the paragraph renders), then submit the race. See
 * server/duels/service.ts for why this deliberately stops short of
 * settlement — no winner, no payout, nothing about A's time in any of
 * these responses either.
 */
export function registerDuelRoutes(router: Router): void {
  router.get('/api/entries', (req, res) => {
    const exclude = getQueryParams(req).get('exclude') ?? undefined
    const entries = listOpenEntries(getDb(), exclude)
    sendJson(res, 200, { entries })
  })

  router.post('/api/entries/challenge', async (req, res) => {
    let parsedBody: unknown
    try {
      parsedBody = await readJsonBody(req)
    }
    catch {
      sendJson(res, 400, { error: 'invalid JSON body' })
      return
    }

    const stakeInput = parseStakeBody(parsedBody)
    const entryId = typeof (parsedBody as Record<string, unknown> | null)?.entryId === 'string'
      ? (parsedBody as { entryId: string }).entryId
      : null
    if (!stakeInput || !entryId) {
      sendJson(res, 400, { error: 'entryId, nimAddress, and stakeTxHash must be strings' })
      return
    }

    try {
      const wallet = await getHouseWallet()
      const result = await challengeEntry(getDb(), wallet, { entryId, ...stakeInput })
      if (!result.ok) {
        sendJson(res, 409, { error: result.reason })
        return
      }
      sendJson(res, 200, { paragraphId: result.paragraphId, paragraphBody: result.paragraphBody })
    }
    catch (error) {
      sendJson(res, 503, { error: error instanceof Error ? error.message : String(error) })
    }
  })

  router.post('/api/entries/challenge/submit', async (req, res) => {
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
    if (typeof body.entryId !== 'string' || typeof body.nimAddress !== 'string') {
      sendJson(res, 400, { error: 'entryId and nimAddress must be strings' })
      return
    }
    const events = parseEvents(body.events)
    if (events === null) {
      sendJson(res, 400, { error: 'events must be an array of { key, tRelativeMs, resultingLength }' })
      return
    }

    const result = submitChallenge(getDb(), { entryId: body.entryId, nimAddress: body.nimAddress, events })
    if (!result.ok) {
      sendJson(res, 422, { error: result.reason })
      return
    }
    sendJson(res, 201, { ok: true })
  })
}
