import { randomUUID } from 'node:crypto'
import type { Db } from '../db/client.ts'
import { isUniqueConstraintError } from '../db/client.ts'
import type { Difficulty, GroupDuelRow, GroupDuelStatus, GroupEntryRow, Language } from '../db/types.ts'
import { getOrCreateUser, getUserAddress } from '../db/users.ts'
import { DUEL_STAKE_LUNA_BY_DIFFICULTY, confirmStake } from '../entries/service.ts'
import { generateParagraph } from '../paragraphs/generator.ts'
import { submitRun } from '../runs/service.ts'
import { GROUP_DUEL_WINDOW_MS, splitGroupPot } from './stateMachine.ts'
import type { KeystrokeEvent } from '../../shared/timingEngine.ts'
import type { HouseWallet } from '../../services/escrow.ts'
import { payout, refund } from '../../services/escrow.ts'

/**
 * Group duels: a private N-player race joined by a short shareable code.
 * One paragraph, generated once at creation, is the same for every
 * participant — never shown until they've staked, exactly like the 1v1
 * "stake first, then reveal" rule. Joining and typing can happen at
 * different times (join reserves a slot and takes the stake; typing is a
 * separate step, any time before the group resolves) — someone who joins
 * but never submits simply forfeits their stake into the pot rather than
 * being refunded, which is what makes "close the tab after staking" safe
 * to leave unhandled as its own case: it's just "never submitted."
 */

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789' // no 0/O/1/I — avoids visual ambiguity when read aloud or typed from a screenshot
const CODE_LENGTH = 6

function generateCode(): string {
  let code = ''
  for (let i = 0; i < CODE_LENGTH; i++) {
    code += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)]
  }
  return code
}

export type CreateGroupDuelResult =
  | { ok: true, groupDuelId: string, code: string, maxParticipants: number, stakeLuna: number, difficulty: Difficulty, language: Language, expiresAt: string }
  | { ok: false, reason: string }

/**
 * Sets up a group duel: picks the stake for this difficulty tier (same
 * fixed amounts as 1v1 entries), generates one paragraph up front — fixed
 * for the whole group, unlike entries where each stake can get its own —
 * and mints a short code to share. The host does not stake here; creating
 * is just configuration. The host joins like everyone else, via
 * `joinGroupDuel` with their own code, which is what actually takes a
 * stake and reveals the paragraph to them.
 */
export async function createGroupDuel(
  db: Db,
  input: { nimAddress: string, difficulty: Difficulty, maxParticipants: number, language?: Language },
): Promise<CreateGroupDuelResult> {
  if (!Number.isInteger(input.maxParticipants) || input.maxParticipants < 2 || input.maxParticipants > 50) {
    return { ok: false, reason: 'maxParticipants must be an integer between 2 and 50' }
  }

  const hostUserId = await getOrCreateUser(db, input.nimAddress)
  const stakeLuna = DUEL_STAKE_LUNA_BY_DIFFICULTY[input.difficulty]
  const language = input.language ?? 'en'

  const paragraphId = randomUUID()
  const body = generateParagraph(input.difficulty, language)
  const now = new Date()
  const createdAt = now.toISOString()
  const expiresAt = new Date(now.getTime() + GROUP_DUEL_WINDOW_MS).toISOString()

  await db.execute({
    sql: 'INSERT INTO paragraphs (id, body, difficulty, language, created_at, reveal_stake_tx_hash) VALUES (?, ?, ?, ?, ?, NULL)',
    args: [paragraphId, body, input.difficulty, language, createdAt],
  })

  const groupDuelId = randomUUID()
  // The code space is large enough (33^6 ≈ 1.3 billion) that a collision
  // is practically impossible, but the retry loop costs nothing and means
  // this never has to think about it again.
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = generateCode()
    try {
      await db.execute({
        sql: `INSERT INTO group_duels
          (id, code, host_user_id, paragraph_id, difficulty, language, stake_luna, max_participants, joined_count, status, created_at, expires_at, settled_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, 'OPEN', ?, ?, NULL)`,
        args: [groupDuelId, code, hostUserId, paragraphId, input.difficulty, language, stakeLuna, input.maxParticipants, createdAt, expiresAt],
      })
      return { ok: true, groupDuelId, code, maxParticipants: input.maxParticipants, stakeLuna, difficulty: input.difficulty, language, expiresAt }
    }
    catch (error) {
      if (!isUniqueConstraintError(error)) throw error
      // Collided on `code` — try again with a fresh one.
    }
  }
  throw new Error('failed to generate a unique group duel code after several attempts')
}

export interface GroupDuelPreview {
  code: string
  difficulty: Difficulty
  language: Language
  stakeLuna: number
  maxParticipants: number
  joinedCount: number
  status: GroupDuelStatus
  expiresAt: string
}

/** What a join page shows before staking — no paragraph, same "never reveal before the stake is in" rule as everything else. */
export async function getGroupDuelPreview(db: Db, code: string): Promise<{ ok: true, preview: GroupDuelPreview } | { ok: false, reason: string }> {
  const row = await findGroupDuelByCode(db, code)
  if (!row) return { ok: false, reason: 'unknown group duel code' }
  return {
    ok: true,
    preview: {
      code: row.code,
      difficulty: row.difficulty,
      language: row.language,
      stakeLuna: row.stake_luna,
      maxParticipants: row.max_participants,
      joinedCount: row.joined_count,
      status: row.status,
      expiresAt: row.expires_at,
    },
  }
}

async function findGroupDuelByCode(db: Db, code: string): Promise<GroupDuelRow | undefined> {
  return (await db.execute({ sql: 'SELECT * FROM group_duels WHERE code = ?', args: [code.toUpperCase()] }))
    .rows[0] as unknown as GroupDuelRow | undefined
}

async function findGroupEntry(db: Db, groupDuelId: string, userId: string): Promise<GroupEntryRow | undefined> {
  return (await db.execute({
    sql: 'SELECT * FROM group_entries WHERE group_duel_id = ? AND user_id = ?',
    args: [groupDuelId, userId],
  })).rows[0] as unknown as GroupEntryRow | undefined
}

export type JoinGroupDuelResult =
  | { ok: true, groupDuelId: string, paragraphId: string, paragraphBody: string }
  | { ok: false, reason: string }

/**
 * Claims a slot and takes the stake — join = stake, exactly one action.
 * The slot claim is a single conditional `UPDATE ... WHERE joined_count <
 * max_participants`, the same atomic-claim-via-`rowsAffected` pattern
 * `challengeEntry` uses to lock an entry: no mutex, just the database
 * evaluating the `WHERE` and the write together. A stake that then fails
 * releases the slot back, same as a failed challenge releases its lock.
 *
 * Idempotent per (groupDuelId, userId): a retried join with the same or a
 * different stake hash just returns the paragraph again rather than
 * re-claiming a slot or re-charging — `UNIQUE(group_duel_id, user_id)`
 * guarantees one participant can never hold two slots.
 */
export async function joinGroupDuel(
  db: Db,
  wallet: HouseWallet,
  input: { code: string, nimAddress: string, stakeTxHash: string },
): Promise<JoinGroupDuelResult> {
  const groupDuel = await findGroupDuelByCode(db, input.code)
  if (!groupDuel) return { ok: false, reason: 'unknown group duel code' }

  const userId = await getOrCreateUser(db, input.nimAddress)

  const existing = await findGroupEntry(db, groupDuel.id, userId)
  if (existing) {
    const paragraph = (await db.execute({ sql: 'SELECT id, body FROM paragraphs WHERE id = ?', args: [groupDuel.paragraph_id] }))
      .rows[0] as unknown as { id: string, body: string }
    return { ok: true, groupDuelId: groupDuel.id, paragraphId: paragraph.id, paragraphBody: paragraph.body }
  }

  if (groupDuel.status !== 'OPEN' || new Date(groupDuel.expires_at).getTime() <= Date.now()) {
    return { ok: false, reason: 'this group duel is no longer open' }
  }

  const claimed = await db.execute({
    sql: "UPDATE group_duels SET joined_count = joined_count + 1 WHERE id = ? AND status = 'OPEN' AND joined_count < max_participants",
    args: [groupDuel.id],
  })
  if (claimed.rowsAffected === 0) {
    return { ok: false, reason: 'this group duel is full' }
  }

  const stake = await confirmStake(db, wallet, userId, {
    nimAddress: input.nimAddress,
    stakeTxHash: input.stakeTxHash,
    valueLuna: groupDuel.stake_luna,
  })
  if (!stake.ok) {
    await db.execute({ sql: 'UPDATE group_duels SET joined_count = joined_count - 1 WHERE id = ?', args: [groupDuel.id] })
    return stake
  }

  try {
    await db.execute({
      sql: 'INSERT INTO group_entries (id, group_duel_id, user_id, stake_tx_hash, joined_at, keystroke_run_id, rank, payout_luna) VALUES (?, ?, ?, ?, ?, NULL, NULL, NULL)',
      args: [randomUUID(), groupDuel.id, userId, input.stakeTxHash, new Date().toISOString()],
    })
  }
  catch (error) {
    if (!isUniqueConstraintError(error)) throw error
    // Lost a race to our own retry (or a reused stake hash) — the slot
    // claim above already stuck, which would double-count it against
    // max_participants, so give it back; the row that won is this
    // participant's actual join.
    await db.execute({ sql: 'UPDATE group_duels SET joined_count = joined_count - 1 WHERE id = ?', args: [groupDuel.id] })
  }

  const paragraph = (await db.execute({ sql: 'SELECT id, body FROM paragraphs WHERE id = ?', args: [groupDuel.paragraph_id] }))
    .rows[0] as unknown as { id: string, body: string }
  return { ok: true, groupDuelId: groupDuel.id, paragraphId: paragraph.id, paragraphBody: paragraph.body }
}

export type SubmitGroupRunResult =
  | { ok: true, submitted: true }
  | { ok: false, reason: string }

/**
 * Records this participant's run — the server-computed duration is never
 * sent back, to them or anyone, until the whole group resolves. If this
 * submission completes the roster (every joined slot has now submitted),
 * the group resolves immediately rather than waiting out the rest of the
 * 72h window; otherwise it's left for the expiry sweep.
 */
export async function submitGroupRun(
  db: Db,
  wallet: HouseWallet,
  input: { groupDuelId: string, nimAddress: string, events: KeystrokeEvent[] },
): Promise<SubmitGroupRunResult> {
  const groupDuel = (await db.execute({ sql: 'SELECT * FROM group_duels WHERE id = ?', args: [input.groupDuelId] }))
    .rows[0] as unknown as GroupDuelRow | undefined
  if (!groupDuel) return { ok: false, reason: 'unknown group duel' }
  if (groupDuel.status !== 'OPEN') return { ok: false, reason: 'this group duel has already been resolved' }

  const userId = await getOrCreateUser(db, input.nimAddress)
  const entry = await findGroupEntry(db, groupDuel.id, userId)
  if (!entry) return { ok: false, reason: 'you have not joined this group duel' }
  if (entry.keystroke_run_id) return { ok: true, submitted: true }

  const runResult = await submitRun(db, { nimAddress: input.nimAddress, paragraphId: groupDuel.paragraph_id, events: input.events })
  if (!runResult.ok) return { ok: false, reason: runResult.reason }

  await db.execute({ sql: 'UPDATE group_entries SET keystroke_run_id = ? WHERE id = ?', args: [runResult.runId, entry.id] })

  const counts = (await db.execute({
    sql: 'SELECT COUNT(*) as submitted FROM group_entries WHERE group_duel_id = ? AND keystroke_run_id IS NOT NULL',
    args: [groupDuel.id],
  })).rows[0] as unknown as { submitted: number }
  if (groupDuel.joined_count === groupDuel.max_participants && counts.submitted === groupDuel.joined_count) {
    await resolveGroupDuel(db, wallet, groupDuel.id)
  }

  return { ok: true, submitted: true }
}

export interface GroupDuelResultRow {
  address: string
  rank: number | null
  durationMs: number | null
  payoutLuna: number
  forfeited: boolean
}

export type GroupDuelStatusResult =
  | { ok: true, resolved: false, joinedCount: number, maxParticipants: number, expiresAt: string, youSubmitted: boolean }
  | { ok: true, resolved: true, settledAt: string, results: GroupDuelResultRow[] }
  | { ok: false, reason: string }

/**
 * The group's own view of itself — nothing about any individual time
 * leaks out before `resolved`, same as a creator sees "waiting for a
 * challenger" rather than their own duration. Once resolved, every
 * participant's address, rank, duration, and payout are shown to everyone
 * — this is the public reveal the whole group was waiting on.
 */
export async function getGroupDuelStatus(
  db: Db,
  input: { groupDuelId: string, nimAddress?: string },
): Promise<GroupDuelStatusResult> {
  const groupDuel = (await db.execute({ sql: 'SELECT * FROM group_duels WHERE id = ?', args: [input.groupDuelId] }))
    .rows[0] as unknown as GroupDuelRow | undefined
  if (!groupDuel) return { ok: false, reason: 'unknown group duel' }

  if (groupDuel.status === 'OPEN') {
    let youSubmitted = false
    if (input.nimAddress) {
      const userId = await getOrCreateUser(db, input.nimAddress)
      const entry = await findGroupEntry(db, groupDuel.id, userId)
      youSubmitted = entry?.keystroke_run_id != null
    }
    return {
      ok: true,
      resolved: false,
      joinedCount: groupDuel.joined_count,
      maxParticipants: groupDuel.max_participants,
      expiresAt: groupDuel.expires_at,
      youSubmitted,
    }
  }

  const rows = (await db.execute({
    sql: `SELECT u.nim_address as address, ge.rank, ge.payout_luna, kr.duration_ms
       FROM group_entries ge
       JOIN users u ON u.id = ge.user_id
       LEFT JOIN keystroke_runs kr ON kr.id = ge.keystroke_run_id
       WHERE ge.group_duel_id = ?
       ORDER BY ge.rank IS NULL, ge.rank ASC`,
    args: [groupDuel.id],
  })).rows as unknown as { address: string, rank: number | null, payout_luna: number | null, duration_ms: number | null }[]

  return {
    ok: true,
    resolved: true,
    settledAt: groupDuel.settled_at ?? groupDuel.expires_at,
    results: rows.map((row) => ({
      address: row.address,
      rank: row.rank,
      durationMs: row.duration_ms,
      payoutLuna: row.payout_luna ?? 0,
      forfeited: row.duration_ms === null,
    })),
  }
}

/**
 * Resolves a group duel once — reachable both from `submitGroupRun`'s
 * "that was the last submission" check and from the expiry sweep, so the
 * bookkeeping update at the end is a conditional `UPDATE ... WHERE
 * settled_at IS NULL`, the exact same race guard `finalizeSettlement`
 * uses for 1v1 duels. Both triggers computing the same outcome and
 * calling `payout`/`refund` with the same idempotency keys is what makes
 * that safe even if both actually run: escrow only ever sends once per
 * key, and only the first bookkeeping update actually sticks.
 *
 * Zero finishers (everyone who joined forfeited, or nobody joined at
 * all) has no ranking to pay out, so every joined stake is refunded in
 * full instead — the group's version of an entry nobody ever challenged.
 * One or more finishers always resolves as a decisive split via
 * `splitGroupPot`, even with a single finisher (they just take the
 * entire raked pot) — no separate "too few to rank" branch needed.
 */
export async function resolveGroupDuel(db: Db, wallet: HouseWallet, groupDuelId: string, now: Date = new Date()): Promise<void> {
  const groupDuel = (await db.execute({ sql: 'SELECT * FROM group_duels WHERE id = ?', args: [groupDuelId] }))
    .rows[0] as unknown as GroupDuelRow | undefined
  if (!groupDuel || groupDuel.settled_at) return

  const joined = (await db.execute({ sql: 'SELECT * FROM group_entries WHERE group_duel_id = ?', args: [groupDuelId] }))
    .rows as unknown as GroupEntryRow[]

  const finishedRows = (await db.execute({
    sql: `SELECT ge.id, ge.user_id, kr.duration_ms
       FROM group_entries ge
       JOIN keystroke_runs kr ON kr.id = ge.keystroke_run_id
       WHERE ge.group_duel_id = ? AND ge.keystroke_run_id IS NOT NULL
       ORDER BY kr.duration_ms ASC`,
    args: [groupDuelId],
  })).rows as unknown as { id: string, user_id: string, duration_ms: number }[]

  const potLuna = joined.length * groupDuel.stake_luna
  const targetStatus: GroupDuelStatus = finishedRows.length === 0 ? 'EXPIRED' : 'SETTLED'

  const payoutByEntryId = new Map<string, { rank: number, amountLuna: number }>()
  if (finishedRows.length === 0) {
    for (const entry of joined) {
      await sendGroupMoney(db, wallet, { type: 'refund', groupDuelId, entryId: entry.id, userId: entry.user_id, amountLuna: groupDuel.stake_luna })
    }
  }
  else {
    const obligations = splitGroupPot(potLuna, finishedRows.map((r) => r.user_id))
    for (let i = 0; i < finishedRows.length; i++) {
      const obligation = obligations[i]
      payoutByEntryId.set(finishedRows[i].id, { rank: obligation.rank, amountLuna: obligation.amountLuna })
      if (obligation.amountLuna > 0) {
        await sendGroupMoney(db, wallet, {
          type: 'payout',
          groupDuelId,
          entryId: finishedRows[i].id,
          userId: obligation.userId,
          amountLuna: obligation.amountLuna,
        })
      }
    }
  }

  for (const [entryId, { rank, amountLuna }] of payoutByEntryId) {
    await db.execute({ sql: 'UPDATE group_entries SET rank = ?, payout_luna = ? WHERE id = ?', args: [rank, amountLuna, entryId] })
  }

  await db.execute({
    sql: "UPDATE group_duels SET status = ?, settled_at = ? WHERE id = ? AND settled_at IS NULL",
    args: [targetStatus, now.toISOString(), groupDuelId],
  })
}

async function sendGroupMoney(
  db: Db,
  wallet: HouseWallet,
  input: { type: 'payout' | 'refund', groupDuelId: string, entryId: string, userId: string, amountLuna: number },
): Promise<void> {
  const recipientAddress = await getUserAddress(db, input.userId)
  const send = input.type === 'payout' ? payout : refund
  await send(db, wallet, {
    idempotencyKey: `group-${input.type}-${input.groupDuelId}-${input.entryId}`,
    userId: input.userId,
    recipientAddress,
    valueLuna: input.amountLuna,
  })
}
