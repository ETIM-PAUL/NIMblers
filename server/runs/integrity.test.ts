import assert from 'node:assert/strict'
import { test } from 'node:test'
import { checkIntegrity } from './integrity.ts'
import type { KeystrokeEvent } from '../../shared/timingEngine.ts'

// Deliberately not real English: three "th" (fast bigram) and three "qp"
// (slow bigram) occurrences, so every profile below gets the same three
// samples of each to judge bigram structure from.
const TARGET = 'th th th qp qp qp'

function eventsFromIntervals(intervals: number[]): KeystrokeEvent[] {
  const events: KeystrokeEvent[] = []
  let t = 0
  for (const [i, char] of TARGET.split('').entries()) {
    if (i > 0) t += intervals[i - 1]
    events.push({ key: char, tRelativeMs: t, resultingLength: i + 1 })
  }
  return events
}

test('bot profile 1 — fixed-delay timer is flagged as near-uniform', () => {
  const intervals = Array(TARGET.length - 1).fill(80)
  const result = checkIntegrity(TARGET, eventsFromIntervals(intervals), intervals.reduce((a, b) => a + b, 0))
  assert.equal(result.rejected, false)
  if (result.rejected) return
  assert.ok(result.flags.includes('near-uniform-intervals'), `expected near-uniform-intervals, got ${result.flags}`)
})

test('bot profile 2 — naive uniform-noise jitter is flagged as naive-jitter', () => {
  // Evenly spaced -15..15 around a base of 80 — the textbook "add some
  // random-looking noise" mistake: real human variance isn't spread flat.
  const intervals = Array.from({ length: 16 }, (_, i) => 80 + (-15 + i * 2))
  const result = checkIntegrity(TARGET, eventsFromIntervals(intervals), intervals.reduce((a, b) => a + b, 0))
  assert.equal(result.rejected, false)
  if (result.rejected) return
  assert.ok(result.flags.includes('naive-jitter'), `expected naive-jitter, got ${result.flags}`)
  assert.ok(!result.flags.includes('near-uniform-intervals'))
})

test('bot profile 3 — bimodal timing uncorrelated with bigram identity is flagged as missing-bigram-structure', () => {
  // "th" (events 0,3,6) and "qp" (events 9,12,15) each get the exact same
  // [60,200,60] mix, so there is zero content-driven speed difference —
  // despite the run having plenty of raw variance (not near-uniform) and a
  // clearly bimodal, non-uniform shape (not naive-jitter).
  const intervals = [60, 200, 60, 200, 60, 200, 60, 200, 60, 60, 200, 60, 200, 60, 200, 60]
  const result = checkIntegrity(TARGET, eventsFromIntervals(intervals), intervals.reduce((a, b) => a + b, 0))
  assert.equal(result.rejected, false)
  if (result.rejected) return
  assert.ok(
    result.flags.includes('missing-bigram-structure'),
    `expected missing-bigram-structure, got ${result.flags}`,
  )
  assert.ok(!result.flags.includes('near-uniform-intervals'))
  assert.ok(!result.flags.includes('naive-jitter'))
})

test('a recording of a human typing is not flagged by anything', () => {
  // Fast on "th" (~90-125ms, low internal spread), clearly slower on "qp"
  // (~240-255ms), with irregular, non-uniform pacing everywhere else —
  // the natural shape real typing rhythm has, not evenly-spread noise.
  const intervals = [88, 112, 118, 93, 121, 116, 80, 124, 109, 255, 118, 111, 248, 127, 133, 241]
  const result = checkIntegrity(TARGET, eventsFromIntervals(intervals), intervals.reduce((a, b) => a + b, 0))
  assert.equal(result.rejected, false)
  if (result.rejected) return
  assert.deepEqual(result.flags, [])
})

test('a run far above the WPM ceiling is hard-rejected, not just flagged', () => {
  const fastTarget = 'the quick brown fox' // 19 chars
  const events: KeystrokeEvent[] = fastTarget.split('').map((char, i) => ({
    key: char,
    tRelativeMs: i * 15, // 15ms per keystroke — impossibly fast
    resultingLength: i + 1,
  }))
  const durationMs = events[events.length - 1].tRelativeMs
  const result = checkIntegrity(fastTarget, events, durationMs)
  assert.equal(result.rejected, true)
  if (!result.rejected) return
  assert.match(result.reason, /WPM ceiling/)
})

test('a run right at a reasonable pace stays under the WPM ceiling', () => {
  const target = 'the quick brown fox' // 19 chars, 4 words -> at 100ms/key, well under 180 WPM
  const events: KeystrokeEvent[] = target.split('').map((char, i) => ({
    key: char,
    tRelativeMs: i * 100,
    resultingLength: i + 1,
  }))
  const durationMs = events[events.length - 1].tRelativeMs
  const result = checkIntegrity(target, events, durationMs)
  assert.equal(result.rejected, false)
})
