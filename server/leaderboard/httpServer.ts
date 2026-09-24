import type { IncomingMessage } from 'node:http'
import { getDb } from '../db/client.ts'
import { getQueryParams, sendJson } from '../http/router.ts'
import type { Router } from '../http/router.ts'
import { DEFAULT_LEADERBOARD_LIMIT, getAllTimeLeaderboard, getLeaderboard } from './service.ts'

const MAX_LEADERBOARD_LIMIT = 100

function parseLimit(req: IncomingMessage): number {
  const requested = Number(getQueryParams(req).get('limit'))
  return Number.isInteger(requested) && requested > 0
    ? Math.min(requested, MAX_LEADERBOARD_LIMIT)
    : DEFAULT_LEADERBOARD_LIMIT
}

export function registerLeaderboardRoutes(router: Router): void {
  router.get('/api/leaderboard', async (req, res) => {
    try {
      sendJson(res, 200, { leaderboard: await getLeaderboard(await getDb(), parseLimit(req)) })
    }
    catch (error) {
      sendJson(res, 503, { error: error instanceof Error ? error.message : String(error) })
    }
  })

  router.get('/api/leaderboard/all-time', async (req, res) => {
    try {
      sendJson(res, 200, { leaderboard: await getAllTimeLeaderboard(await getDb(), parseLimit(req)) })
    }
    catch (error) {
      sendJson(res, 503, { error: error instanceof Error ? error.message : String(error) })
    }
  })
}
