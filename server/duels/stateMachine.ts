/**
 * Pure duel lifecycle — no I/O, no wallet, no database. This module only
 * decides what state a duel is in given a sequence of events; Phase 11/12
 * wire it to real entries/duels rows and real escrow calls. Keeping it
 * pure is what makes it possible to heavily property-test: every invariant
 * here is checked directly against `applyDuelEvent`, with nothing to mock.
 *
 * Transitions (see typing-duel-build-plan.md, Phase 10):
 *   create entry   -> OPEN      (A staked, run recorded, time hidden)
 *   challenge      -> LOCKED    (B reserved it, TTL starts)
 *   TTL expiry     -> OPEN      (B never finished; B forfeits)
 *   B submits      -> SETTLED   (compare times, winner decided)
 *   24h no taker   -> EXPIRED   (A refunded)
 */

export type DuelStatus = 'OPEN' | 'LOCKED' | 'SETTLED' | 'EXPIRED'

interface DuelCommon {
  entryId: string
  creatorUserId: string
  stakeLuna: number
  /** When the OPEN entry itself expires if nobody ever challenges it. */
  entryExpiresAt: number
}

export interface OpenDuel extends DuelCommon {
  status: 'OPEN'
}

export interface LockedDuel extends DuelCommon {
  status: 'LOCKED'
  challengerUserId: string
  /** When this challenger's lock expires if they never submit a run. */
  lockTtlExpiresAt: number
}

export interface SettledDuel extends DuelCommon {
  status: 'SETTLED'
  challengerUserId: string
  /** null means a tie — both players are refunded in full. */
  winnerUserId: string | null
  /**
   * What the challenger ultimately staked in total. Equal to `stakeLuna`
   * unless a double-trial retry added a further stake on top — the
   * challenger's own amount can differ from the creator's, unlike every
   * other status where both sides are assumed symmetric.
   */
  challengerStakeLuna: number
}

export interface ExpiredDuel extends DuelCommon {
  status: 'EXPIRED'
}

export type Duel = OpenDuel | LockedDuel | SettledDuel | ExpiredDuel

/** ~2 hours: the challenger's whole browsing-to-typing round trip should easily fit inside this. Tune later. */
export const DEFAULT_LOCK_TTL_MS = 2 * 60 * 60_000

/** 24h, per the build plan. */
export const DEFAULT_ENTRY_TTL_MS = 24 * 60 * 60_000

export function createOpenDuel(input: {
  entryId: string
  creatorUserId: string
  stakeLuna: number
  entryExpiresAt: number
}): OpenDuel {
  return { ...input, status: 'OPEN' }
}

export type DuelEvent =
  | { type: 'CHALLENGE', challengerUserId: string, now: number, lockTtlMs: number }
  | { type: 'LOCK_TTL_EXPIRED', now: number }
  | { type: 'SUBMIT', winnerUserId: string | null, challengerStakeLuna: number, now: number }
  | { type: 'ENTRY_EXPIRED', now: number }

function commonFields(duel: Duel): DuelCommon {
  return {
    entryId: duel.entryId,
    creatorUserId: duel.creatorUserId,
    stakeLuna: duel.stakeLuna,
    entryExpiresAt: duel.entryExpiresAt,
  }
}

/**
 * Pure reducer for one duel's lifecycle. An event that doesn't apply to the
 * duel's current state — wrong status, or a TTL/expiry firing before its
 * own deadline — is a no-op: it returns the exact same duel, unchanged.
 * This is deliberate. Real event delivery is never perfectly ordered or
 * deduplicated (a cron sweep can run twice, a stale timer can fire late,
 * two challenge requests can race), so the reducer has to be safe against
 * redundant or out-of-order events on its own — that's the whole reason
 * challenging locks the entry: the second challenger's `CHALLENGE` event
 * arrives against an already-`LOCKED` duel and is simply ignored.
 */
export function applyDuelEvent(duel: Duel, event: DuelEvent): Duel {
  switch (event.type) {
    case 'CHALLENGE': {
      if (duel.status !== 'OPEN') return duel
      if (event.now >= duel.entryExpiresAt) return duel
      return {
        ...commonFields(duel),
        status: 'LOCKED',
        challengerUserId: event.challengerUserId,
        lockTtlExpiresAt: event.now + event.lockTtlMs,
      }
    }
    case 'LOCK_TTL_EXPIRED': {
      if (duel.status !== 'LOCKED') return duel
      if (event.now < duel.lockTtlExpiresAt) return duel
      return { ...commonFields(duel), status: 'OPEN' }
    }
    case 'SUBMIT': {
      if (duel.status !== 'LOCKED') return duel
      return {
        ...commonFields(duel),
        status: 'SETTLED',
        challengerUserId: duel.challengerUserId,
        winnerUserId: event.winnerUserId,
        challengerStakeLuna: event.challengerStakeLuna,
      }
    }
    case 'ENTRY_EXPIRED': {
      if (duel.status !== 'OPEN') return duel
      if (event.now < duel.entryExpiresAt) return duel
      return { ...commonFields(duel), status: 'EXPIRED' }
    }
  }
}

export interface PayoutObligation {
  userId: string
  amountLuna: number
}

/**
 * What escrow owes once a duel reaches a terminal state — empty for OPEN
 * or LOCKED, since nothing is owed until the duel actually resolves. The
 * full pot (both players' stakes, whatever they actually came to) is
 * always accounted for exactly once a duel terminates. This does not
 * model the house rake — Phase 13 applies that on top when it wires this
 * to real payouts; here, a decisive win pays the winner the whole pot as
 * the upper bound the rake gets subtracted from.
 *
 * A tie refunds each side exactly what *they* put in — `stakeLuna` to the
 * creator, `challengerStakeLuna` to the challenger — rather than assuming
 * both staked the same amount, since a double-trial retry can leave the
 * challenger having staked more than the creator ever did.
 */
export function settlementObligations(duel: Duel): PayoutObligation[] {
  if (duel.status === 'EXPIRED') {
    return [{ userId: duel.creatorUserId, amountLuna: duel.stakeLuna }]
  }
  if (duel.status === 'SETTLED') {
    if (duel.winnerUserId === null) {
      return [
        { userId: duel.creatorUserId, amountLuna: duel.stakeLuna },
        { userId: duel.challengerUserId, amountLuna: duel.challengerStakeLuna },
      ]
    }
    return [{ userId: duel.winnerUserId, amountLuna: duel.stakeLuna + duel.challengerStakeLuna }]
  }
  return []
}
