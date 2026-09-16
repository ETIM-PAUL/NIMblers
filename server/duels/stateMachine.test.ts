import assert from 'node:assert/strict'
import { test } from 'node:test'
import { applyDuelEvent, createOpenDuel, settlementObligations } from './stateMachine.ts'
import type { Duel, DuelEvent } from './stateMachine.ts'

const STAKE_LUNA = 100_000 // 1 NIM
const ENTRY_TTL_MS = 24 * 60 * 60_000
const LOCK_TTL_MS = 5 * 60_000

function freshOpenDuel(now = 0): Duel {
  return createOpenDuel({
    entryId: 'entry-1',
    creatorUserId: 'creator',
    stakeLuna: STAKE_LUNA,
    entryExpiresAt: now + ENTRY_TTL_MS,
  })
}

// --- Example-based happy paths and edge cases ---

test('OPEN -> CHALLENGE -> LOCKED', () => {
  const open = freshOpenDuel()
  const locked = applyDuelEvent(open, { type: 'CHALLENGE', challengerUserId: 'b', now: 1000, lockTtlMs: LOCK_TTL_MS })
  assert.equal(locked.status, 'LOCKED')
  if (locked.status !== 'LOCKED') return
  assert.equal(locked.challengerUserId, 'b')
  assert.equal(locked.lockTtlExpiresAt, 1000 + LOCK_TTL_MS)
})

test('a second challenger racing for the same OPEN entry is ignored once it is LOCKED', () => {
  const open = freshOpenDuel()
  const locked = applyDuelEvent(open, { type: 'CHALLENGE', challengerUserId: 'b', now: 1000, lockTtlMs: LOCK_TTL_MS })
  const stillLocked = applyDuelEvent(locked, { type: 'CHALLENGE', challengerUserId: 'c', now: 1001, lockTtlMs: LOCK_TTL_MS })

  assert.deepEqual(stillLocked, locked, 'a second CHALLENGE must be a complete no-op')
  if (stillLocked.status !== 'LOCKED') return
  assert.equal(stillLocked.challengerUserId, 'b', 'the original challenger keeps the lock')
})

test('LOCK_TTL_EXPIRED before the deadline is a no-op', () => {
  const open = freshOpenDuel()
  const locked = applyDuelEvent(open, { type: 'CHALLENGE', challengerUserId: 'b', now: 0, lockTtlMs: LOCK_TTL_MS })
  const stillLocked = applyDuelEvent(locked, { type: 'LOCK_TTL_EXPIRED', now: LOCK_TTL_MS - 1 })
  assert.deepEqual(stillLocked, locked)
})

test('LOCK_TTL_EXPIRED after the deadline reopens the entry — B forfeits', () => {
  const open = freshOpenDuel()
  const locked = applyDuelEvent(open, { type: 'CHALLENGE', challengerUserId: 'b', now: 0, lockTtlMs: LOCK_TTL_MS })
  const reopened = applyDuelEvent(locked, { type: 'LOCK_TTL_EXPIRED', now: LOCK_TTL_MS })
  assert.equal(reopened.status, 'OPEN')
  assert.deepEqual(reopened, freshOpenDuel())
})

test('a reopened entry can be challenged again by someone else', () => {
  const open = freshOpenDuel()
  const lockedByB = applyDuelEvent(open, { type: 'CHALLENGE', challengerUserId: 'b', now: 0, lockTtlMs: LOCK_TTL_MS })
  const reopened = applyDuelEvent(lockedByB, { type: 'LOCK_TTL_EXPIRED', now: LOCK_TTL_MS })
  const lockedByC = applyDuelEvent(reopened, {
    type: 'CHALLENGE',
    challengerUserId: 'c',
    now: LOCK_TTL_MS + 1,
    lockTtlMs: LOCK_TTL_MS,
  })
  assert.equal(lockedByC.status, 'LOCKED')
  if (lockedByC.status !== 'LOCKED') return
  assert.equal(lockedByC.challengerUserId, 'c')
})

test('LOCKED -> SUBMIT -> SETTLED with a decisive winner', () => {
  const open = freshOpenDuel()
  const locked = applyDuelEvent(open, { type: 'CHALLENGE', challengerUserId: 'b', now: 0, lockTtlMs: LOCK_TTL_MS })
  const settled = applyDuelEvent(locked, { type: 'SUBMIT', winnerUserId: 'b', challengerStakeLuna: STAKE_LUNA, now: 5000 })
  assert.equal(settled.status, 'SETTLED')
  if (settled.status !== 'SETTLED') return
  assert.equal(settled.winnerUserId, 'b')
})

test('LOCKED -> SUBMIT -> SETTLED with a tie (winnerUserId null)', () => {
  const open = freshOpenDuel()
  const locked = applyDuelEvent(open, { type: 'CHALLENGE', challengerUserId: 'b', now: 0, lockTtlMs: LOCK_TTL_MS })
  const settled = applyDuelEvent(locked, { type: 'SUBMIT', winnerUserId: null, challengerStakeLuna: STAKE_LUNA, now: 5000 })
  assert.equal(settled.status, 'SETTLED')
  if (settled.status !== 'SETTLED') return
  assert.equal(settled.winnerUserId, null)
})

test('SUBMIT carries through a challenger stake larger than the creator\'s — a double-trial retry', () => {
  const open = freshOpenDuel()
  const locked = applyDuelEvent(open, { type: 'CHALLENGE', challengerUserId: 'b', now: 0, lockTtlMs: LOCK_TTL_MS })
  const settled = applyDuelEvent(locked, { type: 'SUBMIT', winnerUserId: 'b', challengerStakeLuna: STAKE_LUNA * 3, now: 5000 })
  assert.equal(settled.status, 'SETTLED')
  if (settled.status !== 'SETTLED') return
  assert.equal(settled.challengerStakeLuna, STAKE_LUNA * 3)
})

test('SUBMIT on an OPEN (unlocked) duel is a no-op — nobody to compare times against', () => {
  const open = freshOpenDuel()
  const unchanged = applyDuelEvent(open, { type: 'SUBMIT', winnerUserId: 'nobody', challengerStakeLuna: STAKE_LUNA, now: 1000 })
  assert.deepEqual(unchanged, open)
})

test('ENTRY_EXPIRED before 24h is a no-op', () => {
  const open = freshOpenDuel(0)
  const unchanged = applyDuelEvent(open, { type: 'ENTRY_EXPIRED', now: ENTRY_TTL_MS - 1 })
  assert.deepEqual(unchanged, open)
})

test('ENTRY_EXPIRED after 24h with no taker expires the entry', () => {
  const open = freshOpenDuel(0)
  const expired = applyDuelEvent(open, { type: 'ENTRY_EXPIRED', now: ENTRY_TTL_MS })
  assert.equal(expired.status, 'EXPIRED')
})

test('ENTRY_EXPIRED on a LOCKED duel is a no-op — challenge takes it out of the 24h window entirely', () => {
  const open = freshOpenDuel(0)
  const locked = applyDuelEvent(open, { type: 'CHALLENGE', challengerUserId: 'b', now: 0, lockTtlMs: LOCK_TTL_MS })
  const unchanged = applyDuelEvent(locked, { type: 'ENTRY_EXPIRED', now: ENTRY_TTL_MS })
  assert.deepEqual(unchanged, locked)
})

test('a CHALLENGE arriving after the entry should already have expired is ignored', () => {
  const open = freshOpenDuel(0)
  const attempt = applyDuelEvent(open, {
    type: 'CHALLENGE',
    challengerUserId: 'b',
    now: ENTRY_TTL_MS + 1,
    lockTtlMs: LOCK_TTL_MS,
  })
  assert.deepEqual(attempt, open)
})

test('every event is a no-op on a SETTLED duel', () => {
  const open = freshOpenDuel()
  const locked = applyDuelEvent(open, { type: 'CHALLENGE', challengerUserId: 'b', now: 0, lockTtlMs: LOCK_TTL_MS })
  const settled = applyDuelEvent(locked, { type: 'SUBMIT', winnerUserId: 'b', challengerStakeLuna: STAKE_LUNA, now: 1000 })

  const events: DuelEvent[] = [
    { type: 'CHALLENGE', challengerUserId: 'c', now: 2000, lockTtlMs: LOCK_TTL_MS },
    { type: 'LOCK_TTL_EXPIRED', now: 999_999 },
    { type: 'SUBMIT', winnerUserId: 'creator', challengerStakeLuna: STAKE_LUNA, now: 999_999 },
    { type: 'ENTRY_EXPIRED', now: 999_999 },
  ]
  for (const event of events) {
    assert.deepEqual(applyDuelEvent(settled, event), settled, `${event.type} must not change a SETTLED duel`)
  }
})

test('every event is a no-op on an EXPIRED duel', () => {
  const open = freshOpenDuel(0)
  const expired = applyDuelEvent(open, { type: 'ENTRY_EXPIRED', now: ENTRY_TTL_MS })

  const events: DuelEvent[] = [
    { type: 'CHALLENGE', challengerUserId: 'b', now: ENTRY_TTL_MS + 1, lockTtlMs: LOCK_TTL_MS },
    { type: 'LOCK_TTL_EXPIRED', now: 999_999 },
    { type: 'SUBMIT', winnerUserId: 'creator', challengerStakeLuna: STAKE_LUNA, now: 999_999 },
    { type: 'ENTRY_EXPIRED', now: 999_999 },
  ]
  for (const event of events) {
    assert.deepEqual(applyDuelEvent(expired, event), expired, `${event.type} must not change an EXPIRED duel`)
  }
})

// --- settlementObligations ---

test('settlementObligations is empty for OPEN and LOCKED — nothing is owed until a duel resolves', () => {
  const open = freshOpenDuel()
  const locked = applyDuelEvent(open, { type: 'CHALLENGE', challengerUserId: 'b', now: 0, lockTtlMs: LOCK_TTL_MS })
  assert.deepEqual(settlementObligations(open), [])
  assert.deepEqual(settlementObligations(locked), [])
})

test('settlementObligations refunds the creator in full when EXPIRED', () => {
  const open = freshOpenDuel(0)
  const expired = applyDuelEvent(open, { type: 'ENTRY_EXPIRED', now: ENTRY_TTL_MS })
  assert.deepEqual(settlementObligations(expired), [{ userId: 'creator', amountLuna: STAKE_LUNA }])
})

test('settlementObligations pays the winner the full pot on a decisive SETTLED', () => {
  const open = freshOpenDuel()
  const locked = applyDuelEvent(open, { type: 'CHALLENGE', challengerUserId: 'b', now: 0, lockTtlMs: LOCK_TTL_MS })
  const settled = applyDuelEvent(locked, { type: 'SUBMIT', winnerUserId: 'b', challengerStakeLuna: STAKE_LUNA, now: 1000 })
  assert.deepEqual(settlementObligations(settled), [{ userId: 'b', amountLuna: STAKE_LUNA * 2 }])
})

test('settlementObligations refunds both players in full on a tie', () => {
  const open = freshOpenDuel()
  const locked = applyDuelEvent(open, { type: 'CHALLENGE', challengerUserId: 'b', now: 0, lockTtlMs: LOCK_TTL_MS })
  const settled = applyDuelEvent(locked, { type: 'SUBMIT', winnerUserId: null, challengerStakeLuna: STAKE_LUNA, now: 1000 })
  assert.deepEqual(settlementObligations(settled), [
    { userId: 'creator', amountLuna: STAKE_LUNA },
    { userId: 'b', amountLuna: STAKE_LUNA },
  ])
})

test('settlementObligations accounts for an uneven pot after a double-trial retry — winner takes it all', () => {
  const open = freshOpenDuel()
  const locked = applyDuelEvent(open, { type: 'CHALLENGE', challengerUserId: 'b', now: 0, lockTtlMs: LOCK_TTL_MS })
  // B staked the original amount, then retried for double on top: 3x total.
  const settled = applyDuelEvent(locked, { type: 'SUBMIT', winnerUserId: 'creator', challengerStakeLuna: STAKE_LUNA * 3, now: 1000 })
  assert.deepEqual(settlementObligations(settled), [{ userId: 'creator', amountLuna: STAKE_LUNA + STAKE_LUNA * 3 }])
})

test('settlementObligations refunds a post-retry tie proportionally — each side gets back only what they staked', () => {
  const open = freshOpenDuel()
  const locked = applyDuelEvent(open, { type: 'CHALLENGE', challengerUserId: 'b', now: 0, lockTtlMs: LOCK_TTL_MS })
  const settled = applyDuelEvent(locked, { type: 'SUBMIT', winnerUserId: null, challengerStakeLuna: STAKE_LUNA * 3, now: 1000 })
  assert.deepEqual(settlementObligations(settled), [
    { userId: 'creator', amountLuna: STAKE_LUNA },
    { userId: 'b', amountLuna: STAKE_LUNA * 3 },
  ])
})

// --- Property test ---

/** Deterministic PRNG (mulberry32) so failures are reproducible without pulling in a fuzzing library. */
function mulberry32(seed: number): () => number {
  let state = seed
  return () => {
    state |= 0
    state = (state + 0x6D2B79F5) | 0
    let t = Math.imul(state ^ (state >>> 15), 1 | state)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function randomEvent(rng: () => number, duel: Duel, now: number): DuelEvent {
  const choice = rng()
  const challengers = ['b', 'c', 'd']
  const challenger = challengers[Math.floor(rng() * challengers.length)]

  if (choice < 0.3) {
    return { type: 'CHALLENGE', challengerUserId: challenger, now, lockTtlMs: LOCK_TTL_MS }
  }
  if (choice < 0.5) {
    return { type: 'LOCK_TTL_EXPIRED', now }
  }
  if (choice < 0.8) {
    let winnerUserId: string | null = null
    let challengerStakeLuna = STAKE_LUNA
    if (duel.status === 'LOCKED') {
      const r = rng()
      winnerUserId = r < 0.45 ? duel.creatorUserId : r < 0.9 ? duel.challengerUserId : null
      // Sometimes exercise a double-trial retry having pushed the challenger's total stake to 3x.
      challengerStakeLuna = rng() < 0.5 ? STAKE_LUNA : STAKE_LUNA * 3
    }
    return { type: 'SUBMIT', winnerUserId, challengerStakeLuna, now }
  }
  return { type: 'ENTRY_EXPIRED', now }
}

test('property: no sequence of events ever settles a duel twice, pays more than the actual pot staked, or strands a stake', () => {
  const ITERATIONS = 500
  const STEPS_PER_ITERATION = 40

  for (let iteration = 0; iteration < ITERATIONS; iteration++) {
    const rng = mulberry32(iteration + 1)
    let duel: Duel = freshOpenDuel(0)
    let now = 0
    let settledOnce = false
    let expiredOnce = false

    for (let step = 0; step < STEPS_PER_ITERATION; step++) {
      now += Math.floor(rng() * 10 * 60_000) // advance the clock 0-10 simulated minutes per step
      const event = randomEvent(rng, duel, now)
      const next = applyDuelEvent(duel, event)
      const context = `iteration ${iteration}, step ${step}, event ${event.type}`

      // A terminal duel is completely immutable to every further event.
      if (duel.status === 'SETTLED' || duel.status === 'EXPIRED') {
        assert.deepEqual(next, duel, `a terminal duel must never change (${context})`)
      }

      // Settling/expiring only ever happens once across the whole lifecycle.
      if (next.status === 'SETTLED' && duel.status !== 'SETTLED') {
        assert.equal(settledOnce, false, `duel settled more than once (${context})`)
        settledOnce = true
      }
      if (next.status === 'EXPIRED' && duel.status !== 'EXPIRED') {
        assert.equal(expiredOnce, false, `duel expired more than once (${context})`)
        expiredOnce = true
      }
      assert.ok(!(settledOnce && expiredOnce), `a duel must never reach both SETTLED and EXPIRED (${context})`)

      // The pot never exceeds the stake plus whatever the challenger actually
      // staked (up to 3x after a double-trial retry) — never owe more than that.
      const obligations = settlementObligations(next)
      const totalOwed = obligations.reduce((sum, o) => sum + o.amountLuna, 0)
      assert.ok(totalOwed <= STAKE_LUNA * 4, `owed ${totalOwed} exceeds the largest possible pot (${context})`)

      // A terminal state always has a well-defined, claimable payout — no stranded stake.
      if (next.status === 'SETTLED' || next.status === 'EXPIRED') {
        assert.ok(totalOwed > 0, `terminal duel has no payout obligation (${context})`)
      }

      duel = next
    }
  }
})
