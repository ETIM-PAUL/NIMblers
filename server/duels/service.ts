import { randomUUID } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'
import type { Difficulty, DuelRow, EntryRow, EntryVisibility } from '../db/types.ts'
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

/**
 * Opponent address, stake, difficulty, and age only — never a time.
 * Excludes the caller's own entries, anything past its 24h window, and —
 * this is the dashboard, not a lookup — any entry its creator marked
 * PRIVATE. A private entry is discoverable only through the shareable
 * link that carries its id directly; see `getEntryForChallenge`.
 */
export function listOpenEntries(db: DatabaseSync, excludeNimAddress?: string): OpenEntrySummary[] {
  const nowIso = new Date().toISOString()
  const rows = db
    .prepare(
      `SELECT e.id as entry_id, u.nim_address as creator_address, e.stake_luna, p.difficulty, e.created_at
       FROM entries e
       JOIN users u ON u.id = e.creator_user_id
       JOIN paragraphs p ON p.id = e.paragraph_id
       WHERE e.status = 'OPEN' AND e.expires_at > ? AND e.visibility = 'PUBLIC'
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

export type EntryLookupResult =
  | { ok: true, entry: OpenEntrySummary & { visibility: EntryVisibility } }
  | { ok: false, reason: string }

/**
 * Looks up a single entry by id, regardless of its visibility — this is
 * what a shared link resolves through. Knowing the id (an unguessable
 * random UUID) stands in for having been invited; the entry still has to
 * actually be open, unexpired, and not the caller's own for a challenge to
 * make sense, so those are checked here too rather than leaving it to
 * `challengeEntry` to fail confusingly later.
 */
export function getEntryForChallenge(db: DatabaseSync, entryId: string, excludeNimAddress?: string): EntryLookupResult {
  const row = db
    .prepare(
      `SELECT e.id as entry_id, u.nim_address as creator_address, e.stake_luna, p.difficulty, e.created_at, e.status, e.expires_at, e.visibility
       FROM entries e
       JOIN users u ON u.id = e.creator_user_id
       JOIN paragraphs p ON p.id = e.paragraph_id
       WHERE e.id = ?`,
    )
    .get(entryId) as
    | {
        entry_id: string
        creator_address: string
        stake_luna: number
        difficulty: Difficulty
        created_at: string
        status: string
        expires_at: string
        visibility: EntryVisibility
      }
    | undefined
  if (!row) return { ok: false, reason: 'unknown entry' }
  if (row.creator_address === excludeNimAddress) return { ok: false, reason: 'cannot challenge your own entry' }
  if (row.status !== 'OPEN' || new Date(row.expires_at).getTime() <= Date.now()) {
    return { ok: false, reason: 'this duel is no longer open' }
  }

  return {
    ok: true,
    entry: {
      entryId: row.entry_id,
      creatorAddress: row.creator_address,
      stakeLuna: row.stake_luna,
      difficulty: row.difficulty,
      createdAt: row.created_at,
      visibility: row.visibility,
    },
  }
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

/** How long B has to decide (retry or take the loss) once a double-trial retry is offered. */
export const RETRY_DECISION_WINDOW_MS = 3 * 60_000

export type SettledReveal = {
  ok: true
  pending: false
  outcome: 'creator' | 'challenger' | 'tie'
  creatorDurationMs: number
  challengerDurationMs: number
  deltaMs: number
  txHashes: string[]
}

export type SubmitChallengeResult =
  | SettledReveal
  /** B lost the first attempt and the entry allows a retry — nothing is settled yet, and A's time stays hidden. */
  | { ok: true, pending: true, retryDeadline: string, retryStakeLuna: number }
  | { ok: false, reason: string }

function getRunDuration(db: DatabaseSync, runId: string): number {
  const row = db.prepare('SELECT duration_ms FROM keystroke_runs WHERE id = ?').get(runId) as
    | { duration_ms: number | null }
    | undefined
  if (!row || row.duration_ms === null) throw new Error(`run ${runId} has no recorded duration`)
  return row.duration_ms
}

function finalChallengerRunId(duel: DuelRow): string {
  const runId = duel.retry_keystroke_run_id ?? duel.challenger_keystroke_run_id
  if (!runId) throw new Error(`duel ${duel.id} has no challenger run recorded`)
  return runId
}

/** Reconstructs the reveal for a duel that's already settled — a late duplicate call, or one that lost a race to another settlement path. Pure and cheap: everything it needs is already persisted. */
function reconstructReveal(db: DatabaseSync, entry: EntryRow, duel: DuelRow): SettledReveal {
  const creatorDurationMs = getRunDuration(db, entry.keystroke_run_id)
  const challengerDurationMs = getRunDuration(db, finalChallengerRunId(duel))
  const winnerUserId = duel.winner_user_id
  const idempotencyKeys = winnerUserId === null
    ? [`refund-${duel.id}-${entry.creator_user_id}`, `refund-${duel.id}-${duel.challenger_user_id}`]
    : [`payout-${duel.id}`]
  const txHashes = idempotencyKeys
    .map((key) => (db.prepare('SELECT tx_hash FROM payouts WHERE idempotency_key = ?').get(key) as { tx_hash: string | null } | undefined)?.tx_hash)
    .filter((hash): hash is string => hash !== null && hash !== undefined)

  return {
    ok: true,
    pending: false,
    outcome: winnerUserId === null ? 'tie' : winnerUserId === entry.creator_user_id ? 'creator' : 'challenger',
    creatorDurationMs,
    challengerDurationMs,
    deltaMs: Math.abs(creatorDurationMs - challengerDurationMs),
    txHashes,
  }
}

/**
 * Moves the money and marks the duel settled, for whatever the pot actually
 * came to — `challengerStakeLuna` may exceed `entry.stake_luna` after a
 * double-trial retry, so the pure Phase 10 `settlementObligations` is fed
 * the challenger's real total rather than assuming it mirrors the
 * creator's. Applies the house rake only to a decisive win, never to a tie
 * refund ("refunding both, minus nothing").
 *
 * The `payout`/`refund` calls are idempotent per duel on their own (see
 * services/escrow.ts), so calling this twice with the same winner never
 * moves money twice — that covers a genuine retry of the same call. What
 * it does not cover is two *different* determinations racing for the same
 * duel (e.g. a retry finishing at the same moment a decline was clicked);
 * the final bookkeeping update is a conditional `UPDATE ... WHERE
 * settled_at IS NULL`, so only the first one to get there actually records
 * the outcome — the loser of that race still gets back the correct tx
 * hashes above, since escrow's own idempotency key already resolved to
 * whichever attempt claimed it first.
 */
async function finalizeSettlement(
  db: DatabaseSync,
  wallet: HouseWallet,
  input: { duelId: string, entry: EntryRow, challengerUserId: string, winnerUserId: string | null, challengerStakeLuna: number },
): Promise<string[]> {
  const settled: SettledDuel = {
    status: 'SETTLED',
    entryId: input.entry.id,
    creatorUserId: input.entry.creator_user_id,
    stakeLuna: input.entry.stake_luna,
    entryExpiresAt: new Date(input.entry.expires_at).getTime(),
    challengerUserId: input.challengerUserId,
    winnerUserId: input.winnerUserId,
    challengerStakeLuna: input.challengerStakeLuna,
  }

  const txHashes: string[] = []
  for (const obligation of settlementObligations(settled)) {
    const recipientAddress = getUserAddress(db, obligation.userId)
    const record =
      input.winnerUserId === null
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

  db.prepare("UPDATE duels SET winner_user_id = ?, settled_at = ? WHERE id = ? AND settled_at IS NULL")
    .run(input.winnerUserId, new Date().toISOString(), input.duelId)
  db.prepare("UPDATE entries SET status = 'SETTLED' WHERE id = ?").run(input.entry.id)

  return txHashes
}

function buildSettledReveal(
  entry: EntryRow,
  winnerUserId: string | null,
  creatorDurationMs: number,
  challengerDurationMs: number,
  txHashes: string[],
): SettledReveal {
  return {
    ok: true,
    pending: false,
    outcome: winnerUserId === null ? 'tie' : winnerUserId === entry.creator_user_id ? 'creator' : 'challenger',
    creatorDurationMs,
    challengerDurationMs,
    deltaMs: Math.abs(creatorDurationMs - challengerDurationMs),
    txHashes,
  }
}

/**
 * Records the challenger's first run and compares it against the
 * creator's. A decisive win, a tie, or an entry that doesn't allow a
 * retry all settle immediately, exactly as before. A loss on an entry
 * that *does* allow a retry (`allow_rematch`) is the one new case: nothing
 * is settled and A's time stays hidden — the caller instead gets a
 * `pending` result with a deadline and the (doubled) retry stake, and the
 * challenger decides next via `retryStake`/`retrySubmit` or `declineRetry`.
 *
 * Idempotent: a late duplicate call after the duel has moved on (settled
 * by a retry, a decline, or the expiry sweep) reconstructs the real
 * outcome from persisted data rather than re-deriving a stale one from
 * just the first attempt.
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

  if (duel.settled_at) return reconstructReveal(db, entry, duel)
  if (duel.retry_offer_expires_at) {
    return { ok: true, pending: true, retryDeadline: duel.retry_offer_expires_at, retryStakeLuna: entry.stake_luna * 2 }
  }

  let challengerRunId = duel.challenger_keystroke_run_id
  if (!challengerRunId) {
    const runResult = submitRun(db, { nimAddress: input.nimAddress, paragraphId: entry.paragraph_id, events: input.events })
    if (!runResult.ok) return { ok: false, reason: runResult.reason }
    challengerRunId = runResult.runId
    db.prepare('UPDATE duels SET challenger_keystroke_run_id = ? WHERE entry_id = ?').run(challengerRunId, input.entryId)
  }

  const creatorDurationMs = getRunDuration(db, entry.keystroke_run_id)
  const challengerDurationMs = getRunDuration(db, challengerRunId)
  const winnerUserId =
    creatorDurationMs === challengerDurationMs
      ? null
      : creatorDurationMs < challengerDurationMs
        ? entry.creator_user_id
        : challengerId

  if (winnerUserId === entry.creator_user_id && entry.allow_rematch) {
    const retryDeadline = new Date(Date.now() + RETRY_DECISION_WINDOW_MS).toISOString()
    db.prepare('UPDATE duels SET retry_offer_expires_at = ? WHERE id = ?').run(retryDeadline, duel.id)
    return { ok: true, pending: true, retryDeadline, retryStakeLuna: entry.stake_luna * 2 }
  }

  const txHashes = await finalizeSettlement(db, wallet, {
    duelId: duel.id,
    entry,
    challengerUserId: challengerId,
    winnerUserId,
    challengerStakeLuna: entry.stake_luna,
  })
  return buildSettledReveal(entry, winnerUserId, creatorDurationMs, challengerDurationMs, txHashes)
}

export type RetryStakeResult = { ok: true } | { ok: false, reason: string }

/**
 * Verifies the challenger's additional double-stake for a pending retry.
 * The client already has the paragraph from the first attempt (it hasn't
 * changed), so — unlike the reveal-then-submit shape everywhere else in
 * this app — there's nothing to reveal here; this exists purely so the
 * stake is confirmed on-chain *before* the client shows the retry's typing
 * screen, matching the same "never show/act on anything before the money
 * is verified" rule the rest of the app follows.
 */
export async function retryStake(
  db: DatabaseSync,
  wallet: HouseWallet,
  input: { entryId: string, nimAddress: string, stakeTxHash: string },
): Promise<RetryStakeResult> {
  const entry = db.prepare('SELECT * FROM entries WHERE id = ?').get(input.entryId) as EntryRow | undefined
  if (!entry) return { ok: false, reason: 'unknown entry' }
  const duel = db.prepare('SELECT * FROM duels WHERE entry_id = ?').get(input.entryId) as DuelRow | undefined
  if (!duel) return { ok: false, reason: 'entry has not been challenged' }

  const challengerId = getOrCreateUser(db, input.nimAddress)
  if (challengerId !== duel.challenger_user_id) return { ok: false, reason: 'only the challenger can retry this duel' }
  if (duel.settled_at) return { ok: false, reason: 'this duel has already been resolved' }
  if (!duel.retry_offer_expires_at) return { ok: false, reason: 'no retry is available for this duel' }
  if (new Date(duel.retry_offer_expires_at).getTime() <= Date.now()) return { ok: false, reason: 'the retry window has expired' }

  const stake = await confirmStake(db, wallet, challengerId, {
    nimAddress: input.nimAddress,
    stakeTxHash: input.stakeTxHash,
    valueLuna: entry.stake_luna * 2,
  })
  if (!stake.ok) return stake
  return { ok: true }
}

/**
 * The challenger's second and final attempt. Always settles, win or lose —
 * "that is the end," no further retries. Re-confirms the same stake
 * `retryStake` already verified (idempotent, cheap — same pattern as
 * `revealEntry` → `createEntry`), so this alone is safe to call even if
 * the client skipped straight here.
 */
export async function retrySubmit(
  db: DatabaseSync,
  wallet: HouseWallet,
  input: { entryId: string, nimAddress: string, stakeTxHash: string, events: KeystrokeEvent[] },
): Promise<SubmitChallengeResult> {
  const entry = db.prepare('SELECT * FROM entries WHERE id = ?').get(input.entryId) as EntryRow | undefined
  if (!entry) return { ok: false, reason: 'unknown entry' }
  const duel = db.prepare('SELECT * FROM duels WHERE entry_id = ?').get(input.entryId) as DuelRow | undefined
  if (!duel) return { ok: false, reason: 'entry has not been challenged' }

  const challengerId = getOrCreateUser(db, input.nimAddress)
  if (challengerId !== duel.challenger_user_id) return { ok: false, reason: 'only the challenger can retry this duel' }
  if (duel.settled_at) return reconstructReveal(db, entry, duel)
  if (!duel.retry_offer_expires_at) return { ok: false, reason: 'no retry is available for this duel' }

  let retryRunId = duel.retry_keystroke_run_id
  if (!retryRunId) {
    if (new Date(duel.retry_offer_expires_at).getTime() <= Date.now()) return { ok: false, reason: 'the retry window has expired' }

    const stake = await confirmStake(db, wallet, challengerId, {
      nimAddress: input.nimAddress,
      stakeTxHash: input.stakeTxHash,
      valueLuna: entry.stake_luna * 2,
    })
    if (!stake.ok) return stake

    const runResult = submitRun(db, { nimAddress: input.nimAddress, paragraphId: entry.paragraph_id, events: input.events })
    if (!runResult.ok) return { ok: false, reason: runResult.reason }
    retryRunId = runResult.runId
    db.prepare('UPDATE duels SET retry_keystroke_run_id = ? WHERE id = ?').run(retryRunId, duel.id)
  }

  const creatorDurationMs = getRunDuration(db, entry.keystroke_run_id)
  const challengerDurationMs = getRunDuration(db, retryRunId)
  const winnerUserId =
    creatorDurationMs === challengerDurationMs
      ? null
      : creatorDurationMs < challengerDurationMs
        ? entry.creator_user_id
        : challengerId

  const txHashes = await finalizeSettlement(db, wallet, {
    duelId: duel.id,
    entry,
    challengerUserId: challengerId,
    winnerUserId,
    challengerStakeLuna: entry.stake_luna * 3, // original + the doubled retry stake
  })
  return buildSettledReveal(entry, winnerUserId, creatorDurationMs, challengerDurationMs, txHashes)
}

/**
 * The challenger explicitly takes the loss instead of retrying — "he logs
 * off and then the funds go to A," just via an actual tap instead of
 * silently walking away (which the expiry sweep's `settleAbandonedRetry`
 * handles on a timeout, for whoever really does just walk away).
 */
export async function declineRetry(
  db: DatabaseSync,
  wallet: HouseWallet,
  input: { entryId: string, nimAddress: string },
): Promise<SubmitChallengeResult> {
  const entry = db.prepare('SELECT * FROM entries WHERE id = ?').get(input.entryId) as EntryRow | undefined
  if (!entry) return { ok: false, reason: 'unknown entry' }
  const duel = db.prepare('SELECT * FROM duels WHERE entry_id = ?').get(input.entryId) as DuelRow | undefined
  if (!duel) return { ok: false, reason: 'entry has not been challenged' }

  const challengerId = getOrCreateUser(db, input.nimAddress)
  if (challengerId !== duel.challenger_user_id) return { ok: false, reason: "only the challenger can decline this duel's retry" }
  if (duel.settled_at) return reconstructReveal(db, entry, duel)
  if (!duel.retry_offer_expires_at) return { ok: false, reason: 'no retry is pending for this duel' }
  if (duel.retry_keystroke_run_id) return { ok: false, reason: 'the retry has already been taken' }

  return settleAbandonedRetry(db, wallet, { duelId: duel.id, entry, challengerUserId: challengerId })
}

/**
 * Settles a duel whose retry offer nobody acted on — the challenger simply
 * never came back — as a loss, at the original pot only. Shared by
 * `declineRetry` (an explicit tap) and the expiry sweep (a timeout, for
 * whoever just walks away instead of tapping anything).
 */
export async function settleAbandonedRetry(
  db: DatabaseSync,
  wallet: HouseWallet,
  input: { duelId: string, entry: EntryRow, challengerUserId: string },
): Promise<SettledReveal> {
  const duel = db.prepare('SELECT * FROM duels WHERE id = ?').get(input.duelId) as unknown as DuelRow
  const creatorDurationMs = getRunDuration(db, input.entry.keystroke_run_id)
  const challengerDurationMs = getRunDuration(db, duel.challenger_keystroke_run_id!)

  const txHashes = await finalizeSettlement(db, wallet, {
    duelId: input.duelId,
    entry: input.entry,
    challengerUserId: input.challengerUserId,
    winnerUserId: input.entry.creator_user_id,
    challengerStakeLuna: input.entry.stake_luna,
  })
  return buildSettledReveal(input.entry, input.entry.creator_user_id, creatorDurationMs, challengerDurationMs, txHashes)
}
