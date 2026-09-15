import { randomUUID } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'

/** Looks up a user by NIM address, creating one if this is the first time we've seen it. */
export function getOrCreateUser(db: DatabaseSync, nimAddress: string): string {
  const existing = db.prepare('SELECT id FROM users WHERE nim_address = ?').get(nimAddress) as
    | { id: string }
    | undefined
  if (existing) return existing.id

  const id = randomUUID()
  db.prepare('INSERT INTO users (id, nim_address, created_at) VALUES (?, ?, ?)').run(
    id,
    nimAddress,
    new Date().toISOString(),
  )
  return id
}
