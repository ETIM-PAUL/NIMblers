import { randomUUID } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'
import type { KeystrokeEvent } from '../../shared/timingEngine.ts'
import { getOrCreateUser } from '../db/users.ts'
import { validateRun } from './validateRun.ts'
import { checkIntegrity, DEFAULT_WPM_CEILING } from './integrity.ts'
import type { IntegrityFlag } from './integrity.ts'

export interface SubmitRunInput {
  nimAddress: string
  paragraphId: string
  events: KeystrokeEvent[]
}

export interface SubmitRunOptions {
  dailyRunLimit?: number
  wpmCeiling?: number
}

export type SubmitRunResult =
  | { ok: true, runId: string, durationMs: number, flags: IntegrityFlag[] }
  | { ok: false, reason: string }

/** Starting point — "tune later" applies here too. */
export const DEFAULT_DAILY_RUN_LIMIT = 50

function countRunsToday(db: DatabaseSync, userId: string): number {
  const startOfDay = `${new Date().toISOString().slice(0, 10)}T00:00:00.000Z`
  const row = db
    .prepare('SELECT COUNT(*) c FROM keystroke_runs WHERE user_id = ? AND created_at >= ?')
    .get(userId, startOfDay) as { c: number }
  return row.c
}

/**
 * Validates a submitted run against its paragraph, checks it's within the
 * daily rate limit and passes the integrity layer, and only then persists
 * it — with the server's own recomputed duration, never anything the
 * client sent. Rate limiting and the WPM ceiling are hard rejects; the
 * statistical integrity checks flag but still accept the run (see
 * server/runs/integrity.ts).
 */
export function submitRun(db: DatabaseSync, input: SubmitRunInput, options: SubmitRunOptions = {}): SubmitRunResult {
  const paragraph = db.prepare('SELECT id, body FROM paragraphs WHERE id = ?').get(input.paragraphId) as
    | { id: string, body: string }
    | undefined
  if (!paragraph) {
    return { ok: false, reason: 'unknown paragraph' }
  }

  const userId = getOrCreateUser(db, input.nimAddress)

  const dailyLimit = options.dailyRunLimit ?? DEFAULT_DAILY_RUN_LIMIT
  if (countRunsToday(db, userId) >= dailyLimit) {
    return { ok: false, reason: `daily run limit of ${dailyLimit} reached for this address` }
  }

  const validation = validateRun(paragraph.body, input.events)
  if (!validation.valid) {
    return { ok: false, reason: validation.reason }
  }

  const integrity = checkIntegrity(
    paragraph.body,
    input.events,
    validation.durationMs,
    options.wpmCeiling ?? DEFAULT_WPM_CEILING,
  )
  if (integrity.rejected) {
    return { ok: false, reason: integrity.reason }
  }

  const runId = randomUUID()
  db.prepare(
    `INSERT INTO keystroke_runs (id, user_id, paragraph_id, events, duration_ms, flags, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    runId,
    userId,
    paragraph.id,
    JSON.stringify(input.events),
    validation.durationMs,
    integrity.flags.length > 0 ? JSON.stringify(integrity.flags) : null,
    new Date().toISOString(),
  )

  return { ok: true, runId, durationMs: validation.durationMs, flags: integrity.flags }
}
