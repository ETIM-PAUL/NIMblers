import { useState } from 'react'
import { getPracticeParagraph } from '../../server/paragraphs/service'
import { PARAGRAPH_POOL } from '../../server/paragraphs/pool-data'
import { getRunDurationMs } from '../../shared/timingEngine'
import type { Difficulty } from '../lib/api'
import { DIFFICULTIES, DIFFICULTY_LABELS } from '../lib/api'
import { getBrowserLocalStorage } from '../lib/browserStorage'
import { getPersonalBest, recordResult } from '../lib/personalBest'
import { EasyIcon, HardIcon, MediumIcon } from './NavIcons'
import { TypingEngine } from './TypingEngine'

const DIFFICULTY_ICONS: Record<Difficulty, React.ReactNode> = { easy: <EasyIcon />, medium: <MediumIcon />, hard: <HardIcon /> }

function pickParagraph(difficulty: Difficulty): string {
  return getPracticeParagraph(PARAGRAPH_POOL, new Date(), Math.random, difficulty).body
}

function formatMs(ms: number): string {
  return `${Math.round(ms)}ms`
}

interface Result {
  durationMs: number
  best: number
  isNewBest: boolean
}

export function PracticePanel() {
  const [difficulty, setDifficulty] = useState<Difficulty | null>(null)
  const [paragraph, setParagraph] = useState<string | null>(null)
  const [result, setResult] = useState<Result | null>(null)

  function selectDifficulty(next: Difficulty) {
    setDifficulty(next)
    setParagraph(pickParagraph(next))
    setResult(null)
  }

  function handleSubmit(runDurationMs: number | null) {
    if (runDurationMs === null || difficulty === null) return
    const storage = getBrowserLocalStorage()
    const outcome = storage
      ? recordResult(storage, difficulty, runDurationMs)
      : { best: runDurationMs, isNewBest: false }
    setResult({ durationMs: runDurationMs, ...outcome })
  }

  if (difficulty === null || paragraph === null) {
    const storage = getBrowserLocalStorage()
    const bests = storage ? DIFFICULTIES.map((d) => getPersonalBest(storage, d)) : DIFFICULTIES.map(() => null)

    return (
      <div className="difficulty-picker-wrap">
        <p className="section-note">No stakes here — just you against the clock.</p>
        <div className="difficulty-picker">
          {DIFFICULTIES.map((d, i) => (
            <button
              key={d}
              type="button"
              className={`btn-difficulty btn-difficulty-${d}`}
              onClick={() => selectDifficulty(d)}
            >
              <span className="btn-difficulty-icon">{DIFFICULTY_ICONS[d]}</span>
              <span className="btn-difficulty-label">{DIFFICULTY_LABELS[d]}</span>
              <span className="btn-difficulty-stake">{bests[i] !== null ? `PB ${formatMs(bests[i])}` : 'No PB yet'}</span>
            </button>
          ))}
        </div>
      </div>
    )
  }

  if (result !== null) {
    return (
      <>
        <p className="section-note">{formatMs(result.durationMs)} — {DIFFICULTY_LABELS[difficulty]}</p>
        <p className={result.isNewBest ? 'section-note section-note-best' : 'section-note'}>
          {result.isNewBest ? 'New personal best!' : `Personal best: ${formatMs(result.best)}`}
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

  return <TypingEngine paragraph={paragraph} onSubmit={(run) => handleSubmit(getRunDurationMs(run))} />
}
