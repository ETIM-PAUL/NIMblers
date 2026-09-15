import type { DatabaseSync } from 'node:sqlite'
import type { Difficulty, ParagraphRow } from '../db/types.ts'
import type { Paragraph } from './service.ts'
import { getAllDailyParagraphs, getDailyParagraph, getPracticeParagraph } from './service.ts'

export function listParagraphs(db: DatabaseSync): Paragraph[] {
  const rows = db.prepare('SELECT id, body, difficulty FROM paragraphs ORDER BY id').all() as Pick<
    ParagraphRow,
    'id' | 'body' | 'difficulty'
  >[]
  return rows
}

export function getDailyParagraphForToday(db: DatabaseSync, difficulty: Difficulty, date: Date = new Date()): Paragraph {
  return getDailyParagraph(listParagraphs(db), date, difficulty)
}

export function getAllDailyParagraphsForToday(db: DatabaseSync, date: Date = new Date()): Record<Difficulty, Paragraph> {
  return getAllDailyParagraphs(listParagraphs(db), date)
}

export function getPracticeParagraphForToday(
  db: DatabaseSync,
  date: Date = new Date(),
  difficulty?: Difficulty,
): Paragraph {
  return getPracticeParagraph(listParagraphs(db), date, Math.random, difficulty)
}
