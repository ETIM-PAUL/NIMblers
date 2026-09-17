import { useRef, useState } from 'react'
import { applyKeydown, computeCharStates, isExactMatch } from '../../shared/typingEngine'
import type { KeystrokeRun } from '../../shared/timingEngine'
import { EMPTY_RECORDER_STATE, recordKeystroke } from '../../shared/timingEngine'

interface Props {
  paragraph: string
  onSubmit: (run: KeystrokeRun) => void
}

export function TypingEngine({ paragraph, onSubmit }: Props) {
  const [typed, setTyped] = useState('')
  // Local display only — never sent anywhere; the server independently
  // derives the authoritative duration from the raw keystroke events. Set
  // only from the keydown handler (never computed during render) since it
  // depends on the current time, not just props/state.
  const [wpm, setWpm] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const recorderRef = useRef(EMPTY_RECORDER_STATE)

  const states = computeCharStates(paragraph, typed)
  const complete = isExactMatch(paragraph, typed)
  const correctCount = states.filter((s) => s === 'correct').length
  const accuracy = typed.length > 0 ? Math.round((correctCount / typed.length) * 100) : 100

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    const next = applyKeydown(paragraph, typed, e.key)
    if (next !== typed) {
      e.preventDefault()
      const nowMs = performance.now()
      recorderRef.current = recordKeystroke(recorderRef.current, {
        key: e.key,
        nowMs,
        resultingLength: next.length,
        isMatch: isExactMatch(paragraph, next),
      })
      setTyped(next)

      const startedAtMs = recorderRef.current.startedAtMs
      const elapsedMinutes = startedAtMs !== null ? (nowMs - startedAtMs) / 60_000 : 0
      const nextCorrectCount = computeCharStates(paragraph, next).filter((s) => s === 'correct').length
      setWpm(elapsedMinutes > 0 ? Math.round(nextCorrectCount / 5 / elapsedMinutes) : 0)
    }
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
        onKeyDown={handleKeyDown}
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
