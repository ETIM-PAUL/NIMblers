import type { DatabaseSync } from 'node:sqlite'
import type { ParagraphRow } from '../db/types.ts'
import type { Paragraph } from './service.ts'
import { getDailyParagraph, getPracticeParagraph } from './service.ts'

export function listParagraphs(db: DatabaseSync): Paragraph[] {
  const rows = db.prepare('SELECT id, body, difficulty FROM paragraphs ORDER BY id').all() as Pick<
    ParagraphRow,
    'id' | 'body' | 'difficulty'
  >[]
  return rows
}

export function getDailyParagraphForToday(db: DatabaseSync, date: Date = new Date()): Paragraph {
  return getDailyParagraph(listParagraphs(db), date)
}

export function getPracticeParagraphForToday(db: DatabaseSync, date: Date = new Date()): Paragraph {
  return getPracticeParagraph(listParagraphs(db), date)
}
