import assert from 'node:assert/strict'
import { test } from 'node:test'
import { EMPTY_RECORDER_STATE, getDurationMs, recordKeystroke } from './timingEngine.ts'

test('the clock starts on the first keystroke, not before', () => {
  // No matter how much time "passed" before the first call, startedAtMs is
  // whatever that first call's clock reading is — never an earlier render time.
  const afterFirst = recordKeystroke(EMPTY_RECORDER_STATE, {
    key: 'a',
    nowMs: 5000,
    resultingLength: 1,
    isMatch: false,
  })
  assert.equal(afterFirst.startedAtMs, 5000)
  assert.equal(afterFirst.run.events[0].tRelativeMs, 0)
})

test('a scripted run of known intervals produces the exact expected duration', () => {
  // Typing "cat": 'c' at t=1000, 'a' at t=1220 (+220ms), 't' at t=1350 (+130ms, completes the match).
  let state = EMPTY_RECORDER_STATE
  state = recordKeystroke(state, { key: 'c', nowMs: 1000, resultingLength: 1, isMatch: false })
  state = recordKeystroke(state, { key: 'a', nowMs: 1220, resultingLength: 2, isMatch: false })
  state = recordKeystroke(state, { key: 't', nowMs: 1350, resultingLength: 3, isMatch: true })

  assert.deepEqual(
    state.run.events.map((e) => ({ key: e.key, tRelativeMs: e.tRelativeMs, resultingLength: e.resultingLength })),
    [
      { key: 'c', tRelativeMs: 0, resultingLength: 1 },
      { key: 'a', tRelativeMs: 220, resultingLength: 2 },
      { key: 't', tRelativeMs: 350, resultingLength: 3 },
    ],
  )
  assert.equal(getDurationMs(state), 350)
})

test('clicking Submit three seconds late does not change the recorded time', () => {
  let state = EMPTY_RECORDER_STATE
  state = recordKeystroke(state, { key: 'h', nowMs: 0, resultingLength: 1, isMatch: false })
  state = recordKeystroke(state, { key: 'i', nowMs: 180, resultingLength: 2, isMatch: true })

  const durationAtCompletion = getDurationMs(state)
  assert.equal(durationAtCompletion, 180)

  // Three seconds pass before Submit is clicked. Nothing about clicking a
  // button ever calls recordKeystroke, but even a stray keystroke arriving
  // late (e.g. a trailing backspace) must not move the recorded duration.
  const lateState = recordKeystroke(state, {
    key: 'Backspace',
    nowMs: 3180,
    resultingLength: 1,
    isMatch: false,
  })

  assert.equal(lateState, state) // frozen: literally the same state, no-op
  assert.equal(getDurationMs(lateState), durationAtCompletion)
  assert.equal(lateState.run.events.length, 2)
})

test('getDurationMs is null until the run is complete', () => {
  const state = recordKeystroke(EMPTY_RECORDER_STATE, {
    key: 'a',
    nowMs: 0,
    resultingLength: 1,
    isMatch: false,
  })
  assert.equal(getDurationMs(state), null)
  assert.equal(getDurationMs(EMPTY_RECORDER_STATE), null)
})
