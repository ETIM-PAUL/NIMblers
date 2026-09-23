import type { Language } from '../lib/api'
import { LANGUAGE_LABELS } from '../lib/api'

/** A small pill for a duel's language — shown next to DifficultyChip anywhere an entry shows up in a list row. English is the common case and stays unlabeled to keep the list uncluttered. */
export function LanguageChip({ language }: { language: Language }) {
  if (language === 'en') return null
  return <span className="language-chip">{LANGUAGE_LABELS[language]}</span>
}
