import assert from 'node:assert/strict'
import { test } from 'node:test'
import { errorMessage } from './api.ts'

test('errorMessage extracts the message from a real Error', () => {
  assert.equal(errorMessage(new Error('boom')), 'boom')
})

test('errorMessage extracts .message from a plain object instead of stringifying it to "[object Object]"', () => {
  // What a real Error would look like once it crosses a postMessage bridge
  // (like the Nimiq Pay provider's) and loses its prototype.
  assert.equal(errorMessage({ message: 'rejected by user' }), 'rejected by user')
})

test('errorMessage extracts a nested error.message — the provider\'s own ErrorResponse shape', () => {
  assert.equal(errorMessage({ error: { type: 'REJECTED', message: 'user declined the transaction' } }), 'user declined the transaction')
})

test('errorMessage falls back to JSON for an object with no usable message, never "[object Object]"', () => {
  const result = errorMessage({ code: 'TIMEOUT' })
  assert.notEqual(result, '[object Object]')
  assert.equal(result, '{"code":"TIMEOUT"}')
})

test('errorMessage handles primitives', () => {
  assert.equal(errorMessage('a plain string'), 'a plain string')
  assert.equal(errorMessage(404), '404')
  assert.equal(errorMessage(null), 'null')
  assert.equal(errorMessage(undefined), 'undefined')
})
