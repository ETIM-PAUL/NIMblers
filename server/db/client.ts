import { createClient, LibsqlError } from '@libsql/client'
import type { Client } from '@libsql/client'
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'

export type Db = Client

// A Turso (hosted libSQL) database in production — Render's free tier has no
// persistent disk, so anything written to a local file is lost whenever the
// instance idles down and respawns. Local dev/tests fall back to a plain
// file (or ':memory:') so neither needs real Turso credentials.
const DEFAULT_DB_PATH = 'server/db/data.sqlite'

let db: Client | null = null

export async function getDb(): Promise<Db> {
  if (db) return db

  const configuredPath = process.env.DB_PATH ?? DEFAULT_DB_PATH
  const url = process.env.TURSO_DATABASE_URL
    ?? (configuredPath === ':memory:' ? ':memory:' : `file:${configuredPath}`)

  if (url.startsWith('file:') && configuredPath !== ':memory:') {
    mkdirSync(dirname(configuredPath), { recursive: true })
  }

  const client = createClient({ url, authToken: process.env.TURSO_AUTH_TOKEN })
  await client.execute('PRAGMA foreign_keys = ON')
  db = client
  return db
}

export function closeDb(): void {
  db?.close()
  db = null
}

/** True for the "insert failed because the row already exists" case a `UNIQUE` index guards against — the shape every idempotent get-or-create in this codebase falls back to a re-SELECT for. */
export function isUniqueConstraintError(error: unknown): boolean {
  return error instanceof LibsqlError && error.code === 'SQLITE_CONSTRAINT'
}
