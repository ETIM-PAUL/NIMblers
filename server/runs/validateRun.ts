import type { KeystrokeEvent } from '../../shared/timingEngine.ts'
import { applyKeydown } from '../../shared/typingEngine.ts'

export type ValidationResult =
  | { valid: true, durationMs: number }
  | { valid: false, reason: string }

/**
 * Independently replays a client-submitted keystroke stream against a known
 * paragraph. This is the one place that's allowed to trust "what actually
 * happened" — everything the client sent is treated as a claim to verify,
 * never as a fact.
 *
 * The replay uses the exact same `applyKeydown` reducer the client's typing
 * UI uses, so there is no separate "server's opinion of how typing works" to
 * drift out of sync with the client.
 *
 * Three independent things have to hold, or the run is rejected:
 * - timestamps only move forward, starting at 0 (catches edited/reordered
 *   timestamps)
 * - each event's claimed `resultingLength` matches what replaying its `key`
 *   against the previous state actually produces (catches a forged
 *   resultingLength that doesn't correspond to the claimed keys)
 * - the string produced by replaying every event's `key`, in order, is
 *   exactly the target paragraph (catches a forged final string — the
 *   server never trusts a client's claim that it "matched"; it recomputes
 *   the string itself from raw keys)
 *
 * On success, the duration is the last event's `tRelativeMs` — never a
 * value the client sent directly, since `KeystrokeEvent`/`KeystrokeRun`
 * have no duration field at all (see shared/timingEngine.ts).
 */
export function validateRun(target: string, events: KeystrokeEvent[]): ValidationResult {
  if (events.length === 0) {
    return { valid: false, reason: 'empty run' }
  }

  let typed = ''
  let previousT = -1

  for (const [index, event] of events.entries()) {
    if (index === 0 && event.tRelativeMs !== 0) {
      return { valid: false, reason: 'first event must start at tRelativeMs 0' }
    }
    if (event.tRelativeMs < previousT) {
      return { valid: false, reason: `timestamps are not monotonically increasing at event ${index}` }
    }
    previousT = event.tRelativeMs

    typed = applyKeydown(target, typed, event.key)
    if (typed.length !== event.resultingLength) {
      return { valid: false, reason: `resultingLength mismatch at event ${index}: replay disagrees with the client` }
    }
  }

  if (typed !== target) {
    return { valid: false, reason: 'replayed string does not exactly match the target paragraph' }
  }

  return { valid: true, durationMs: events[events.length - 1].tRelativeMs }
}
