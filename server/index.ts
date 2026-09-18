import { existsSync } from 'node:fs'
import { getDb } from './db/client.ts'
import { runExpirySweep } from './duels/expiryJob.ts'
import { getHouseWallet } from './entries/houseWallet.ts'
import { createRouter, sendJson } from './http/router.ts'
import { registerRunRoutes } from './runs/httpServer.ts'
import { registerEntryRoutes } from './entries/httpServer.ts'
import { registerDuelRoutes } from './duels/httpServer.ts'
import { registerLeaderboardRoutes } from './leaderboard/httpServer.ts'

const port = Number(process.env.PORT ?? 8787)

// When the API and frontend are deployed as a single process (Render — see
// DEPLOY_RENDER.md), the router serves the built frontend directly out of
// `dist` for anything that isn't an API route. In dev, or when nothing has
// been built yet, this is simply absent and unmatched routes 404 as before.
const staticDir = existsSync('dist') ? 'dist' : undefined

const router = createRouter({ staticDir })
registerRunRoutes(router)
registerEntryRoutes(router)
registerDuelRoutes(router)
registerLeaderboardRoutes(router)

// Cheap, DB-free — for load balancers and an external uptime pinger (see
// DEPLOY_RENDER.md) that keeps a free-tier instance from sleeping.
router.get('/api/health', (_req, res) => sendJson(res, 200, { ok: true }))

router.server.listen(port, () => {
  console.log(`NIMblers API listening on :${port}`)
})

// The Oracle VM deploy (DEPLOY.md) already schedules `npm run expiry:sweep`
// as its own systemd timer. Render's free tier has no cron-job option
// (that's a paid add-on there), so on Render this runs the same sweep as
// an interval inside the one process instead — see DEPLOY_RENDER.md. Off
// by default everywhere else so this doesn't change local dev, tests, or
// the Oracle deployment, which don't set this env var.
if (process.env.ENABLE_INPROCESS_SWEEP === 'true') {
  const SWEEP_INTERVAL_MS = 10 * 60_000
  const runSweep = async () => {
    try {
      const result = await runExpirySweep(await getDb(), await getHouseWallet())
      console.log(
        `expiry sweep: released ${result.releasedLocks.length} lock(s), refunded ${result.refundedEntries.length} entr(y/ies), `
        + `settled ${result.settledAbandonedRetries.length} abandoned retr(y/ies), ${result.errors.length} error(s)`,
      )
    }
    catch (error) {
      console.error('expiry sweep failed:', error)
    }
  }
  setInterval(() => void runSweep(), SWEEP_INTERVAL_MS)
  void runSweep()
}
