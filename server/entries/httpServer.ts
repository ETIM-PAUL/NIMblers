import { getDb } from '../db/client.ts'
import { readJsonBody, sendJson } from '../http/router.ts'
import type { Router } from '../http/router.ts'
import { isBooleanOrUndefined, isDifficulty, isVisibilityOrUndefined, parseEvents, parseStakeBody } from '../http/validation.ts'
import { getHouseWallet } from './houseWallet.ts'
import { createEntry, DUEL_STAKE_LUNA_BY_DIFFICULTY, revealEntry } from './service.ts'

/**
 * Registers Player A's flow: stake first, then reveal the paragraph, then
 * submit the completed run. Neither response here ever includes a
 * duration — see server/entries/service.ts.
 */
export function registerEntryRoutes(router: Router): void {
  router.get('/api/house-address', async (_req, res) => {
    try {
      const wallet = await getHouseWallet()
      sendJson(res, 200, { address: wallet.address, stakes: DUEL_STAKE_LUNA_BY_DIFFICULTY })
    }
    catch (error) {
      sendJson(res, 503, { error: error instanceof Error ? error.message : String(error) })
    }
  })

  router.post('/api/entries/reveal', async (req, res) => {
    let parsedBody: unknown
    try {
      parsedBody = await readJsonBody(req)
    }
    catch {
      sendJson(res, 400, { error: 'invalid JSON body' })
      return
    }

    const stakeInput = parseStakeBody(parsedBody)
    const difficulty = (parsedBody as Record<string, unknown> | null)?.difficulty
    if (!stakeInput || !isDifficulty(difficulty)) {
      sendJson(res, 400, { error: 'nimAddress and stakeTxHash must be strings, and difficulty must be easy, medium, or hard' })
      return
    }

    try {
      const wallet = await getHouseWallet()
      const result = await revealEntry(getDb(), wallet, { ...stakeInput, difficulty })
      if (!result.ok) {
        sendJson(res, 422, { error: result.reason })
        return
      }
      sendJson(res, 200, { paragraphId: result.paragraphId, paragraphBody: result.paragraphBody })
    }
    catch (error) {
      // Most likely the house wallet couldn't connect to Nimiq testnet
      // (e.g. consensus timeout) — a real outage, not the caller's fault.
      sendJson(res, 503, { error: error instanceof Error ? error.message : String(error) })
    }
  })

  router.post('/api/entries', async (req, res) => {
    let parsedBody: unknown
    try {
      parsedBody = await readJsonBody(req)
    }
    catch {
      sendJson(res, 400, { error: 'invalid JSON body' })
      return
    }

    const stakeInput = parseStakeBody(parsedBody)
    const body = parsedBody as Record<string, unknown> | null
    const difficulty = body?.difficulty
    const visibility = body?.visibility
    const allowRematch = body?.allowRematch
    if (!stakeInput || !isDifficulty(difficulty) || !isVisibilityOrUndefined(visibility) || !isBooleanOrUndefined(allowRematch)) {
      sendJson(res, 400, {
        error: 'nimAddress and stakeTxHash must be strings; difficulty must be easy/medium/hard; '
          + 'visibility must be PUBLIC or PRIVATE when given; allowRematch must be a boolean when given',
      })
      return
    }
    const events = parseEvents((parsedBody as Record<string, unknown>).events)
    if (events === null) {
      sendJson(res, 400, { error: 'events must be an array of { key, tRelativeMs, resultingLength }' })
      return
    }

    try {
      const wallet = await getHouseWallet()
      const result = await createEntry(getDb(), wallet, { ...stakeInput, difficulty, events, visibility, allowRematch })
      if (!result.ok) {
        sendJson(res, 422, { error: result.reason })
        return
      }
      sendJson(res, 201, {
        entryId: result.entryId,
        status: result.status,
        expiresAt: result.expiresAt,
        visibility: result.visibility,
        allowRematch: result.allowRematch,
      })
    }
    catch (error) {
      sendJson(res, 503, { error: error instanceof Error ? error.message : String(error) })
    }
  })
}
