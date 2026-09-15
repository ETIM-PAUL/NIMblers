import { createServer } from 'node:http'
import type { IncomingMessage, Server, ServerResponse } from 'node:http'

export type RouteHandler = (req: IncomingMessage, res: ServerResponse) => void | Promise<void>

export interface Router {
  post: (path: string, handler: RouteHandler) => void
  get: (path: string, handler: RouteHandler) => void
  server: Server
}

/**
 * Exact-path routing only — no `:param` segments. Every route this app has
 * needed so far fits that (see each module's own httpServer.ts for why a
 * full framework still isn't worth a new dependency). Add pattern matching
 * here, not a new library, if a route ever needs one.
 *
 * Routes can be registered from multiple modules (each owns its own
 * `register*Routes(router)` function) before `server.listen()` is ever
 * called — the request handler reads the routes map live, at request time.
 */
export function createRouter(): Router {
  const routes = new Map<string, RouteHandler>()

  const server = createServer((req, res) => {
    const pathname = new URL(req.url ?? '/', 'http://localhost').pathname
    const handler = routes.get(`${req.method} ${pathname}`)
    if (!handler) {
      sendJson(res, 404, { error: 'not found' })
      return
    }
    void handler(req, res)
  })

  return {
    post: (path, handler) => routes.set(`POST ${path}`, handler),
    get: (path, handler) => routes.set(`GET ${path}`, handler),
    server,
  }
}

export function getQueryParams(req: IncomingMessage): URLSearchParams {
  return new URL(req.url ?? '/', 'http://localhost').searchParams
}

export async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = []
  for await (const chunk of req) chunks.push(chunk as Buffer)
  const raw = Buffer.concat(chunks).toString('utf-8')
  return raw ? JSON.parse(raw) : null
}

export function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body)
  res.writeHead(status, { 'Content-Type': 'application/json' })
  res.end(payload)
}
