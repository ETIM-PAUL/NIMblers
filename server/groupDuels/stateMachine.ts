/**
 * Pure group-duel payout math — no I/O, no wallet, no database. Mirrors
 * server/duels/stateMachine.ts's `settlementObligations`: given who
 * actually finished and what the pot came to, decide who gets paid what.
 * The lifecycle itself (OPEN -> SETTLED/EXPIRED) has no interesting
 * transitions worth modeling as a reducer the way 1v1 duels do — there's
 * no lock to race for, just a join-count claim and a single resolution
 * step — so this module only has to get the split right.
 */

/** 72h: covers both "not everyone ever joined" and "joined but never typed" with one deadline. */
export const GROUP_DUEL_WINDOW_MS = 72 * 60 * 60_000

/** Mirrors duels/service.ts's HOUSE_RAKE — kept as its own constant here rather than imported, since that module is I/O-bearing and this one stays pure. */
export const GROUP_HOUSE_RAKE = 0.1

/**
 * Top half of the field, rounded up: for 10 finishers that's 5 paid
 * places, for 5 it's 3, for 1 it's 1. A rule of thumb rather than a
 * lookup table, so it needs no per-size tuning as groups grow or shrink.
 */
export function paidPlaces(finisherCount: number): number {
  return Math.ceil(finisherCount / 2)
}

/** Triangular weights over the paid places — 1st place gets `paidPlacesCount` shares, the last paid place gets 1. */
function triangularShares(paidPlacesCount: number): number[] {
  return Array.from({ length: paidPlacesCount }, (_, i) => paidPlacesCount - i)
}

export interface GroupPayoutObligation {
  userId: string
  /** 1-indexed finish position. */
  rank: number
  amountLuna: number
}

/**
 * Splits a pot among ranked finishers (fastest first) — top `paidPlaces`
 * places only, weighted by `triangularShares`. The pot already includes
 * every joined participant's stake, finishers and forfeiters alike:
 * forfeiting just means not appearing in `rankedFinisherUserIds`, which
 * removes you from the ranking without reducing the pot you contributed
 * to. Amounts are floored per place and any leftover Luna from rounding
 * goes to 1st place, so the returned amounts always sum to exactly the
 * raked pot — never more, never a few Luna stranded.
 *
 * Callers must not call this with zero finishers (division by zero) —
 * that case has no ranking to speak of and should fall back to a full
 * refund of each joined stake instead (see server/groupDuels/service.ts).
 */
export function splitGroupPot(potLuna: number, rankedFinisherUserIds: string[]): GroupPayoutObligation[] {
  if (rankedFinisherUserIds.length === 0) {
    throw new Error('splitGroupPot requires at least one finisher')
  }

  const paid = paidPlaces(rankedFinisherUserIds.length)
  const shares = triangularShares(paid)
  const totalShares = shares.reduce((a, b) => a + b, 0)
  const raked = Math.round(potLuna * (1 - GROUP_HOUSE_RAKE))

  const amounts = shares.map((share) => Math.floor((raked * share) / totalShares))
  const distributed = amounts.reduce((a, b) => a + b, 0)
  amounts[0] += raked - distributed

  return rankedFinisherUserIds.map((userId, i) => ({
    userId,
    rank: i + 1,
    amountLuna: i < paid ? amounts[i] : 0,
  }))
}
