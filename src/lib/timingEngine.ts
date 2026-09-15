export interface KeystrokeEvent {
  key: string
  tRelativeMs: number
  resultingLength: number
}

/**
 * What eventually gets sent to the server (Phase 7+): the ordered event
 * stream, nothing else. There is deliberately no `durationMs` field here —
 * the client never reports a time; a duration is only ever derived (in
 * tests here, by the server later) from the last event's `tRelativeMs`.
 */
export interface KeystrokeRun {
  events: KeystrokeEvent[]
}

export interface KeystrokeRecorderState {
  startedAtMs: number | null
  run: KeystrokeRun
  isComplete: boolean
}

export const EMPTY_RECORDER_STATE: KeystrokeRecorderState = {
  startedAtMs: null,
  run: { events: [] },
  isComplete: false,
}

export interface RecordKeystrokeInput {
  key: string
  nowMs: number
  resultingLength: number
  /** Whether this keystroke brings the typed string to an exact match. */
  isMatch: boolean
}

/**
 * Pure reducer for one recorded keystroke.
 *
 * The clock starts on the first call (the first keystroke), not before —
 * `startedAtMs` stays null until then, however much time passed since the
 * component rendered. Once a call arrives with `isMatch: true`, that event
 * is recorded and the run freezes: every later call is a no-op, so nothing
 * that happens after the match (more typing, backspacing, waiting to click
 * Submit) can change the recorded timing.
 */
export function recordKeystroke(
  state: KeystrokeRecorderState,
  input: RecordKeystrokeInput,
): KeystrokeRecorderState {
  if (state.isComplete) return state

  const startedAtMs = state.startedAtMs ?? input.nowMs
  const event: KeystrokeEvent = {
    key: input.key,
    tRelativeMs: input.nowMs - startedAtMs,
    resultingLength: input.resultingLength,
  }

  return {
    startedAtMs,
    run: { events: [...state.run.events, event] },
    isComplete: input.isMatch,
  }
}

/**
 * The completing keystroke's relative timestamp — i.e. the duration of a
 * finished run — or null if the run hasn't been completed yet. Exists for
 * local testing and display only; the server recomputes this independently
 * from the raw events rather than trusting a value the client sends.
 */
export function getDurationMs(state: KeystrokeRecorderState): number | null {
  if (!state.isComplete) return null
  return getRunDurationMs(state.run)
}

/** Same derivation as {@link getDurationMs}, for callers that only have the emitted run (no recorder state). */
export function getRunDurationMs(run: KeystrokeRun): number | null {
  const { events } = run
  return events.length > 0 ? events[events.length - 1].tRelativeMs : null
}
