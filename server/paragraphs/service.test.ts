import assert from 'node:assert/strict'
import { test } from 'node:test'
import { getDailyParagraph, getPracticeParagraph } from './service.ts'
import { PARAGRAPH_POOL } from './pool-data.ts'

const DAY_MS = 24 * 60 * 60 * 1000
const SIMULATED_START = new Date('2026-01-01T00:00:00.000Z')

function simulatedDays(count: number): Date[] {
  return Array.from({ length: count }, (_, i) => new Date(SIMULATED_START.getTime() + i * DAY_MS))
}

test('practice pool and the daily paragraph are disjoint for 365 consecutive days', () => {
  for (const date of simulatedDays(365)) {
    const daily = getDailyParagraph(PARAGRAPH_POOL, date)

    // Exhaustively sample practice picks for the day (deterministic rng
    // sweeping the whole candidate range) instead of relying on Math.random,
    // so the assertion covers every possible practice draw, not just one.
    const candidateCount = PARAGRAPH_POOL.length - 1
    for (let i = 0; i < candidateCount; i++) {
      const rng = () => i / candidateCount
      const practice = getPracticeParagraph(PARAGRAPH_POOL, date, rng)
      assert.notEqual(
        practice.id,
        daily.id,
        `practice paragraph matched the daily paragraph on ${date.toISOString().slice(0, 10)}`,
      )
    }
  }
})

test('getDailyParagraph is deterministic for a given pool and date', () => {
  const date = new Date('2026-06-15T09:30:00.000Z')
  const first = getDailyParagraph(PARAGRAPH_POOL, date)
  const second = getDailyParagraph(PARAGRAPH_POOL, date)
  assert.equal(first.id, second.id)
})

test('getDailyParagraph only depends on the calendar date, not the time of day', () => {
  const morning = getDailyParagraph(PARAGRAPH_POOL, new Date('2026-06-15T00:00:01.000Z'))
  const night = getDailyParagraph(PARAGRAPH_POOL, new Date('2026-06-15T23:59:59.000Z'))
  assert.equal(morning.id, night.id)
})

test('getPracticeParagraph throws with a single-paragraph pool', () => {
  const singleton = [PARAGRAPH_POOL[0]]
  assert.throws(() => getPracticeParagraph(singleton, new Date('2026-01-01T00:00:00.000Z')))
})
