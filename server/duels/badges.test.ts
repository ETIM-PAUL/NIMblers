import assert from 'node:assert/strict'
import { test } from 'node:test'
import { computeBadges } from './badges.ts'
import type { DuelHistoryEntry } from './service.ts'

function entry(overrides: Partial<DuelHistoryEntry> = {}): DuelHistoryEntry {
  return {
    entryId: 'entry',
    difficulty: 'easy',
    stakeLuna: 100_000,
    settledAt: new Date().toISOString(),
    opponentAddress: 'opponent',
    outcome: 'won',
    myDurationMs: 999_999,
    opponentDurationMs: 999_999,
    deltaMs: 1000,
    flawless: false,
    ...overrides,
  }
}

test('computeBadges awards flawless only for a won duel with no corrections', () => {
  assert.deepEqual(computeBadges([entry({ outcome: 'won', flawless: true })]).map((b) => b.id), ['flawless'])
  assert.deepEqual(computeBadges([entry({ outcome: 'lost', flawless: true })]), [])
  assert.deepEqual(computeBadges([entry({ outcome: 'won', flawless: false })]), [])
})

test('computeBadges awards speed-demon for a won duel under 30 seconds, not a loss or a slow win', () => {
  assert.deepEqual(computeBadges([entry({ outcome: 'won', myDurationMs: 29_999 })]).map((b) => b.id), ['speed-demon'])
  assert.deepEqual(computeBadges([entry({ outcome: 'won', myDurationMs: 30_000 })]), [])
  assert.deepEqual(computeBadges([entry({ outcome: 'lost', myDurationMs: 1000 })]), [])
})

test('computeBadges awards win-streak-5 for five consecutive wins, walking oldest to newest', () => {
  // listMyDuelHistory returns newest-first; index 0 is the most recent.
  const wins = Array.from({ length: 5 }, () => entry({ outcome: 'won', myDurationMs: 999_999 }))
  assert.deepEqual(computeBadges(wins).map((b) => b.id).sort(), ['win-streak-5'])
})

test('computeBadges does not award win-streak-5 when a loss breaks up the streak', () => {
  const history = [
    entry({ outcome: 'won', myDurationMs: 999_999 }),
    entry({ outcome: 'won', myDurationMs: 999_999 }),
    entry({ outcome: 'lost', myDurationMs: 999_999 }),
    entry({ outcome: 'won', myDurationMs: 999_999 }),
    entry({ outcome: 'won', myDurationMs: 999_999 }),
  ]
  assert.deepEqual(computeBadges(history), [])
})

test('computeBadges finds a streak buried earlier in history, not just at the most recent end', () => {
  const history = [
    entry({ outcome: 'lost', myDurationMs: 999_999 }), // most recent
    entry({ outcome: 'won', myDurationMs: 999_999 }),
    entry({ outcome: 'won', myDurationMs: 999_999 }),
    entry({ outcome: 'won', myDurationMs: 999_999 }),
    entry({ outcome: 'won', myDurationMs: 999_999 }),
    entry({ outcome: 'won', myDurationMs: 999_999 }), // oldest
  ]
  assert.deepEqual(computeBadges(history).map((b) => b.id), ['win-streak-5'])
})

test('computeBadges returns nothing for an empty history', () => {
  assert.deepEqual(computeBadges([]), [])
})
