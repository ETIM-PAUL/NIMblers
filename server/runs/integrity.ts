import type { KeystrokeEvent } from '../../shared/timingEngine.ts'

export type IntegrityFlag = 'near-uniform-intervals' | 'naive-jitter' | 'missing-bigram-structure'

export type IntegrityCheckResult =
  | { rejected: true, reason: string }
  | { rejected: false, flags: IntegrityFlag[] }

/** Starting point per the build plan ("start ~180, tune later"). */
export const DEFAULT_WPM_CEILING = 180

// Common English digraphs a fluent typist's fingers already "know" — these
// type noticeably faster than average. Rare, physically awkward pairs
// (opposite-side reaches, uncommon letter combinations) type noticeably
// slower. A human shows a clear gap between the two; a bot that ignores
// content and just emits keys on a timer doesn't.
const FAST_BIGRAMS = new Set(['th', 'he', 'in', 'er', 'an', 're', 'on', 'at', 'en', 'nd', 'ha', 'es', 'ti', 'to', 'it'])
const SLOW_BIGRAMS = new Set(['qp', 'zx', 'jq', 'vq', 'wz', 'xj', 'qk', 'jx', 'zq', 'qz'])

function intervalsBetween(events: KeystrokeEvent[]): number[] {
  const intervals: number[] = []
  for (let i = 1; i < events.length; i++) {
    intervals.push(events[i].tRelativeMs - events[i - 1].tRelativeMs)
  }
  return intervals
}

function mean(values: number[]): number {
  return values.reduce((a, b) => a + b, 0) / values.length
}

function stddev(values: number[], avg: number = mean(values)): number {
  return Math.sqrt(mean(values.map((v) => (v - avg) ** 2)))
}

function estimateWpm(targetLength: number, durationMs: number): number {
  if (durationMs <= 0) return Infinity
  return targetLength / 5 / (durationMs / 60000)
}

/** A bot emitting keys on a near-perfect fixed timer: almost zero variance. */
function hasNearUniformIntervals(intervals: number[]): boolean {
  if (intervals.length < 5) return false
  const avg = mean(intervals)
  if (avg <= 0) return false
  return stddev(intervals, avg) / avg < 0.08
}

/**
 * A bot adding "human-looking" noise the naive way: samples spread evenly
 * across a range around a constant, rather than the peaked/clustered shape
 * real typing rhythm has. Detected by comparing the actual spread to what a
 * true uniform distribution over the observed range would produce.
 */
function hasNaiveJitter(intervals: number[]): boolean {
  if (intervals.length < 5) return false
  const avg = mean(intervals)
  const min = Math.min(...intervals)
  const max = Math.max(...intervals)
  const range = max - min
  if (range <= 0) return false // constant — that's the near-uniform case, not jitter

  const actualStd = stddev(intervals, avg)
  if (actualStd / avg < 0.08) return false // already near-uniform

  const theoreticalUniformStd = range / Math.sqrt(12)
  const ratio = actualStd / theoreticalUniformStd
  const centered = Math.abs((max + min) / 2 - avg) / range

  return ratio > 0.85 && ratio < 1.15 && centered < 0.15
}

/** No speed-up on easy bigrams, no slow-down on awkward ones — humans show both. */
function hasMissingBigramStructure(events: KeystrokeEvent[]): boolean {
  const fastIntervals: number[] = []
  const slowIntervals: number[] = []

  for (let i = 1; i < events.length; i++) {
    const prevKey = events[i - 1].key
    const key = events[i].key
    if (prevKey.length !== 1 || key.length !== 1) continue

    const bigram = (prevKey + key).toLowerCase()
    const interval = events[i].tRelativeMs - events[i - 1].tRelativeMs
    if (FAST_BIGRAMS.has(bigram)) fastIntervals.push(interval)
    else if (SLOW_BIGRAMS.has(bigram)) slowIntervals.push(interval)
  }

  // Not enough of both kinds in this paragraph to judge either way.
  if (fastIntervals.length < 2 || slowIntervals.length < 1) return false

  const fastAvg = mean(fastIntervals)
  if (fastAvg <= 0) return false
  return mean(slowIntervals) / fastAvg < 1.15
}

/**
 * Runs after `validateRun` has already confirmed the run is authentic. This
 * layer judges plausibility, not authenticity: the WPM ceiling is a hard
 * reject (nobody legitimately types this fast), everything else is a flag.
 * Flagged runs are still accepted and persisted — they go to a review
 * queue, they don't auto-void, because false positives here should be
 * refunded, not silently treated as theft.
 */
export function checkIntegrity(
  target: string,
  events: KeystrokeEvent[],
  durationMs: number,
  wpmCeiling: number = DEFAULT_WPM_CEILING,
): IntegrityCheckResult {
  const wpm = estimateWpm(target.length, durationMs)
  if (wpm > wpmCeiling) {
    return { rejected: true, reason: `estimated ${Math.round(wpm)} WPM exceeds the ${wpmCeiling} WPM ceiling` }
  }

  const intervals = intervalsBetween(events)
  const flags: IntegrityFlag[] = []
  if (hasNearUniformIntervals(intervals)) flags.push('near-uniform-intervals')
  if (hasNaiveJitter(intervals)) flags.push('naive-jitter')
  if (hasMissingBigramStructure(events)) flags.push('missing-bigram-structure')

  return { rejected: false, flags }
}
