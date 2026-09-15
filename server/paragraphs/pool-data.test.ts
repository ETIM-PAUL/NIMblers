import assert from 'node:assert/strict'
import { test } from 'node:test'
import { PARAGRAPH_POOL } from './pool-data.ts'

// Letters, digits, space, and punctuation available on a basic phone
// keyboard's default layout without a special/extended symbol page.
// Deliberately excludes typographic characters a phone keyboard doesn't
// have a direct key for — em/en dashes, curly quotes, ellipsis glyphs —
// which are easy to introduce by pasting "nicely typeset" prose.
const BASIC_KEYBOARD_CHARS = /^[A-Za-z0-9 .,'"!?()%:;/@&-]*$/

test('every paragraph in the pool only uses characters on a basic phone keyboard', () => {
  for (const paragraph of PARAGRAPH_POOL) {
    assert.match(
      paragraph.body,
      BASIC_KEYBOARD_CHARS,
      `${paragraph.id} contains a character not on a basic phone keyboard: ${JSON.stringify(paragraph.body)}`,
    )
  }
})
