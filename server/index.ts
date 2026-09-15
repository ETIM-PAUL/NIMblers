import { createRouter } from './http/router.ts'
import { registerRunRoutes } from './runs/httpServer.ts'
import { registerEntryRoutes } from './entries/httpServer.ts'
import { registerDuelRoutes } from './duels/httpServer.ts'

const port = Number(process.env.PORT ?? 8787)

const router = createRouter()
registerRunRoutes(router)
registerEntryRoutes(router)
registerDuelRoutes(router)

router.server.listen(port, () => {
  console.log(`Typing Duel API listening on :${port}`)
})
