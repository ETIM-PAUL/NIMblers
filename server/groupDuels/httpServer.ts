import { getDb } from '../db/client.ts'
import { readJsonBody, sendJson, getQueryParams } from '../http/router.ts'
import type { Router } from '../http/router.ts'
import { isDifficulty, isLanguageOrUndefined, isPositiveInteger, parseEvents, parseStakeBody } from '../http/validation.ts'
import { getHouseWallet } from '../entries/houseWallet.ts'
import { createGroupDuel, getGroupDuelPreview, getGroupDuelStatus, joinGroupDuel, submitGroupRun } from './service.ts'

/**
 * Registers the group-duel flow: create (host configures, gets a code),
 * preview (anyone with the code sees the stake/slots before joining),
 * join (stake, get the paragraph), submit (type, settle if that completes
 * the roster), and status (poll for the public reveal once resolved).
 */
export function registerGroupDuelRoutes(router: Router): void {
  router.post('/api/group-duels', async (req, res) => {
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
    if (typeof body.nimAddress !== 'string' || !isDifficulty(body.difficulty) || !isPositiveInteger(body.maxParticipants) || !isLanguageOrUndefined(body.language)) {
      sendJson(res, 400, { error: 'nimAddress must be a string, difficulty must be easy/medium/hard, and maxParticipants must be a positive integer' })
      return
    }

    try {
      const result = await createGroupDuel(await getDb(), {
        nimAddress: body.nimAddress,
        difficulty: body.difficulty,
        maxParticipants: body.maxParticipants,
        language: body.language,
      })
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

  router.get('/api/group-duels/preview', async (req, res) => {
    const code = getQueryParams(req).get('code')
    if (!code) {
      sendJson(res, 400, { error: 'code query param is required' })
      return
    }
    try {
      const result = await getGroupDuelPreview(await getDb(), code)
      if (!result.ok) {
        sendJson(res, 404, { error: result.reason })
        return
      }
      sendJson(res, 200, result.preview)
    }
    catch (error) {
      sendJson(res, 503, { error: error instanceof Error ? error.message : String(error) })
    }
  })

  router.post('/api/group-duels/join', async (req, res) => {
    let parsedBody: unknown
    try {
      parsedBody = await readJsonBody(req)
    }
    catch {
      sendJson(res, 400, { error: 'invalid JSON body' })
      return
    }
    const stakeInput = parseStakeBody(parsedBody)
    const code = typeof (parsedBody as Record<string, unknown> | null)?.code === 'string'
      ? (parsedBody as { code: string }).code
      : null
    if (!stakeInput || !code) {
      sendJson(res, 400, { error: 'code, nimAddress, and stakeTxHash must be strings' })
      return
    }

    try {
      const wallet = await getHouseWallet()
      const result = await joinGroupDuel(await getDb(), wallet, { code, ...stakeInput })
      if (!result.ok) {
        sendJson(res, 409, { error: result.reason })
        return
      }
      sendJson(res, 200, { groupDuelId: result.groupDuelId, paragraphId: result.paragraphId, paragraphBody: result.paragraphBody })
    }
    catch (error) {
      sendJson(res, 503, { error: error instanceof Error ? error.message : String(error) })
    }
  })

  router.post('/api/group-duels/submit', async (req, res) => {
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
    if (typeof body.groupDuelId !== 'string' || typeof body.nimAddress !== 'string') {
      sendJson(res, 400, { error: 'groupDuelId and nimAddress must be strings' })
      return
    }
    const events = parseEvents(body.events)
    if (events === null) {
      sendJson(res, 400, { error: 'events must be an array of { key, tRelativeMs, resultingLength }' })
      return
    }

    try {
      const wallet = await getHouseWallet()
      const result = await submitGroupRun(await getDb(), wallet, { groupDuelId: body.groupDuelId, nimAddress: body.nimAddress, events })
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

  // router.ts only supports exact-path matching, not `:id` segments, so
  // the group duel id travels as a query param instead, same as every
  // other lookup route in this app.
  router.get('/api/group-duels/status', async (req, res) => {
    const params = getQueryParams(req)
    const groupDuelId = params.get('groupDuelId')
    const nimAddress = params.get('nimAddress') ?? undefined
    if (!groupDuelId) {
      sendJson(res, 400, { error: 'groupDuelId query param is required' })
      return
    }
    try {
      const result = await getGroupDuelStatus(await getDb(), { groupDuelId, nimAddress })
      if (!result.ok) {
        sendJson(res, 404, { error: result.reason })
        return
      }
      sendJson(res, 200, result)
    }
    catch (error) {
      sendJson(res, 503, { error: error instanceof Error ? error.message : String(error) })
    }
  })
}
