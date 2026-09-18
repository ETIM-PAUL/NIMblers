import { createReadStream, existsSync, statSync } from 'node:fs'
import { createServer } from 'node:http'
import type { IncomingMessage, Server, ServerResponse } from 'node:http'
import { extname, join, normalize } from 'node:path'

export type RouteHandler = (req: IncomingMessage, res: ServerResponse) => void | Promise<void>

export interface Router {
  post: (path: string, handler: RouteHandler) => void
  get: (path: string, handler: RouteHandler) => void
  server: Server
}

export interface RouterOptions {
  /**
   * A built frontend to serve as a fallback for any unmatched GET request —
   * e.g. `dist` after `npm run build`. Used when the API and frontend are
   * deployed as one process (see server/index.ts and DEPLOY_RENDER.md)
   * instead of behind a separate reverse proxy like nginx (DEPLOY.md's
   * Oracle setup). Left undefined, unmatched requests just 404 as before —
   * this never activates in dev (`npm run dev`'s own Vite server handles
   * the frontend) or in tests.
   */
  staticDir?: string
}

const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
}

/**
 * Serves a file from `staticDir` matching `pathname`, or falls back to
 * `index.html` for anything else (unknown extension, missing file, a
 * client-side route like `/leaderboard`) — the standard single-page-app
 * rewrite, done here since there's no reverse proxy in front of this
 * process when it's deployed standalone (e.g. on Render).
 */
function serveStatic(staticDir: string, pathname: string, res: ServerResponse): void {
  const safePath = normalize(pathname).replace(/^(\.\.[/\\])+/, '')
  let filePath = join(staticDir, safePath)
  if (!existsSync(filePath) || statSync(filePath).isDirectory()) {
    filePath = join(staticDir, 'index.html')
  }
  const contentType = MIME_TYPES[extname(filePath)] ?? 'application/octet-stream'
  res.writeHead(200, { 'Content-Type': contentType })
  createReadStream(filePath).pipe(res)
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
export function createRouter(options: RouterOptions = {}): Router {
  const routes = new Map<string, RouteHandler>()

  const server = createServer((req, res) => {
    const pathname = new URL(req.url ?? '/', 'http://localhost').pathname
    const handler = routes.get(`${req.method} ${pathname}`)
    if (handler) {
      void handler(req, res)
      return
    }
    if (options.staticDir && req.method === 'GET') {
      serveStatic(options.staticDir, pathname, res)
      return
    }
    sendJson(res, 404, { error: 'not found' })
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
