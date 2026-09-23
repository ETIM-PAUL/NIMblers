import { useEffect, useRef, useState } from 'react'
import { applyKeydown, computeCharStates, isExactMatch } from '../../shared/typingEngine'
import type { KeystrokeRun } from '../../shared/timingEngine'
import { EMPTY_RECORDER_STATE, recordKeystroke } from '../../shared/timingEngine'

interface Props {
  paragraph: string
  onSubmit: (run: KeystrokeRun) => void
}

/**
 * A zero-width character the hidden input always holds between keystrokes.
 * Android's on-screen keyboards route ordinary character input through IME
 * composition rather than real `KeyboardEvent`s — `keydown` fires with
 * `key: "Unidentified"` (or doesn't fire at all) for a composed character,
 * so there's nothing usable to read there; that's what left the caret stuck
 * on the first character for Android players. Backspacing an otherwise-empty
 * input produces no `input` event to react to either. Keeping this one
 * character present at all times turns both cases into an ordinary,
 * cross-platform `input`/`change` event instead: typing appends after it,
 * and deleting it down to nothing is exactly what backspacing an "empty"
 * box looks like — so the whole component now drives off `onChange`, not
 * `onKeyDown`, and works the same way on a real keyboard, iOS, and Android.
 */
const SENTINEL = '​'

export function TypingEngine({ paragraph, onSubmit }: Props) {
  const [typed, setTyped] = useState('')
  // Local display only — never sent anywhere; the server independently
  // derives the authoritative duration from the raw keystroke events.
  const [wpm, setWpm] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const recorderRef = useRef(EMPTY_RECORDER_STATE)

  const states = computeCharStates(paragraph, typed)
  const complete = isExactMatch(paragraph, typed)
  const correctCount = states.filter((s) => s === 'correct').length
  const accuracy = typed.length > 0 ? Math.round((correctCount / typed.length) * 100) : 100

  function resetInputToSentinel() {
    const el = inputRef.current
    if (!el) return
    el.value = SENTINEL
    el.setSelectionRange(SENTINEL.length, SENTINEL.length)
  }

  // A fresh paragraph (a new duel, a retry) starts from a clean slate even
  // when this component isn't remounted.
  useEffect(() => {
    setTyped('')
    setWpm(0)
    recorderRef.current = EMPTY_RECORDER_STATE
    resetInputToSentinel()
  }, [paragraph])

  /** Applies one logical keystroke ("Backspace" or a single character) and returns the resulting typed string. */
  function processKey(key: string, currentTyped: string): string {
    const next = applyKeydown(paragraph, currentTyped, key)
    if (next === currentTyped) return currentTyped

    const nowMs = performance.now()
    recorderRef.current = recordKeystroke(recorderRef.current, {
      key,
      nowMs,
      resultingLength: next.length,
      isMatch: isExactMatch(paragraph, next),
    })

    const startedAtMs = recorderRef.current.startedAtMs
    const elapsedMinutes = startedAtMs !== null ? (nowMs - startedAtMs) / 60_000 : 0
    const nextCorrectCount = computeCharStates(paragraph, next).filter((s) => s === 'correct').length
    setWpm(elapsedMinutes > 0 ? Math.round(nextCorrectCount / 5 / elapsedMinutes) : 0)
    return next
  }

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const raw = e.target.value
    let current = typed

    if (raw.length > SENTINEL.length) {
      // Everything after the sentinel is what got typed/composed/pasted
      // this event — one character at a time is enough even for a
      // multi-character IME composition or predictive-text insert.
      const inserted = raw.startsWith(SENTINEL) ? raw.slice(SENTINEL.length) : raw.replace(SENTINEL, '')
      for (const char of inserted) current = processKey(char, current)
    }
    else if (raw.length < SENTINEL.length) {
      current = processKey('Backspace', current)
    }

    setTyped(current)
    resetInputToSentinel()
  }

  return (
    <div className="typing-engine">
      <div className="typing-hud">
        <div className="typing-hud-stat">
          <span className="typing-hud-value">{wpm}</span>
          <span className="typing-hud-label">wpm</span>
        </div>
        <div className="typing-hud-stat">
          <span className="typing-hud-value">{accuracy}%</span>
          <span className="typing-hud-label">accuracy</span>
        </div>
      </div>
      <div className="typing-progress">
        <div className="typing-progress-fill" style={{ width: `${(typed.length / paragraph.length) * 100}%` }} />
      </div>
      <p
        className="typing-paragraph"
        onClick={() => inputRef.current?.focus()}
      >
        {paragraph.split('').map((char, i) => (
          <span key={i} className={`char char-${states[i]}`}>
            {char}
          </span>
        ))}
      </p>

      <input
        ref={inputRef}
        className="visually-hidden-input typing-input"
        aria-label="Type the paragraph above"
        autoComplete="off"
        autoCorrect="off"
        autoCapitalize="off"
        spellCheck={false}
        defaultValue={SENTINEL}
        onChange={handleChange}
        onFocus={resetInputToSentinel}
        onPaste={(e) => e.preventDefault()}
        onDrop={(e) => e.preventDefault()}
        onDragOver={(e) => e.preventDefault()}
      />

      <button
        type="button"
        className="btn btn-primary"
        disabled={!complete}
        onClick={() => onSubmit(recorderRef.current.run)}
      >
        Submit
      </button>
    </div>
  )
}
