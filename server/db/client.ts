import { DatabaseSync } from 'node:sqlite'
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'

// node:sqlite is experimental (Node 22+) but ships with Node itself, so
// picking it over a driver like better-sqlite3 keeps this project at zero
// new dependencies for the whole data layer.
const DEFAULT_DB_PATH = 'server/db/data.sqlite'

let db: DatabaseSync | null = null

export function getDb(): DatabaseSync {
  if (db) return db

  const dbPath = process.env.DB_PATH ?? DEFAULT_DB_PATH
  if (dbPath !== ':memory:') mkdirSync(dirname(dbPath), { recursive: true })

  db = new DatabaseSync(dbPath)
  db.exec('PRAGMA foreign_keys = ON')
  return db
}

export function closeDb(): void {
  db?.close()
  db = null
}
