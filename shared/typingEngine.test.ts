import assert from 'node:assert/strict'
import { test } from 'node:test'
import { applyKeydown, computeCharStates, isExactMatch } from './typingEngine.ts'

test('computeCharStates marks typed-correct, typed-incorrect, caret, and pending', () => {
  const states = computeCharStates('cat', 'cx')
  assert.deepEqual(states, ['correct', 'incorrect', 'caret'])
})

test('computeCharStates puts the caret right after the last typed character', () => {
  assert.deepEqual(computeCharStates('cat', ''), ['caret', 'pending', 'pending'])
  assert.deepEqual(computeCharStates('cat', 'cat'), ['correct', 'correct', 'correct'])
})

test('isExactMatch requires full-length identical strings', () => {
  assert.equal(isExactMatch('cat', 'cat'), true)
  assert.equal(isExactMatch('cat', 'ca'), false)
  assert.equal(isExactMatch('cat', 'cats'), false)
  assert.equal(isExactMatch('cat', 'cot'), false)
})

test('applyKeydown appends printable characters up to the target length', () => {
  let typed = ''
  typed = applyKeydown('hi', typed, 'h')
  assert.equal(typed, 'h')
  typed = applyKeydown('hi', typed, 'i')
  assert.equal(typed, 'hi')
  // already at target length — further printable keys are ignored
  typed = applyKeydown('hi', typed, 'x')
  assert.equal(typed, 'hi')
})

test('applyKeydown handles backspace, including on an empty string', () => {
  assert.equal(applyKeydown('hi', 'h', 'Backspace'), '')
  assert.equal(applyKeydown('hi', '', 'Backspace'), '')
})

test('applyKeydown ignores non-printable keys', () => {
  assert.equal(applyKeydown('hi', 'h', 'Shift'), 'h')
  assert.equal(applyKeydown('hi', 'h', 'ArrowLeft'), 'h')
  assert.equal(applyKeydown('hi', 'h', 'Enter'), 'h')
})
