import assert from 'node:assert/strict'
import { test } from 'node:test'
import { parseGroupDuelCode } from './groupDuelLink.ts'

const CODE = 'K2485Z'

test('parseGroupDuelCode reads the code out of a full pasted link', () => {
  assert.equal(parseGroupDuelCode(`http://192.168.43.10:5173/?groupDuel=${CODE}`), CODE)
})

test('parseGroupDuelCode accepts just the bare code, uppercasing it', () => {
  assert.equal(parseGroupDuelCode(CODE.toLowerCase()), CODE)
})

test('parseGroupDuelCode accepts a bare query string, with or without the leading ?', () => {
  assert.equal(parseGroupDuelCode(`?groupDuel=${CODE}`), CODE)
  assert.equal(parseGroupDuelCode(`groupDuel=${CODE}`), CODE)
})

test('parseGroupDuelCode trims surrounding whitespace', () => {
  assert.equal(parseGroupDuelCode(`  ${CODE}  `), CODE)
})

test('parseGroupDuelCode returns null for an empty paste', () => {
  assert.equal(parseGroupDuelCode(''), null)
  assert.equal(parseGroupDuelCode('   '), null)
})

test('parseGroupDuelCode returns null for a full link with no groupDuel param', () => {
  assert.equal(parseGroupDuelCode('http://192.168.43.10:5173/'), null)
})
