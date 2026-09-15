import { randomUUID } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'
import type { KeystrokeEvent } from '../../shared/timingEngine.ts'
import { validateRun } from './validateRun.ts'

export interface SubmitRunInput {
  nimAddress: string
  paragraphId: string
  events: KeystrokeEvent[]
}

export type SubmitRunResult =
  | { ok: true, runId: string, durationMs: number }
  | { ok: false, reason: string }

function getOrCreateUser(db: DatabaseSync, nimAddress: string): string {
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

/**
 * Validates a submitted run against its paragraph and, only if valid,
 * persists it — with the server's own recomputed duration, never anything
 * the client sent.
 */
export function submitRun(db: DatabaseSync, input: SubmitRunInput): SubmitRunResult {
  const paragraph = db.prepare('SELECT id, body FROM paragraphs WHERE id = ?').get(input.paragraphId) as
    | { id: string, body: string }
    | undefined
  if (!paragraph) {
    return { ok: false, reason: 'unknown paragraph' }
  }

  const validation = validateRun(paragraph.body, input.events)
  if (!validation.valid) {
    return { ok: false, reason: validation.reason }
  }

  const userId = getOrCreateUser(db, input.nimAddress)
  const runId = randomUUID()
  db.prepare(
    `INSERT INTO keystroke_runs (id, user_id, paragraph_id, events, duration_ms, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(runId, userId, paragraph.id, JSON.stringify(input.events), validation.durationMs, new Date().toISOString())

  return { ok: true, runId, durationMs: validation.durationMs }
}
