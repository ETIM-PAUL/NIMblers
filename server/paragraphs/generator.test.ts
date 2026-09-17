import assert from 'node:assert/strict'
import { test } from 'node:test'
import { generateParagraph } from './generator.ts'

const DIFFICULTIES = ['easy', 'medium', 'hard'] as const

test('generateParagraph returns a non-empty, properly punctuated sentence for every tier', () => {
  for (const difficulty of DIFFICULTIES) {
    const body = generateParagraph(difficulty)
    assert.ok(body.length > 0, `${difficulty} paragraph should not be empty`)
    // A capital letter, or a digit — some hard-tier templates open with a number (e.g. "75 neighboring comestibles...").
    assert.match(body, /^[A-Z0-9]/, `${difficulty} paragraph should start with a capital letter or digit: "${body}"`)
    assert.match(body, /[.!?]$/, `${difficulty} paragraph should end with punctuation: "${body}"`)
  }
})

test('generateParagraph produces different text across calls — nothing is guessable from a single sample', () => {
  const samples = new Set(Array.from({ length: 20 }, () => generateParagraph('easy')))
  // Extremely unlikely to collide even a handful of times out of 20 draws
  // given the word-bank combinatorics — a near-total collapse to one or
  // two values would mean the generator isn't actually varying output.
  assert.ok(samples.size > 10, `expected mostly-unique output across 20 draws, got ${samples.size} unique values`)
})

test('harder tiers use longer words on average than easier ones', () => {
  function avgWordLength(difficulty: (typeof DIFFICULTIES)[number]): number {
    const samples = Array.from({ length: 30 }, () => generateParagraph(difficulty))
    const words = samples.join(' ').replace(/[.,;!?']/g, '').split(/\s+/).filter(Boolean)
    return words.reduce((sum, w) => sum + w.length, 0) / words.length
  }

  const easyAvg = avgWordLength('easy')
  const mediumAvg = avgWordLength('medium')
  const hardAvg = avgWordLength('hard')

  assert.ok(easyAvg < mediumAvg, `easy avg word length (${easyAvg.toFixed(2)}) should be shorter than medium's (${mediumAvg.toFixed(2)})`)
  assert.ok(mediumAvg < hardAvg, `medium avg word length (${mediumAvg.toFixed(2)}) should be shorter than hard's (${hardAvg.toFixed(2)})`)
})

test('only ASCII-typeable characters ever appear — nothing that would be impossible to type on a standard keyboard', () => {
  for (const difficulty of DIFFICULTIES) {
    for (let i = 0; i < 10; i++) {
      const body = generateParagraph(difficulty)
      assert.match(body, /^[\x20-\x7E]+$/, `${difficulty} paragraph has a non-typeable character: "${body}"`)
    }
  }
})
