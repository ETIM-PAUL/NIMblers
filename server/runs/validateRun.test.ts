import assert from 'node:assert/strict'
import { test } from 'node:test'
import { validateRun } from './validateRun.ts'

const TARGET = 'hi there'

function honestRun(): { key: string, tRelativeMs: number, resultingLength: number }[] {
  // Types "hi there" with a real key for every character, including the space.
  const events: { key: string, tRelativeMs: number, resultingLength: number }[] = []
  let typed = ''
  for (const [i, char] of TARGET.split('').entries()) {
    typed += char
    events.push({ key: char, tRelativeMs: i * 40, resultingLength: typed.length })
  }
  return events
}

test('a valid run is accepted and its duration is the last event\'s tRelativeMs', () => {
  const events = honestRun()
  const result = validateRun(TARGET, events)
  assert.equal(result.valid, true)
  if (result.valid) assert.equal(result.durationMs, events[events.length - 1].tRelativeMs)
})

test('an empty run is rejected', () => {
  const result = validateRun(TARGET, [])
  assert.equal(result.valid, false)
})

test('a tampered payload: the first event not starting at tRelativeMs 0 is rejected', () => {
  const events = honestRun()
  events[0] = { ...events[0], tRelativeMs: 500 }
  const result = validateRun(TARGET, events)
  assert.equal(result.valid, false)
})

test('a tampered payload: an edited timestamp that goes backwards is rejected', () => {
  const events = honestRun()
  // Edit a middle timestamp to be earlier than the one before it.
  events[3] = { ...events[3], tRelativeMs: events[2].tRelativeMs - 10 }
  const result = validateRun(TARGET, events)
  assert.equal(result.valid, false)
})

test('a tampered payload: a forged resultingLength that disagrees with the replay is rejected', () => {
  const events = honestRun()
  // Claim the string got longer than typing this key could actually produce.
  events[2] = { ...events[2], resultingLength: events[2].resultingLength + 5 }
  const result = validateRun(TARGET, events)
  assert.equal(result.valid, false)
  if (!result.valid) assert.match(result.reason, /resultingLength mismatch/)
})

test('a tampered payload: a forged final string (wrong keys, plausible lengths) is rejected', () => {
  // Every resultingLength increments by exactly 1, exactly like an honest
  // run — but the keys themselves don't spell the target paragraph. A naive
  // validator that only checks resultingLength would be fooled by this.
  const events = TARGET.split('').map((_, i) => ({ key: 'x', tRelativeMs: i * 40, resultingLength: i + 1 }))
  const result = validateRun(TARGET, events)
  assert.equal(result.valid, false)
  if (!result.valid) assert.match(result.reason, /does not exactly match/)
})

test('a tampered payload: trailing events after the match break the final match check', () => {
  const events = honestRun()
  // Backspacing after "completing" the run — the final replayed string no
  // longer equals the target, so this must be rejected even though every
  // individual step replays consistently.
  const last = events[events.length - 1]
  events.push({ key: 'Backspace', tRelativeMs: last.tRelativeMs + 50, resultingLength: last.resultingLength - 1 })
  const result = validateRun(TARGET, events)
  assert.equal(result.valid, false)
})

test('an impossibly fast run is still accepted by validateRun alone — that is Phase 8\'s job', () => {
  // validateRun only checks internal consistency and an exact match, not
  // plausibility of speed. A run with all events at tRelativeMs 0 replays
  // consistently, so it passes here; bot-detection heuristics come later.
  const events = TARGET.split('').map((char, i) => {
    const typed = TARGET.slice(0, i + 1)
    return { key: char, tRelativeMs: 0, resultingLength: typed.length }
  })
  const result = validateRun(TARGET, events)
  assert.equal(result.valid, true)
})
