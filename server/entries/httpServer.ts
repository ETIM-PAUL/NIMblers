import { getDb } from '../db/client.ts'
import { readJsonBody, sendJson } from '../http/router.ts'
import type { Router } from '../http/router.ts'
import { parseEvents, parseStakeBody } from '../http/validation.ts'
import { getHouseWallet } from './houseWallet.ts'
import { createEntry, DUEL_STAKE_LUNA, revealEntry } from './service.ts'

/**
 * Registers Player A's flow: stake first, then reveal the paragraph, then
 * submit the completed run. Neither response here ever includes a
 * duration — see server/entries/service.ts.
 */
export function registerEntryRoutes(router: Router): void {
  router.get('/api/house-address', async (_req, res) => {
    try {
      const wallet = await getHouseWallet()
      sendJson(res, 200, { address: wallet.address, stakeLuna: DUEL_STAKE_LUNA })
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

    const input = parseStakeBody(parsedBody)
    if (!input) {
      sendJson(res, 400, { error: 'nimAddress and stakeTxHash must be strings' })
      return
    }

    try {
      const wallet = await getHouseWallet()
      const result = await revealEntry(getDb(), wallet, input)
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
    if (!stakeInput) {
      sendJson(res, 400, { error: 'nimAddress and stakeTxHash must be strings' })
      return
    }
    const events = parseEvents((parsedBody as Record<string, unknown>).events)
    if (events === null) {
      sendJson(res, 400, { error: 'events must be an array of { key, tRelativeMs, resultingLength }' })
      return
    }

    try {
      const wallet = await getHouseWallet()
      const result = await createEntry(getDb(), wallet, { ...stakeInput, events })
      if (!result.ok) {
        sendJson(res, 422, { error: result.reason })
        return
      }
      sendJson(res, 201, { entryId: result.entryId, status: result.status, expiresAt: result.expiresAt })
    }
    catch (error) {
      sendJson(res, 503, { error: error instanceof Error ? error.message : String(error) })
    }
  })
}
