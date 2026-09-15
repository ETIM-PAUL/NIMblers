import { createRunsServer } from './runs/httpServer.ts'

const port = Number(process.env.PORT ?? 8787)

createRunsServer().listen(port, () => {
  console.log(`Typing Duel API listening on :${port}`)
})
