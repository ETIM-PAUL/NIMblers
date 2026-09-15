import { useState } from 'react'
import type { Difficulty } from '../../server/paragraphs/service'
import { getPracticeParagraph } from '../../server/paragraphs/service'
import { PARAGRAPH_POOL } from '../../server/paragraphs/pool-data'
import { getRunDurationMs } from '../lib/timingEngine'
import { TypingEngine } from './TypingEngine'

const DIFFICULTIES: Difficulty[] = ['easy', 'medium', 'hard']
const DIFFICULTY_LABELS: Record<Difficulty, string> = { easy: 'Easy', medium: 'Medium', hard: 'Hard' }

function pickParagraph(difficulty: Difficulty): string {
  return getPracticeParagraph(PARAGRAPH_POOL, new Date(), Math.random, difficulty).body
}

export function PracticePanel() {
  const [difficulty, setDifficulty] = useState<Difficulty | null>(null)
  const [paragraph, setParagraph] = useState<string | null>(null)
  const [durationMs, setDurationMs] = useState<number | null>(null)

  function selectDifficulty(next: Difficulty) {
    setDifficulty(next)
    setParagraph(pickParagraph(next))
    setDurationMs(null)
  }

  if (difficulty === null || paragraph === null) {
    return (
      <div className="difficulty-picker">
        {DIFFICULTIES.map((d) => (
          <button
            key={d}
            type="button"
            className={`btn btn-difficulty btn-difficulty-${d}`}
            onClick={() => selectDifficulty(d)}
          >
            {DIFFICULTY_LABELS[d]}
          </button>
        ))}
      </div>
    )
  }

  if (durationMs !== null) {
    return (
      <>
        <p className="section-note">
          Matched in {Math.round(durationMs)}ms on {DIFFICULTY_LABELS[difficulty]}. (Nothing is saved yet.)
        </p>
        <div className="practice-actions">
          <button type="button" className="btn btn-primary" onClick={() => selectDifficulty(difficulty)}>
            Play again
          </button>
          <button type="button" className="btn btn-secondary" onClick={() => setDifficulty(null)}>
            Change level
          </button>
        </div>
      </>
    )
  }

  return <TypingEngine paragraph={paragraph} onSubmit={(run) => setDurationMs(getRunDurationMs(run))} />
}
