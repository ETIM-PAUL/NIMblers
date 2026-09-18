import type { DuelHistoryEntry } from './service.ts'

export type BadgeId = 'flawless' | 'speed-demon' | 'win-streak-5'

export interface EarnedBadge {
  id: BadgeId
  label: string
  description: string
}

const BADGE_INFO: Record<BadgeId, Omit<EarnedBadge, 'id'>> = {
  flawless: { label: 'Flawless', description: 'Won a duel without a single correction.' },
  'speed-demon': { label: 'Speed demon', description: 'Won a duel in under 30 seconds.' },
  'win-streak-5': { label: 'On a streak', description: 'Won 5 duels in a row.' },
}

const SPEED_DEMON_THRESHOLD_MS = 30_000
const WIN_STREAK_TARGET = 5

/**
 * Computed on demand from already-settled duel history — nothing new is
 * stored, nothing here can go stale. `history` is expected newest-first,
 * the same order `listMyDuelHistory` returns; the streak check walks it
 * in chronological order instead, since a streak is a run through time.
 */
export function computeBadges(history: DuelHistoryEntry[]): EarnedBadge[] {
  const earned = new Set<BadgeId>()

  for (const entry of history) {
    if (entry.outcome !== 'won') continue
    if (entry.flawless) earned.add('flawless')
    if (entry.myDurationMs < SPEED_DEMON_THRESHOLD_MS) earned.add('speed-demon')
  }

  let streak = 0
  for (let i = history.length - 1; i >= 0; i--) {
    streak = history[i].outcome === 'won' ? streak + 1 : 0
    if (streak >= WIN_STREAK_TARGET) {
      earned.add('win-streak-5')
      break
    }
  }

  return [...earned].map((id) => ({ id, ...BADGE_INFO[id] }))
}
