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
  const inputRef = useRef<HTMLInputElement>(null)
  const recorderRef = useRef(EMPTY_RECORDER_STATE)

  const states = computeCharStates(paragraph, typed)
  const complete = isExactMatch(paragraph, typed)

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    const next = applyKeydown(paragraph, typed, e.key)
    if (next !== typed) {
      e.preventDefault()
      recorderRef.current = recordKeystroke(recorderRef.current, {
        key: e.key,
        nowMs: performance.now(),
        resultingLength: next.length,
        isMatch: isExactMatch(paragraph, next),
      })
      setTyped(next)
    }
  }

  return (
    <div className="typing-engine">
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
        className="visually-hidden-input"
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
