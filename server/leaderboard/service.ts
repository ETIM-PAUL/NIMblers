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
 * Ranks players by total NIM actually won — the sum of their completed
 * `PAYOUT` rows, which already reflects the house rake taken off the top
 * (see `server/duels/service.ts`'s `settleDuel`). A payout that's been
 * claimed but not yet fulfilled (`tx_hash` still null — see
 * `services/escrow.ts`'s idempotency claim) doesn't count yet; a settlement
 * that's still in flight hasn't actually won anything until it lands.
 *
 * Stakes and refunds never appear here — this tracks winnings, not
 * activity or losses.
 */
export function getLeaderboard(db: DatabaseSync, limit: number = DEFAULT_LEADERBOARD_LIMIT): LeaderboardEntry[] {
  const rows = db
    .prepare(
      `SELECT u.nim_address as nim_address, SUM(p.amount_luna) as total_won_luna, COUNT(*) as wins
       FROM payouts p
       JOIN users u ON u.id = p.user_id
       WHERE p.type = 'PAYOUT' AND p.tx_hash IS NOT NULL
       GROUP BY p.user_id
       ORDER BY total_won_luna DESC, wins DESC
       LIMIT ?`,
    )
    .all(limit) as unknown as LeaderboardRow[]

  return rows.map((row, index) => ({
    rank: index + 1,
    nimAddress: row.nim_address,
    totalWonLuna: row.total_won_luna,
    wins: row.wins,
  }))
}
