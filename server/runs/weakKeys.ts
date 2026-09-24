import type { KeystrokeEvent } from '../../shared/timingEngine.ts'

export interface WeakKeyStat {
  key: string
  mistakes: number
  /** How many times this character actually appeared across the player's typed paragraphs — the denominator a raw mistake count needs to mean anything ("wrong 8 times" is alarming for a rare letter, unremarkable for 'e'). */
  occurrences: number
  /** mistakes / occurrences. */
  mistakeRate: number
}

/** A character needs to have come up at least this often before its rate is reported at all — one unlucky slip on a letter that showed up twice isn't a "weak key," it's noise. */
const MIN_OCCURRENCES = 5

/** Only the run's own settled paragraph and its raw keystroke stream — everything `computeWeakKeys` needs, and nothing it has to trust beyond what's already been validated once by `validateRun`. */
export interface WeakKeySample {
  events: KeystrokeEvent[]
  targetBody: string
}

/**
 * Finds which characters a player most often gets wrong on the first try —
 * "wrong" meaning they typed it, then immediately backspaced over it, same
 * signal `shared/typingEngine.ts`'s own state coloring uses. Replays each
 * run's raw events the same way `server/runs/validateRun.ts` already does
 * (there's no second "how typing works" here), and just watches what
 * character was standing at the position a Backspace removes: if it didn't
 * match the target, that target character earns a mistake.
 *
 * Ranked by mistake *rate*, not raw count — a common letter racking up more
 * total slips than a rare one says nothing about which is actually harder
 * for this player; dividing by how often the letter came up at all is what
 * makes the ranking mean something.
 */
export function computeWeakKeys(runs: WeakKeySample[]): WeakKeyStat[] {
  const mistakes = new Map<string, number>()
  const occurrences = new Map<string, number>()

  for (const run of runs) {
    for (const char of run.targetBody) {
      occurrences.set(char, (occurrences.get(char) ?? 0) + 1)
    }

    let typed = ''
    for (const event of run.events) {
      if (event.key === 'Backspace') {
        if (typed.length > 0) {
          const removedIndex = typed.length - 1
          const targetChar = run.targetBody[removedIndex]
          if (targetChar !== undefined && typed[removedIndex] !== targetChar) {
            mistakes.set(targetChar, (mistakes.get(targetChar) ?? 0) + 1)
          }
        }
        typed = typed.slice(0, -1)
      }
      else if (typed.length < run.targetBody.length) {
        typed += event.key
      }
    }
  }

  return [...occurrences.entries()]
    .filter(([, count]) => count >= MIN_OCCURRENCES)
    .map(([key, occurrenceCount]) => {
      const mistakeCount = mistakes.get(key) ?? 0
      return { key, mistakes: mistakeCount, occurrences: occurrenceCount, mistakeRate: mistakeCount / occurrenceCount }
    })
    .filter((stat) => stat.mistakes > 0)
    .sort((a, b) => b.mistakeRate - a.mistakeRate || b.mistakes - a.mistakes)
}
