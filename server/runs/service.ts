import { randomUUID } from 'node:crypto'
import type { Db } from '../db/client.ts'
import type { KeystrokeEvent } from '../../shared/timingEngine.ts'
import { getOrCreateUser } from '../db/users.ts'
import { validateRun } from './validateRun.ts'
import { checkIntegrity, DEFAULT_WPM_CEILING } from './integrity.ts'
import type { IntegrityFlag } from './integrity.ts'
import { computeWeakKeys } from './weakKeys.ts'
import type { WeakKeySample, WeakKeyStat } from './weakKeys.ts'

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

async function countRunsToday(db: Db, userId: string): Promise<number> {
  const startOfDay = `${new Date().toISOString().slice(0, 10)}T00:00:00.000Z`
  const row = (await db.execute({
    sql: 'SELECT COUNT(*) c FROM keystroke_runs WHERE user_id = ? AND created_at >= ?',
    args: [userId, startOfDay],
  })).rows[0] as unknown as { c: number }
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
export async function submitRun(db: Db, input: SubmitRunInput, options: SubmitRunOptions = {}): Promise<SubmitRunResult> {
  const paragraph = (await db.execute({ sql: 'SELECT id, body FROM paragraphs WHERE id = ?', args: [input.paragraphId] }))
    .rows[0] as unknown as { id: string, body: string } | undefined
  if (!paragraph) {
    return { ok: false, reason: 'unknown paragraph' }
  }

  const userId = await getOrCreateUser(db, input.nimAddress)

  const dailyLimit = options.dailyRunLimit ?? DEFAULT_DAILY_RUN_LIMIT
  if (await countRunsToday(db, userId) >= dailyLimit) {
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
  await db.execute({
    sql: `INSERT INTO keystroke_runs (id, user_id, paragraph_id, events, duration_ms, flags, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    args: [
      runId,
      userId,
      paragraph.id,
      JSON.stringify(input.events),
      validation.durationMs,
      integrity.flags.length > 0 ? JSON.stringify(integrity.flags) : null,
      new Date().toISOString(),
    ],
  })

  return { ok: true, runId, durationMs: validation.durationMs, flags: integrity.flags }
}

/** Bounds how far back the heatmap looks — a very active player's whole history isn't needed to see which keys still trip them up, and this keeps the query cheap regardless of how long they've been playing. */
const WEAK_KEYS_RUN_LIMIT = 500

/**
 * The characters this address most often types wrong and then corrects,
 * across their own recent runs — see `./weakKeys.ts` for how "wrong" is
 * detected and why it's ranked by rate rather than raw count. Only ever
 * looks at runs this address itself typed (as a duel's creator or
 * challenger); an opponent's keystrokes never factor into your own stats.
 */
export async function getWeakKeysForAddress(db: Db, nimAddress: string): Promise<WeakKeyStat[]> {
  const rows = (await db.execute({
    sql: `SELECT kr.events as events, p.body as body
       FROM keystroke_runs kr
       JOIN paragraphs p ON p.id = kr.paragraph_id
       JOIN users u ON u.id = kr.user_id
       WHERE u.nim_address = ?
       ORDER BY kr.created_at DESC
       LIMIT ?`,
    args: [nimAddress, WEAK_KEYS_RUN_LIMIT],
  })).rows as unknown as { events: string, body: string }[]

  const samples: WeakKeySample[] = rows.map((row) => ({
    events: JSON.parse(row.events) as KeystrokeEvent[],
    targetBody: row.body,
  }))

  return computeWeakKeys(samples)
}
