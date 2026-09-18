import { randomUUID } from 'node:crypto'
import type { Db } from './client.ts'
import { isUniqueConstraintError } from './client.ts'

/**
 * Looks up a user by NIM address, creating one if this is the first time
 * we've seen it. The insert can lose a race to a concurrent call for the
 * same address (two requests from the same address arriving together) —
 * `nim_address` is `UNIQUE`, so that shows up as a constraint error here
 * rather than a duplicate row; on that, just re-read the row the other
 * call won.
 */
export async function getOrCreateUser(db: Db, nimAddress: string): Promise<string> {
  const existing = (await db.execute({ sql: 'SELECT id FROM users WHERE nim_address = ?', args: [nimAddress] }))
    .rows[0] as unknown as { id: string } | undefined
  if (existing) return existing.id

  const id = randomUUID()
  try {
    await db.execute({
      sql: 'INSERT INTO users (id, nim_address, created_at) VALUES (?, ?, ?)',
      args: [id, nimAddress, new Date().toISOString()],
    })
    return id
  }
  catch (error) {
    if (!isUniqueConstraintError(error)) throw error
    const row = (await db.execute({ sql: 'SELECT id FROM users WHERE nim_address = ?', args: [nimAddress] }))
      .rows[0] as unknown as { id: string } | undefined
    if (!row) throw error
    return row.id
  }
}

/** The inverse of {@link getOrCreateUser} — where a payout or refund actually gets sent. */
export async function getUserAddress(db: Db, userId: string): Promise<string> {
  const row = (await db.execute({ sql: 'SELECT nim_address FROM users WHERE id = ?', args: [userId] }))
    .rows[0] as unknown as { nim_address: string } | undefined
  if (!row) throw new Error(`unknown user ${userId}`)
  return row.nim_address
}
