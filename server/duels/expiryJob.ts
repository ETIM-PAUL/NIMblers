import type { DatabaseSync } from 'node:sqlite'
import type { EntryRow } from '../db/types.ts'
import type { HouseWallet } from '../../services/escrow.ts'
import { refund } from '../../services/escrow.ts'
import { getUserAddress } from '../db/users.ts'
import { settleAbandonedRetry } from './service.ts'
import { applyDuelEvent, settlementObligations } from './stateMachine.ts'
import type { LockedDuel, OpenDuel } from './stateMachine.ts'

export interface ExpirySweepResult {
  /** Entry ids whose stale challenger lock was released back to OPEN. */
  releasedLocks: string[]
  /** Entry ids refunded because nobody ever challenged within 24h. */
  refundedEntries: string[]
  /** Entry ids settled as a loss because their double-trial retry window passed with nobody deciding. */
  settledAbandonedRetries: string[]
  /** Entries whose refund/settlement failed this run — claim was reverted (where applicable) so the next sweep retries. */
  errors: { entryId: string, reason: string }[]
}

interface StaleLockRow {
  entry_id: string
  creator_user_id: string
  stake_luna: number
  expires_at: string
  duel_id: string
  challenger_user_id: string
  lock_ttl_expires_at: string
}

interface OpenEntryRow {
  entry_id: string
  creator_user_id: string
  stake_luna: number
  expires_at: string
}

interface AbandonedRetryRow {
  entry_id: string
  duel_id: string
  challenger_user_id: string
}

/**
 * The scheduled sweep from the build plan: releases challenger locks whose
 * TTL lapsed with no submitted run, then refunds entries whose 24h window
 * elapsed with nobody ever challenging. Both transitions are decided by the
 * pure Phase 10 state machine (`applyDuelEvent`), so there's one definition
 * of "expired" the whole codebase agrees on — this job never reimplements
 * the lifecycle rules, only acts on what they decide.
 *
 * Safe to run twice (or concurrently): each row is claimed with the same
 * atomic conditional `UPDATE ... WHERE status = '...'` pattern
 * `challengeEntry`'s lock already relies on, so a second sweep sees zero
 * rows to claim and does nothing. A refund that fails mid-flight reverts
 * its claim back to OPEN rather than stranding the stake in a status no
 * future sweep would ever revisit.
 *
 * A released lock's duel row is deleted, not just its entry status reset —
 * `challengeEntry` treats *any* existing duel row for an entry as "already
 * challenged" regardless of the entry's own status, so a stale row left
 * behind would wrongly reject every future challenger.
 */
export async function runExpirySweep(db: DatabaseSync, wallet: HouseWallet, now: Date = new Date()): Promise<ExpirySweepResult> {
  const nowIso = now.toISOString()
  const nowMs = now.getTime()
  const result: ExpirySweepResult = { releasedLocks: [], refundedEntries: [], settledAbandonedRetries: [], errors: [] }

  const staleLocks = db
    .prepare(
      `SELECT e.id as entry_id, e.creator_user_id, e.stake_luna, e.expires_at,
              d.id as duel_id, d.challenger_user_id, d.lock_ttl_expires_at
       FROM entries e
       JOIN duels d ON d.entry_id = e.id
       WHERE e.status = 'LOCKED' AND d.lock_ttl_expires_at <= ? AND d.challenger_keystroke_run_id IS NULL`,
    )
    .all(nowIso) as unknown as StaleLockRow[]

  for (const row of staleLocks) {
    const locked: LockedDuel = {
      status: 'LOCKED',
      entryId: row.entry_id,
      creatorUserId: row.creator_user_id,
      stakeLuna: row.stake_luna,
      entryExpiresAt: new Date(row.expires_at).getTime(),
      challengerUserId: row.challenger_user_id,
      lockTtlExpiresAt: new Date(row.lock_ttl_expires_at).getTime(),
    }
    const next = applyDuelEvent(locked, { type: 'LOCK_TTL_EXPIRED', now: nowMs })
    if (next.status !== 'OPEN') continue // clock-skew guard: SQL's "now" said past TTL, the reducer disagreed

    const claimed = db.prepare("UPDATE entries SET status = 'OPEN' WHERE id = ? AND status = 'LOCKED'").run(row.entry_id)
    if (claimed.changes === 0) continue // already released by a concurrent or earlier run

    db.prepare('DELETE FROM duels WHERE id = ?').run(row.duel_id)
    result.releasedLocks.push(row.entry_id)
  }

  const expiredEntries = db
    .prepare("SELECT id as entry_id, creator_user_id, stake_luna, expires_at FROM entries WHERE status = 'OPEN' AND expires_at <= ?")
    .all(nowIso) as unknown as OpenEntryRow[]

  for (const row of expiredEntries) {
    const open: OpenDuel = {
      status: 'OPEN',
      entryId: row.entry_id,
      creatorUserId: row.creator_user_id,
      stakeLuna: row.stake_luna,
      entryExpiresAt: new Date(row.expires_at).getTime(),
    }
    const next = applyDuelEvent(open, { type: 'ENTRY_EXPIRED', now: nowMs })
    if (next.status !== 'EXPIRED') continue

    const claimed = db
      .prepare("UPDATE entries SET status = 'EXPIRED' WHERE id = ? AND status = 'OPEN' AND expires_at <= ?")
      .run(row.entry_id, nowIso)
    if (claimed.changes === 0) continue // already handled by a concurrent or earlier run

    const [obligation] = settlementObligations(next)
    try {
      await refund(db, wallet, {
        idempotencyKey: `refund-expired-${row.entry_id}`,
        userId: obligation.userId,
        recipientAddress: getUserAddress(db, obligation.userId),
        valueLuna: obligation.amountLuna,
      })
      result.refundedEntries.push(row.entry_id)
    }
    catch (error) {
      db.prepare("UPDATE entries SET status = 'OPEN' WHERE id = ?").run(row.entry_id)
      result.errors.push({ entryId: row.entry_id, reason: error instanceof Error ? error.message : String(error) })
    }
  }

  // Double trial: a losing first attempt whose retry window passed with
  // nobody ever deciding — "he logs off" — settles as a loss, same as an
  // explicit decline. The `retry_keystroke_run_id IS NULL` guard is the
  // claim: it's also how `retrySubmit`/`declineRetry` recognize a duel as
  // still theirs to settle, so once any of the three sets it (or
  // `settled_at`), the others no longer match this query.
  const abandonedRetries = db
    .prepare(
      `SELECT d.entry_id as entry_id, d.id as duel_id, d.challenger_user_id
       FROM duels d
       WHERE d.retry_offer_expires_at IS NOT NULL AND d.retry_offer_expires_at <= ?
         AND d.settled_at IS NULL AND d.retry_keystroke_run_id IS NULL`,
    )
    .all(nowIso) as unknown as AbandonedRetryRow[]

  for (const row of abandonedRetries) {
    try {
      const entry = db.prepare('SELECT * FROM entries WHERE id = ?').get(row.entry_id) as unknown as EntryRow
      await settleAbandonedRetry(db, wallet, { duelId: row.duel_id, entry, challengerUserId: row.challenger_user_id })
      result.settledAbandonedRetries.push(row.entry_id)
    }
    catch (error) {
      result.errors.push({ entryId: row.entry_id, reason: error instanceof Error ? error.message : String(error) })
    }
  }

  return result
}
