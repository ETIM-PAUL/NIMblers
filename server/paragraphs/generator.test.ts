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

test('Nimiq/typing-duel branded vocabulary shows up often enough to give the content its own identity', () => {
  const BRANDED_SAMPLE = [
    'wallet', 'ledger', 'escrow', 'signer', 'keypair', 'address', 'duelist', 'stake', 'nimiq',
    'testnet', 'mainnet', 'keystroke', 'paragraph', 'opponent', 'rematch', 'custodian', 'validator',
    'consensus', 'mempool', 'signature', 'blockchain', 'transaction', 'leaderboard', 'challenger',
    'custodial', 'trustless', 'immutable', 'ephemeral', 'verifiable', 'unguessable', 'unstoppable',
    'instantly', 'securely', 'provably', 'verifiably', 'atomically', 'immutably', 'irrevocably',
  ]
  const corpus = Array.from({ length: 60 }, () => generateParagraph('medium')).join(' ').toLowerCase()
  const hits = BRANDED_SAMPLE.filter((word) => corpus.includes(word))
  assert.ok(hits.length > 3, `expected several branded words across 60 draws, found: ${hits.join(', ') || '(none)'}`)
})

test('a branded verb never gets a naive "s" tacked on — "verifies" not "verifys", "rematches" not "rematchs"', () => {
  const corpus = Array.from({ length: 80 }, () => generateParagraph('easy').toLowerCase())
    .concat(Array.from({ length: 80 }, () => generateParagraph('medium').toLowerCase()))
    .join(' ')
  for (const broken of ['verifys', 'rematchs', 'vanishs']) {
    assert.ok(!corpus.includes(broken), `found a broken suffix "${broken}" in generated output`)
  }
})
