import { randomUUID } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'
import type { EntryRow } from '../db/types.ts'
import { getOrCreateUser } from '../db/users.ts'
import { confirmStake } from '../entries/service.ts'
import { submitRun } from '../runs/service.ts'
import { DEFAULT_LOCK_TTL_MS } from './stateMachine.ts'
import type { KeystrokeEvent } from '../../shared/timingEngine.ts'
import type { HouseWallet } from '../../services/escrow.ts'

/**
 * Player B's flow: browse open entries, challenge one (locking it and
 * taking B's stake before the paragraph renders), then submit the race.
 *
 * Deliberately stops at recording B's run. Comparing times, deciding a
 * winner, and paying out are Phase 13's job ("Settlement and payout" —
 * the build plan explicitly places "fetch A's time, compare... pay the
 * winner" and "show the reveal: both times" there, not here).
 */

export interface OpenEntrySummary {
  entryId: string
  creatorAddress: string
  stakeLuna: number
  createdAt: string
}

/** Opponent address, stake, and age only — never a time. Excludes the caller's own entries and anything past its 24h window. */
export function listOpenEntries(db: DatabaseSync, excludeNimAddress?: string): OpenEntrySummary[] {
  const nowIso = new Date().toISOString()
  const rows = db
    .prepare(
      `SELECT e.id as entry_id, u.nim_address as creator_address, e.stake_luna, e.created_at
       FROM entries e
       JOIN users u ON u.id = e.creator_user_id
       WHERE e.status = 'OPEN' AND e.expires_at > ?
       ORDER BY e.created_at ASC`,
    )
    .all(nowIso) as { entry_id: string, creator_address: string, stake_luna: number, created_at: string }[]

  return rows
    .filter((row) => row.creator_address !== excludeNimAddress)
    .map((row) => ({
      entryId: row.entry_id,
      creatorAddress: row.creator_address,
      stakeLuna: row.stake_luna,
      createdAt: row.created_at,
    }))
}

export type ChallengeResult =
  | { ok: true, paragraphId: string, paragraphBody: string }
  | { ok: false, reason: string }

/**
 * Locks an OPEN entry for this challenger and takes B's stake before the
 * paragraph renders. The lock claim is a single conditional `UPDATE`
 * (`WHERE status = 'OPEN'`) with no `await` before it — SQLite is
 * synchronous, so two near-simultaneous challenge requests can't both see
 * `status = 'OPEN'`: exactly one `UPDATE` affects a row, the other affects
 * none. That's the whole mechanism; nothing more elaborate is needed to
 * make a race between two challengers safe.
 *
 * Idempotent for the *same* challenger retrying (matched by user id, not
 * by stake tx hash, so it doesn't matter whether the retry resends the
 * same hash): returns the same paragraph again without re-locking or
 * re-charging. A *different* challenger arriving after the entry is
 * already locked gets a clean rejection.
 */
export async function challengeEntry(
  db: DatabaseSync,
  wallet: HouseWallet,
  input: { entryId: string, nimAddress: string, stakeTxHash: string },
): Promise<ChallengeResult> {
  const entry = db.prepare('SELECT * FROM entries WHERE id = ?').get(input.entryId) as EntryRow | undefined
  if (!entry) return { ok: false, reason: 'unknown entry' }

  const challengerId = getOrCreateUser(db, input.nimAddress)
  if (challengerId === entry.creator_user_id) {
    return { ok: false, reason: 'cannot challenge your own entry' }
  }

  const existingDuel = db.prepare('SELECT challenger_user_id FROM duels WHERE entry_id = ?').get(input.entryId) as
    | { challenger_user_id: string }
    | undefined
  if (existingDuel) {
    if (existingDuel.challenger_user_id !== challengerId) {
      return { ok: false, reason: 'entry is no longer open' }
    }
    const paragraph = db.prepare('SELECT id, body FROM paragraphs WHERE id = ?').get(entry.paragraph_id) as {
      id: string
      body: string
    }
    return { ok: true, paragraphId: paragraph.id, paragraphBody: paragraph.body }
  }

  const nowIso = new Date().toISOString()
  const locked = db
    .prepare("UPDATE entries SET status = 'LOCKED' WHERE id = ? AND status = 'OPEN' AND expires_at > ?")
    .run(input.entryId, nowIso)
  if (locked.changes === 0) {
    return { ok: false, reason: 'entry is no longer open' }
  }

  const stake = await confirmStake(db, wallet, challengerId, input)
  if (!stake.ok) {
    // We held the lock; a failed stake releases it for someone else to try.
    db.prepare("UPDATE entries SET status = 'OPEN' WHERE id = ?").run(input.entryId)
    return stake
  }

  db.prepare(
    `INSERT INTO duels (id, entry_id, challenger_user_id, challenger_keystroke_run_id, locked_at, lock_ttl_expires_at, winner_user_id, settled_at)
     VALUES (?, ?, ?, NULL, ?, ?, NULL, NULL)`,
  ).run(randomUUID(), input.entryId, challengerId, nowIso, new Date(Date.now() + DEFAULT_LOCK_TTL_MS).toISOString())

  const paragraph = db.prepare('SELECT id, body FROM paragraphs WHERE id = ?').get(entry.paragraph_id) as {
    id: string
    body: string
  }
  return { ok: true, paragraphId: paragraph.id, paragraphBody: paragraph.body }
}

export type SubmitChallengeResult = { ok: true } | { ok: false, reason: string }

/**
 * Records the challenger's run. Not the settlement — no comparison, no
 * winner, no payout, nothing about A's time here or in the response. That's
 * intentionally left for Phase 13 to add on top of the row this writes.
 */
export function submitChallenge(
  db: DatabaseSync,
  input: { entryId: string, nimAddress: string, events: KeystrokeEvent[] },
): SubmitChallengeResult {
  const entry = db.prepare('SELECT * FROM entries WHERE id = ?').get(input.entryId) as EntryRow | undefined
  if (!entry) return { ok: false, reason: 'unknown entry' }

  const duel = db.prepare('SELECT * FROM duels WHERE entry_id = ?').get(input.entryId) as
    | { challenger_user_id: string, challenger_keystroke_run_id: string | null }
    | undefined
  if (!duel) return { ok: false, reason: 'entry has not been challenged' }

  const challengerId = getOrCreateUser(db, input.nimAddress)
  if (challengerId !== duel.challenger_user_id) {
    return { ok: false, reason: 'only the challenger can submit a run for this entry' }
  }

  if (duel.challenger_keystroke_run_id) {
    return { ok: true } // already recorded — idempotent retry
  }

  const runResult = submitRun(db, { nimAddress: input.nimAddress, paragraphId: entry.paragraph_id, events: input.events })
  if (!runResult.ok) return { ok: false, reason: runResult.reason }

  db.prepare('UPDATE duels SET challenger_keystroke_run_id = ? WHERE entry_id = ?').run(runResult.runId, input.entryId)
  return { ok: true }
}
