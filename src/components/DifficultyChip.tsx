import type { Difficulty } from '../lib/api'
import { DIFFICULTY_LABELS } from '../lib/api'

/** A small colored pill matching each tier's card color (see .btn-difficulty-* in index.css) — used anywhere a difficulty shows up in a list row instead of plain text. */
export function DifficultyChip({ difficulty }: { difficulty: Difficulty }) {
  return <span className={`difficulty-chip difficulty-chip-${difficulty}`}>{DIFFICULTY_LABELS[difficulty]}</span>
}
