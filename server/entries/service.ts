import { randomUUID } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'
import type { Difficulty, EntryStatus } from '../db/types.ts'
import { getOrCreateUser } from '../db/users.ts'
import { getDailyParagraphForToday } from '../paragraphs/repository.ts'
import { submitRun } from '../runs/service.ts'
import { DEFAULT_ENTRY_TTL_MS } from '../duels/stateMachine.ts'
import type { KeystrokeEvent } from '../../shared/timingEngine.ts'
import type { HouseWallet } from '../../services/escrow.ts'
import { receiveStake } from '../../services/escrow.ts'

/** Fixed wager per difficulty tier. */
export const DUEL_STAKE_LUNA_BY_DIFFICULTY: Record<Difficulty, number> = {
  easy: 100_000, // 1 NIM
  medium: 300_000, // 3 NIM
  hard: 500_000, // 5 NIM
}

function stakeIdempotencyKey(stakeTxHash: string): string {
  return `stake-${stakeTxHash}`
}

export async function confirmStake(
  db: DatabaseSync,
  wallet: HouseWallet,
  userId: string,
  input: { nimAddress: string, stakeTxHash: string, valueLuna: number },
): Promise<{ ok: true } | { ok: false, reason: string }> {
  try {
    await receiveStake(db, wallet, {
      idempotencyKey: stakeIdempotencyKey(input.stakeTxHash),
      userId,
      fromAddress: input.nimAddress,
      valueLuna: input.valueLuna,
      txHash: input.stakeTxHash,
    })
    return { ok: true }
  }
  catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : String(error) }
  }
}

export type RevealResult =
  | { ok: true, paragraphId: string, paragraphBody: string }
  | { ok: false, reason: string }

/**
 * The "stake first" half of Player A's flow: independently verifies the
 * stake transaction on-chain for the amount this difficulty tier requires,
 * then — and only then — reveals that tier's daily paragraph. Calling this
 * again with the same `stakeTxHash` is safe and cheap: the stake was
 * already verified, so `receiveStake` returns the existing ledger row
 * without touching the chain a second time.
 */
export async function revealEntry(
  db: DatabaseSync,
  wallet: HouseWallet,
  input: { nimAddress: string, stakeTxHash: string, difficulty: Difficulty },
): Promise<RevealResult> {
  const userId = getOrCreateUser(db, input.nimAddress)

  const stake = await confirmStake(db, wallet, userId, {
    ...input,
    valueLuna: DUEL_STAKE_LUNA_BY_DIFFICULTY[input.difficulty],
  })
  if (!stake.ok) return stake

  const paragraph = getDailyParagraphForToday(db, input.difficulty)
  return { ok: true, paragraphId: paragraph.id, paragraphBody: paragraph.body }
}

export type CreateEntryResult =
  | { ok: true, entryId: string, status: EntryStatus, expiresAt: string }
  | { ok: false, reason: string }

/**
 * The "submit" half: re-confirms the stake (idempotent — a no-op if
 * `revealEntry` already verified it), independently re-derives today's
 * daily paragraph for the claimed difficulty — never trusts a
 * client-supplied paragraph id, which would let someone submit a run
 * against an easier practice paragraph and claim it was the daily one —
 * validates the run through the same replay and integrity pipeline every
 * run goes through, and only then creates the OPEN entry at that tier's
 * stake amount.
 *
 * Idempotent per `stakeTxHash`: one stake transaction can only ever back
 * one entry (enforced by a UNIQUE index, not just this check), so a
 * retried submit after a dropped response returns the entry that already
 * exists instead of validating the run and spending the stake again.
 *
 * The result never includes a duration. Nobody — not even A — ever
 * receives A's own time back over the network; it stays server-side until
 * the duel resolves.
 */
export async function createEntry(
  db: DatabaseSync,
  wallet: HouseWallet,
  input: { nimAddress: string, stakeTxHash: string, difficulty: Difficulty, events: KeystrokeEvent[] },
): Promise<CreateEntryResult> {
  const existing = db
    .prepare('SELECT id, status, expires_at FROM entries WHERE stake_tx_hash = ?')
    .get(input.stakeTxHash) as { id: string, status: EntryStatus, expires_at: string } | undefined
  if (existing) {
    return { ok: true, entryId: existing.id, status: existing.status, expiresAt: existing.expires_at }
  }

  const userId = getOrCreateUser(db, input.nimAddress)
  const stakeLuna = DUEL_STAKE_LUNA_BY_DIFFICULTY[input.difficulty]

  const stake = await confirmStake(db, wallet, userId, { ...input, valueLuna: stakeLuna })
  if (!stake.ok) return stake

  const paragraph = getDailyParagraphForToday(db, input.difficulty)
  const runResult = submitRun(db, { nimAddress: input.nimAddress, paragraphId: paragraph.id, events: input.events })
  if (!runResult.ok) {
    return { ok: false, reason: runResult.reason }
  }

  const entryId = randomUUID()
  const now = new Date()
  const expiresAt = new Date(now.getTime() + DEFAULT_ENTRY_TTL_MS).toISOString()
  db.prepare(
    `INSERT INTO entries
      (id, creator_user_id, paragraph_id, keystroke_run_id, stake_luna, status, created_at, expires_at, stake_tx_hash)
      VALUES (?, ?, ?, ?, ?, 'OPEN', ?, ?, ?)`,
  ).run(entryId, userId, paragraph.id, runResult.runId, stakeLuna, now.toISOString(), expiresAt, input.stakeTxHash)

  return { ok: true, entryId, status: 'OPEN', expiresAt }
}
