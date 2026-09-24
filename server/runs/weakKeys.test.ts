import assert from 'node:assert/strict'
import { test } from 'node:test'
import { computeWeakKeys } from './weakKeys.ts'
import type { WeakKeySample } from './weakKeys.ts'

/** Types `target` correctly, char by char, with no mistakes. */
function cleanRun(target: string): WeakKeySample {
  return {
    targetBody: target,
    events: target.split('').map((key, i) => ({ key, tRelativeMs: i * 100, resultingLength: i + 1 })),
  }
}

/**
 * Types `target`, but at each index in `mistakeIndexes`, first types a wrong
 * character, backspaces it, then types the correct one — the exact
 * "typed it wrong, corrected it" pattern the heatmap is meant to catch.
 */
function runWithMistakesAt(target: string, mistakeIndexes: number[]): WeakKeySample {
  const events: WeakKeySample['events'] = []
  let typed = ''
  let t = 0
  for (let i = 0; i < target.length; i++) {
    if (mistakeIndexes.includes(i)) {
      const wrongChar = target[i] === 'x' ? 'y' : 'x' // anything that isn't the real target char
      typed += wrongChar
      events.push({ key: wrongChar, tRelativeMs: t++, resultingLength: typed.length })
      typed = typed.slice(0, -1)
      events.push({ key: 'Backspace', tRelativeMs: t++, resultingLength: typed.length })
    }
    typed += target[i]
    events.push({ key: target[i], tRelativeMs: t++, resultingLength: typed.length })
  }
  return { targetBody: target, events }
}

test('computeWeakKeys reports nothing for a run with no mistakes', () => {
  assert.deepEqual(computeWeakKeys([cleanRun('aaaaa bbbbb ccccc')]), [])
})

test('computeWeakKeys credits a backspaced-and-corrected character to the target letter, not the wrong one typed', () => {
  // 'q' appears 5 times (>= MIN_OCCURRENCES) and is mistyped once.
  const target = 'q q q q q'
  const stats = computeWeakKeys([runWithMistakesAt(target, [0])])
  assert.equal(stats.length, 1)
  assert.equal(stats[0].key, 'q')
  assert.equal(stats[0].mistakes, 1)
})

test('computeWeakKeys excludes a character that hasn\'t occurred often enough to mean anything', () => {
  // 'z' appears only twice — below MIN_OCCURRENCES even though it was
  // mistyped every single time.
  const stats = computeWeakKeys([runWithMistakesAt('z z aaaaa', [0, 2])])
  assert.deepEqual(stats.filter((s) => s.key === 'z'), [])
})

test('computeWeakKeys ranks by mistake rate, not raw mistake count', () => {
  // 'e' occurs 20 times, mistyped twice (10% rate).
  // 'q' occurs 5 times, mistyped twice (40% rate) — fewer slips overall,
  // but a much worse rate, and should rank first because of it.
  const eRun = runWithMistakesAt('e'.repeat(20), [0, 1])
  const qRun = runWithMistakesAt('q'.repeat(5), [0, 1])
  const stats = computeWeakKeys([eRun, qRun])

  assert.equal(stats[0].key, 'q')
  assert.equal(stats[0].mistakes, 2)
  assert.equal(stats[0].occurrences, 5)
  assert.equal(stats[0].mistakeRate, 0.4)

  assert.equal(stats[1].key, 'e')
  assert.equal(stats[1].mistakeRate, 0.1)
})

test('computeWeakKeys aggregates the same character across multiple separate runs', () => {
  const run1 = runWithMistakesAt('q q q', [0])
  const run2 = runWithMistakesAt('q q', [0])
  const stats = computeWeakKeys([run1, run2])

  const q = stats.find((s) => s.key === 'q')
  assert.ok(q)
  assert.equal(q.occurrences, 5) // 3 + 2
  assert.equal(q.mistakes, 2) // one per run
})

test('computeWeakKeys tolerates a Backspace with nothing typed yet, same as the client\'s own applyKeydown', () => {
  const stray: WeakKeySample = {
    targetBody: 'aaaaa',
    events: [{ key: 'Backspace', tRelativeMs: 0, resultingLength: 0 }, ...cleanRun('aaaaa').events],
  }
  assert.doesNotThrow(() => computeWeakKeys([stray]))
  assert.deepEqual(computeWeakKeys([stray]), [])
})
