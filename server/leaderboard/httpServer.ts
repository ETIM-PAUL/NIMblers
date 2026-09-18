import { getDb } from '../db/client.ts'
import { getQueryParams, sendJson } from '../http/router.ts'
import type { Router } from '../http/router.ts'
import { DEFAULT_LEADERBOARD_LIMIT, getLeaderboard } from './service.ts'

const MAX_LEADERBOARD_LIMIT = 100

export function registerLeaderboardRoutes(router: Router): void {
  router.get('/api/leaderboard', async (req, res) => {
    try {
      const requested = Number(getQueryParams(req).get('limit'))
      const limit = Number.isInteger(requested) && requested > 0
        ? Math.min(requested, MAX_LEADERBOARD_LIMIT)
        : DEFAULT_LEADERBOARD_LIMIT
      sendJson(res, 200, { leaderboard: await getLeaderboard(await getDb(), limit) })
    }
    catch (error) {
      sendJson(res, 503, { error: error instanceof Error ? error.message : String(error) })
    }
  })
}
