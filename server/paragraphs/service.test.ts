import assert from 'node:assert/strict'
import { test } from 'node:test'
import { getAllDailyParagraphs, getDailyParagraph, getPracticeParagraph } from './service.ts'
import { PARAGRAPH_POOL } from './pool-data.ts'

const DAY_MS = 24 * 60 * 60 * 1000
const SIMULATED_START = new Date('2026-01-01T00:00:00.000Z')
const DIFFICULTIES = ['easy', 'medium', 'hard'] as const

function simulatedDays(count: number): Date[] {
  return Array.from({ length: count }, (_, i) => new Date(SIMULATED_START.getTime() + i * DAY_MS))
}

test('practice pool and the daily paragraph are disjoint for 365 consecutive days, per difficulty', () => {
  for (const date of simulatedDays(365)) {
    for (const difficulty of DIFFICULTIES) {
      const daily = getDailyParagraph(PARAGRAPH_POOL, date, difficulty)

      // Exhaustively sample practice picks for the day (deterministic rng
      // sweeping the whole candidate range) instead of relying on Math.random,
      // so the assertion covers every possible practice draw, not just one.
      const candidateCount = PARAGRAPH_POOL.filter((p) => p.difficulty === difficulty).length - 1
      for (let i = 0; i < candidateCount; i++) {
        const rng = () => i / candidateCount
        const practice = getPracticeParagraph(PARAGRAPH_POOL, date, rng, difficulty)
        assert.notEqual(
          practice.id,
          daily.id,
          `practice paragraph matched the ${difficulty} daily paragraph on ${date.toISOString().slice(0, 10)}`,
        )
      }
    }
  }
})

test('an unfiltered practice pick excludes all three tiers\' daily paragraphs', () => {
  for (const date of simulatedDays(30)) {
    const dailyIds = new Set(DIFFICULTIES.map((d) => getDailyParagraph(PARAGRAPH_POOL, date, d).id))
    for (let i = 0; i < 20; i++) {
      const practice = getPracticeParagraph(PARAGRAPH_POOL, date, Math.random)
      assert.ok(!dailyIds.has(practice.id), `unfiltered practice pick matched a daily paragraph on ${date.toISOString().slice(0, 10)}`)
    }
  }
})

test('getDailyParagraph is deterministic for a given pool, date, and difficulty', () => {
  const date = new Date('2026-06-15T09:30:00.000Z')
  const first = getDailyParagraph(PARAGRAPH_POOL, date, 'hard')
  const second = getDailyParagraph(PARAGRAPH_POOL, date, 'hard')
  assert.equal(first.id, second.id)
})

test('getDailyParagraph only depends on the calendar date, not the time of day', () => {
  const morning = getDailyParagraph(PARAGRAPH_POOL, new Date('2026-06-15T00:00:01.000Z'), 'medium')
  const night = getDailyParagraph(PARAGRAPH_POOL, new Date('2026-06-15T23:59:59.000Z'), 'medium')
  assert.equal(morning.id, night.id)
})

test('each difficulty tier can land on a different daily paragraph than the others', () => {
  // Not guaranteed for every date by construction, but with 10 paragraphs
  // per tier it would be a suspicious coincidence for all three to always
  // collide across many days — a loose sanity check that the per-tier hash
  // actually varies independently, not a single shared index reused three times.
  let sawDifference = false
  for (const date of simulatedDays(30)) {
    const all = getAllDailyParagraphs(PARAGRAPH_POOL, date)
    if (all.easy.id !== all.medium.id || all.medium.id !== all.hard.id) {
      sawDifference = true
      break
    }
  }
  assert.ok(sawDifference, 'expected at least one day where the three tiers picked different paragraphs')
})

test('getAllDailyParagraphs returns one paragraph per tier, each matching its own difficulty', () => {
  const date = new Date('2026-03-01T00:00:00.000Z')
  const all = getAllDailyParagraphs(PARAGRAPH_POOL, date)
  for (const difficulty of DIFFICULTIES) {
    assert.equal(all[difficulty].difficulty, difficulty)
    assert.deepEqual(all[difficulty], getDailyParagraph(PARAGRAPH_POOL, date, difficulty))
  }
})

test('getPracticeParagraph throws with a single-paragraph pool', () => {
  const singleton = [PARAGRAPH_POOL[0]]
  assert.throws(() => getPracticeParagraph(singleton, new Date('2026-01-01T00:00:00.000Z'), Math.random, singleton[0].difficulty))
})

test('getPracticeParagraph with a difficulty only returns paragraphs of that tier', () => {
  for (const date of simulatedDays(30)) {
    for (const difficulty of DIFFICULTIES) {
      const practice = getPracticeParagraph(PARAGRAPH_POOL, date, Math.random, difficulty)
      assert.equal(practice.difficulty, difficulty)
    }
  }
})
