import { randomUUID } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'
import type { Difficulty, DuelRow, EntryRow } from '../db/types.ts'
import { getOrCreateUser, getUserAddress } from '../db/users.ts'
import { confirmStake } from '../entries/service.ts'
import { submitRun } from '../runs/service.ts'
import { DEFAULT_LOCK_TTL_MS, settlementObligations } from './stateMachine.ts'
import type { SettledDuel } from './stateMachine.ts'
import type { KeystrokeEvent } from '../../shared/timingEngine.ts'
import type { HouseWallet } from '../../services/escrow.ts'
import { payout, refund } from '../../services/escrow.ts'

/**
 * Player B's flow: browse open entries, challenge one (locking it and
 * taking B's stake before the paragraph renders), then submit the race —
 * which settles the duel immediately: compare both server-recorded times,
 * apply the house rake, pay the winner (or refund both on a tie), and
 * hand back the reveal.
 */

/** The house's cut of a decisive win. Ties are refunded in full — nothing is raked from a refund. */
export const HOUSE_RAKE = 0.1

export interface OpenEntrySummary {
  entryId: string
  creatorAddress: string
  stakeLuna: number
  difficulty: Difficulty
  createdAt: string
}

/** Opponent address, stake, difficulty, and age only — never a time. Excludes the caller's own entries and anything past its 24h window. */
export function listOpenEntries(db: DatabaseSync, excludeNimAddress?: string): OpenEntrySummary[] {
  const nowIso = new Date().toISOString()
  const rows = db
    .prepare(
      `SELECT e.id as entry_id, u.nim_address as creator_address, e.stake_luna, p.difficulty, e.created_at
       FROM entries e
       JOIN users u ON u.id = e.creator_user_id
       JOIN paragraphs p ON p.id = e.paragraph_id
       WHERE e.status = 'OPEN' AND e.expires_at > ?
       ORDER BY e.created_at ASC`,
    )
    .all(nowIso) as { entry_id: string, creator_address: string, stake_luna: number, difficulty: Difficulty, created_at: string }[]

  return rows
    .filter((row) => row.creator_address !== excludeNimAddress)
    .map((row) => ({
      entryId: row.entry_id,
      creatorAddress: row.creator_address,
      stakeLuna: row.stake_luna,
      difficulty: row.difficulty,
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

  // B must match this specific entry's stake — its own recorded amount is
  // the authority here, not a difficulty lookup, since the entry already
  // pins the tier (and therefore the amount) it was created at.
  const stake = await confirmStake(db, wallet, challengerId, { ...input, valueLuna: entry.stake_luna })
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

export type SubmitChallengeResult =
  | {
      ok: true
      outcome: 'creator' | 'challenger' | 'tie'
      creatorDurationMs: number
      challengerDurationMs: number
      deltaMs: number
      txHashes: string[]
    }
  | { ok: false, reason: string }

function getRunDuration(db: DatabaseSync, runId: string): number {
  const row = db.prepare('SELECT duration_ms FROM keystroke_runs WHERE id = ?').get(runId) as
    | { duration_ms: number | null }
    | undefined
  if (!row || row.duration_ms === null) throw new Error(`run ${runId} has no recorded duration`)
  return row.duration_ms
}

/**
 * Compares both server-recorded times, pays out (or refunds a tie), and
 * marks the duel settled. Reuses the pure Phase 10 `settlementObligations`
 * for the pre-rake split — lower duration wins, equal durations tie — then
 * applies the house rake only to a decisive win, never to a tie refund
 * ("refunding both, minus nothing").
 *
 * Safe to call again for an already-settled duel: the comparison is pure
 * (recomputed identically from persisted durations every time) and
 * `payout`/`refund` are themselves idempotent per duel, so a retry just
 * re-derives the same reveal without moving money twice.
 */
async function settleDuel(
  db: DatabaseSync,
  wallet: HouseWallet,
  input: { duelId: string, entry: EntryRow, challengerUserId: string, challengerRunId: string },
): Promise<Extract<SubmitChallengeResult, { ok: true }>> {
  const creatorDurationMs = getRunDuration(db, input.entry.keystroke_run_id)
  const challengerDurationMs = getRunDuration(db, input.challengerRunId)

  const winnerUserId =
    creatorDurationMs === challengerDurationMs
      ? null
      : creatorDurationMs < challengerDurationMs
        ? input.entry.creator_user_id
        : input.challengerUserId

  const settled: SettledDuel = {
    status: 'SETTLED',
    entryId: input.entry.id,
    creatorUserId: input.entry.creator_user_id,
    stakeLuna: input.entry.stake_luna,
    entryExpiresAt: new Date(input.entry.expires_at).getTime(),
    challengerUserId: input.challengerUserId,
    winnerUserId,
  }

  const txHashes: string[] = []
  for (const obligation of settlementObligations(settled)) {
    const recipientAddress = getUserAddress(db, obligation.userId)
    const record =
      winnerUserId === null
        ? await refund(db, wallet, {
            idempotencyKey: `refund-${input.duelId}-${obligation.userId}`,
            userId: obligation.userId,
            recipientAddress,
            valueLuna: obligation.amountLuna,
          })
        : await payout(db, wallet, {
            idempotencyKey: `payout-${input.duelId}`,
            userId: obligation.userId,
            recipientAddress,
            valueLuna: Math.round(obligation.amountLuna * (1 - HOUSE_RAKE)),
          })
    if (record.txHash) txHashes.push(record.txHash)
  }

  db.prepare('UPDATE duels SET winner_user_id = ?, settled_at = ? WHERE id = ?').run(
    winnerUserId,
    new Date().toISOString(),
    input.duelId,
  )
  db.prepare("UPDATE entries SET status = 'SETTLED' WHERE id = ?").run(input.entry.id)

  return {
    ok: true,
    outcome: winnerUserId === null ? 'tie' : winnerUserId === input.entry.creator_user_id ? 'creator' : 'challenger',
    creatorDurationMs,
    challengerDurationMs,
    deltaMs: Math.abs(creatorDurationMs - challengerDurationMs),
    txHashes,
  }
}

/**
 * Records the challenger's run, then immediately settles the duel: compare
 * both times, pay the winner (minus the house rake) or refund a tie, and
 * return the reveal — both times, the delta, and the transaction hash(es).
 */
export async function submitChallenge(
  db: DatabaseSync,
  wallet: HouseWallet,
  input: { entryId: string, nimAddress: string, events: KeystrokeEvent[] },
): Promise<SubmitChallengeResult> {
  const entry = db.prepare('SELECT * FROM entries WHERE id = ?').get(input.entryId) as EntryRow | undefined
  if (!entry) return { ok: false, reason: 'unknown entry' }

  const duel = db.prepare('SELECT * FROM duels WHERE entry_id = ?').get(input.entryId) as DuelRow | undefined
  if (!duel) return { ok: false, reason: 'entry has not been challenged' }

  const challengerId = getOrCreateUser(db, input.nimAddress)
  if (challengerId !== duel.challenger_user_id) {
    return { ok: false, reason: 'only the challenger can submit a run for this entry' }
  }

  let challengerRunId = duel.challenger_keystroke_run_id
  if (!challengerRunId) {
    const runResult = submitRun(db, { nimAddress: input.nimAddress, paragraphId: entry.paragraph_id, events: input.events })
    if (!runResult.ok) return { ok: false, reason: runResult.reason }
    challengerRunId = runResult.runId
    db.prepare('UPDATE duels SET challenger_keystroke_run_id = ? WHERE entry_id = ?').run(challengerRunId, input.entryId)
  }

  return settleDuel(db, wallet, {
    duelId: duel.id,
    entry,
    challengerUserId: challengerId,
    challengerRunId,
  })
}
