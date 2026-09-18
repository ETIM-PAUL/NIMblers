import { getDb } from '../db/client.ts'
import { readJsonBody, sendJson, getQueryParams } from '../http/router.ts'
import type { Router } from '../http/router.ts'
import { parseEvents, parseStakeBody } from '../http/validation.ts'
import { getHouseWallet } from '../entries/houseWallet.ts'
import { challengeEntry, declineRetry, getEntryForChallenge, listMyDuelHistory, listMyEntries, listOpenEntries, retryStake, retrySubmit, submitChallenge } from './service.ts'
import { computeBadges } from './badges.ts'

/**
 * Registers Player B's flow: browse open entries, challenge one (stake
 * first, then the paragraph renders), then submit the race — which
 * settles the duel and returns the reveal. The challenge response still
 * carries no trace of A's time; only the settlement response does, once
 * the duel is actually decided.
 */
export function registerDuelRoutes(router: Router): void {
  router.get('/api/entries', (req, res) => {
    const exclude = getQueryParams(req).get('exclude') ?? undefined
    const entries = listOpenEntries(getDb(), exclude)
    sendJson(res, 200, { entries })
  })

  // Every entry this address created, any status/visibility — separate
  // from the public browse list above, which deliberately excludes both
  // the caller's own entries and anything PRIVATE.
  router.get('/api/entries/mine', (req, res) => {
    const nimAddress = getQueryParams(req).get('nimAddress')
    if (!nimAddress) {
      sendJson(res, 400, { error: 'nimAddress query param is required' })
      return
    }
    const entries = listMyEntries(getDb(), nimAddress)
    sendJson(res, 200, { entries })
  })

  // Every duel this address has actually finished, as creator or
  // challenger, newest-decided first.
  router.get('/api/duels/history', (req, res) => {
    const nimAddress = getQueryParams(req).get('nimAddress')
    if (!nimAddress) {
      sendJson(res, 400, { error: 'nimAddress query param is required' })
      return
    }
    const history = listMyDuelHistory(getDb(), nimAddress)
    sendJson(res, 200, { history, badges: computeBadges(history) })
  })

  // Resolves a shared duel link — works for a PRIVATE entry too, since
  // knowing its id (from the link) is what stands in for an invite here.
  router.get('/api/entries/lookup', (req, res) => {
    const params = getQueryParams(req)
    const entryId = params.get('entryId')
    const exclude = params.get('exclude') ?? undefined
    if (!entryId) {
      sendJson(res, 400, { error: 'entryId query param is required' })
      return
    }
    const result = getEntryForChallenge(getDb(), entryId, exclude)
    if (!result.ok) {
      sendJson(res, 404, { error: result.reason })
      return
    }
    sendJson(res, 200, { entry: result.entry })
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

    try {
      const wallet = await getHouseWallet()
      const result = await submitChallenge(getDb(), wallet, { entryId: body.entryId, nimAddress: body.nimAddress, events })
      if (!result.ok) {
        sendJson(res, 422, { error: result.reason })
        return
      }
      sendJson(res, 201, result)
    }
    catch (error) {
      sendJson(res, 503, { error: error instanceof Error ? error.message : String(error) })
    }
  })

  // Double trial: verifies the challenger's doubled retry stake before
  // the retry's typing screen shows. Doesn't reveal anything new — the
  // paragraph hasn't changed since the first attempt.
  router.post('/api/entries/challenge/retry/stake', async (req, res) => {
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
      const result = await retryStake(getDb(), wallet, { entryId, ...stakeInput })
      if (!result.ok) {
        sendJson(res, 422, { error: result.reason })
        return
      }
      sendJson(res, 200, { ok: true })
    }
    catch (error) {
      sendJson(res, 503, { error: error instanceof Error ? error.message : String(error) })
    }
  })

  // The challenger's final attempt — settles the duel either way.
  router.post('/api/entries/challenge/retry/submit', async (req, res) => {
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
    const events = parseEvents((parsedBody as Record<string, unknown> | null)?.events)
    if (!stakeInput || !entryId || events === null) {
      sendJson(res, 400, { error: 'entryId, nimAddress, and stakeTxHash must be strings, and events must be an array of { key, tRelativeMs, resultingLength }' })
      return
    }

    try {
      const wallet = await getHouseWallet()
      const result = await retrySubmit(getDb(), wallet, { entryId, ...stakeInput, events })
      if (!result.ok) {
        sendJson(res, 422, { error: result.reason })
        return
      }
      sendJson(res, 201, result)
    }
    catch (error) {
      sendJson(res, 503, { error: error instanceof Error ? error.message : String(error) })
    }
  })

  // "He logs off and the funds go to A" — but as an explicit tap instead
  // of silently walking away, so the challenger isn't forced to wait out
  // the retry window just to see the reveal.
  router.post('/api/entries/challenge/decline-retry', async (req, res) => {
    let parsedBody: unknown
    try {
      parsedBody = await readJsonBody(req)
    }
    catch {
      sendJson(res, 400, { error: 'invalid JSON body' })
      return
    }
    const body = parsedBody as Record<string, unknown> | null
    if (typeof body?.entryId !== 'string' || typeof body?.nimAddress !== 'string') {
      sendJson(res, 400, { error: 'entryId and nimAddress must be strings' })
      return
    }

    try {
      const wallet = await getHouseWallet()
      const result = await declineRetry(getDb(), wallet, { entryId: body.entryId, nimAddress: body.nimAddress })
      if (!result.ok) {
        sendJson(res, 422, { error: result.reason })
        return
      }
      sendJson(res, 201, result)
    }
    catch (error) {
      sendJson(res, 503, { error: error instanceof Error ? error.message : String(error) })
    }
  })
}
