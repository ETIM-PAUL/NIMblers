export type CharState = 'correct' | 'incorrect' | 'caret' | 'pending'

/**
 * Per-character render state for a target paragraph against what's been
 * typed so far. Strictly positional — a skipped or extra character shifts
 * everything after it to "incorrect", same as any real typing test.
 */
export function computeCharStates(target: string, typed: string): CharState[] {
  return target.split('').map((char, i) => {
    if (i < typed.length) return typed[i] === char ? 'correct' : 'incorrect'
    if (i === typed.length) return 'caret'
    return 'pending'
  })
}

export function isExactMatch(target: string, typed: string): boolean {
  return typed === target
}

/** Applies one keydown's worth of input to the typed-so-far string. */
export function applyKeydown(target: string, typed: string, key: string): string {
  if (key === 'Backspace') return typed.slice(0, -1)
  if (key.length === 1 && typed.length < target.length) return typed + key
  return typed
}
