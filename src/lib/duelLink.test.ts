import assert from 'node:assert/strict'
import { test } from 'node:test'
import { parseDuelEntryId } from './duelLink.ts'

const ENTRY_ID = 'd103affd-b209-4df4-95d2-07a270c85ed5'

test('parseDuelEntryId reads the duel code out of a full pasted link', () => {
  assert.equal(parseDuelEntryId(`http://192.168.43.10:5173/?duel=${ENTRY_ID}`), ENTRY_ID)
})

test('parseDuelEntryId accepts just the bare code', () => {
  assert.equal(parseDuelEntryId(ENTRY_ID), ENTRY_ID)
})

test('parseDuelEntryId accepts a bare query string, with or without the leading ?', () => {
  assert.equal(parseDuelEntryId(`?duel=${ENTRY_ID}`), ENTRY_ID)
  assert.equal(parseDuelEntryId(`duel=${ENTRY_ID}`), ENTRY_ID)
})

test('parseDuelEntryId trims surrounding whitespace', () => {
  assert.equal(parseDuelEntryId(`  ${ENTRY_ID}  `), ENTRY_ID)
})

test('parseDuelEntryId returns null for an empty paste', () => {
  assert.equal(parseDuelEntryId(''), null)
  assert.equal(parseDuelEntryId('   '), null)
})

test('parseDuelEntryId returns null for a full link with no duel param', () => {
  assert.equal(parseDuelEntryId('http://192.168.43.10:5173/'), null)
})

