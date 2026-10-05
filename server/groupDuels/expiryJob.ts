import type { Db } from '../db/client.ts'
import type { HouseWallet } from '../../services/escrow.ts'
import { resolveGroupDuel } from './service.ts'

export interface GroupDuelExpirySweepResult {
  /** Group duel ids resolved by this sweep because their 72h window passed. */
  resolved: string[]
  errors: { groupDuelId: string, reason: string }[]
}

/**
 * Resolves any group duel still OPEN past its 72h window — the
 * roster-complete path in `submitGroupRun` already resolves most groups
 * before this ever needs to run; this just catches whatever's left,
 * whether that's slots nobody filled or filled slots nobody finished.
 * `resolveGroupDuel` is itself idempotent (a conditional `UPDATE ...
 * WHERE settled_at IS NULL`), so running this sweep twice, or racing it
 * against a last-submission resolving the same group, is safe — only one
 * of them actually records the outcome.
 */
export async function runGroupDuelExpirySweep(db: Db, wallet: HouseWallet, now: Date = new Date()): Promise<GroupDuelExpirySweepResult> {
  const nowIso = now.toISOString()
  const result: GroupDuelExpirySweepResult = { resolved: [], errors: [] }

  const expired = (await db.execute({
    sql: "SELECT id FROM group_duels WHERE status = 'OPEN' AND expires_at <= ?",
    args: [nowIso],
  })).rows as unknown as { id: string }[]

  for (const row of expired) {
    try {
      await resolveGroupDuel(db, wallet, row.id, now)
      result.resolved.push(row.id)
    }
    catch (error) {
      result.errors.push({ groupDuelId: row.id, reason: error instanceof Error ? error.message : String(error) })
    }
  }

  return result
}
