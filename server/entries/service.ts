import { randomUUID } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'
import type { Difficulty, EntryStatus, EntryVisibility } from '../db/types.ts'
import { getOrCreateUser } from '../db/users.ts'
import { getOrGenerateParagraphForStake } from '../paragraphs/repository.ts'
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
 * then — and only then — generates a fresh paragraph for that tier (see
 * server/paragraphs/generator.ts) and ties it to this specific stake.
 * Calling this again with the same `stakeTxHash` is safe and cheap: the
 * stake was already verified, so `receiveStake` returns the existing
 * ledger row without touching the chain a second time, and the same
 * already-generated paragraph is returned rather than a new one.
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

  const paragraph = getOrGenerateParagraphForStake(db, input.stakeTxHash, input.difficulty)
  return { ok: true, paragraphId: paragraph.id, paragraphBody: paragraph.body }
}

export type CreateEntryResult =
  | { ok: true, entryId: string, status: EntryStatus, expiresAt: string, visibility: EntryVisibility, allowRematch: boolean }
  | { ok: false, reason: string }

/**
 * The "submit" half: re-confirms the stake (idempotent — a no-op if
 * `revealEntry` already verified it), independently re-derives the
 * paragraph that was generated for this specific stake — never trusts a
 * client-supplied paragraph id, which would let someone submit a run
 * against an easier practice paragraph and claim it was this one —
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
 *
 * `visibility` defaults to `PUBLIC` (listed for anyone to browse); `PRIVATE`
 * skips the open-duels dashboard, reachable only via the shareable link the
 * caller builds from the returned `entryId`. `allowRematch` opts this entry
 * into double trial: if the challenger loses their first attempt, they get
 * offered a retry at double the stake (server/duels/service.ts) — resolved
 * automatically either way, with no further action ever needed from A.
 */
export async function createEntry(
  db: DatabaseSync,
  wallet: HouseWallet,
  input: {
    nimAddress: string
    stakeTxHash: string
    difficulty: Difficulty
    events: KeystrokeEvent[]
    visibility?: EntryVisibility
    allowRematch?: boolean
  },
): Promise<CreateEntryResult> {
  const existing = db
    .prepare('SELECT id, status, expires_at, visibility, allow_rematch FROM entries WHERE stake_tx_hash = ?')
    .get(input.stakeTxHash) as
    | { id: string, status: EntryStatus, expires_at: string, visibility: EntryVisibility, allow_rematch: 0 | 1 }
    | undefined
  if (existing) {
    return {
      ok: true,
      entryId: existing.id,
      status: existing.status,
      expiresAt: existing.expires_at,
      visibility: existing.visibility,
      allowRematch: existing.allow_rematch === 1,
    }
  }

  const userId = getOrCreateUser(db, input.nimAddress)
  const stakeLuna = DUEL_STAKE_LUNA_BY_DIFFICULTY[input.difficulty]
  const visibility = input.visibility ?? 'PUBLIC'
  const allowRematch = input.allowRematch ?? false

  const stake = await confirmStake(db, wallet, userId, { ...input, valueLuna: stakeLuna })
  if (!stake.ok) return stake

  const paragraph = getOrGenerateParagraphForStake(db, input.stakeTxHash, input.difficulty)
  const runResult = submitRun(db, { nimAddress: input.nimAddress, paragraphId: paragraph.id, events: input.events })
  if (!runResult.ok) {
    return { ok: false, reason: runResult.reason }
  }

  const entryId = randomUUID()
  const now = new Date()
  const expiresAt = new Date(now.getTime() + DEFAULT_ENTRY_TTL_MS).toISOString()
  db.prepare(
    `INSERT INTO entries
      (id, creator_user_id, paragraph_id, keystroke_run_id, stake_luna, status, created_at, expires_at, stake_tx_hash, visibility, allow_rematch)
      VALUES (?, ?, ?, ?, ?, 'OPEN', ?, ?, ?, ?, ?)`,
  ).run(
    entryId,
    userId,
    paragraph.id,
    runResult.runId,
    stakeLuna,
    now.toISOString(),
    expiresAt,
    input.stakeTxHash,
    visibility,
    allowRematch ? 1 : 0,
  )

  return { ok: true, entryId, status: 'OPEN', expiresAt, visibility, allowRematch }
}
