import type { DatabaseSync } from 'node:sqlite'

export interface LeaderboardEntry {
  rank: number
  nimAddress: string
  totalWonLuna: number
  wins: number
}

/** Starting point — "tune later" applies here too. */
export const DEFAULT_LEADERBOARD_LIMIT = 20

interface LeaderboardRow {
  nim_address: string
  total_won_luna: number
  wins: number
}

/**
 * Monday 00:00:00 UTC of the week containing `date` — the leaderboard
 * resets at this instant every week (equivalently: the instant right
 * after Sunday 23:59:59 UTC). UTC, not the caller's local time, for the
 * same reason the old daily-paragraph pool used UTC dates: every player
 * worldwide needs to see the same reset moment, not one that drifts with
 * whichever timezone happens to be asking.
 */
export function startOfWeekUtc(date: Date): Date {
  const daysSinceMonday = (date.getUTCDay() + 6) % 7 // Sunday (0) -> 6, Monday (1) -> 0, ...
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() - daysSinceMonday))
}

/**
 * Ranks players by NIM won *this week only* — the sum of their completed
 * `PAYOUT` rows since the last Monday-00:00-UTC reset, which already
 * reflects the house rake taken off the top (see
 * `server/duels/service.ts`'s `settleDuel`). A payout that's been claimed
 * but not yet fulfilled (`tx_hash` still null — see `services/escrow.ts`'s
 * idempotency claim) doesn't count yet; a settlement that's still in
 * flight hasn't actually won anything until it lands.
 *
 * "Resets" here means the ranking query's time window moves forward, not
 * that any row is ever deleted — the `payouts` table stays the permanent,
 * append-only record of every NIM movement (see CLAUDE.md); last week's
 * winnings simply stop counting toward this week's board.
 *
 * Stakes and refunds never appear here — this tracks winnings, not
 * activity or losses.
 */
export function getLeaderboard(db: DatabaseSync, limit: number = DEFAULT_LEADERBOARD_LIMIT, now: Date = new Date()): LeaderboardEntry[] {
  const rows = db
    .prepare(
      `SELECT u.nim_address as nim_address, SUM(p.amount_luna) as total_won_luna, COUNT(*) as wins
       FROM payouts p
       JOIN users u ON u.id = p.user_id
       WHERE p.type = 'PAYOUT' AND p.tx_hash IS NOT NULL AND p.created_at >= ?
       GROUP BY p.user_id
       ORDER BY total_won_luna DESC, wins DESC
       LIMIT ?`,
    )
    .all(startOfWeekUtc(now).toISOString(), limit) as unknown as LeaderboardRow[]

  return rows.map((row, index) => ({
    rank: index + 1,
    nimAddress: row.nim_address,
    totalWonLuna: row.total_won_luna,
    wins: row.wins,
  }))
}
