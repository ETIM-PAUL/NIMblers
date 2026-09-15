import assert from 'node:assert/strict'
import { test } from 'node:test'
import { getPersonalBest, recordResult } from './personalBest.ts'
import type { StorageLike } from './personalBest.ts'

function fakeStorage(): StorageLike {
  const data = new Map<string, string>()
  return {
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => {
      data.set(key, value)
    },
  }
}

test('getPersonalBest is null when nothing has been recorded', () => {
  assert.equal(getPersonalBest(fakeStorage(), 'easy'), null)
})

test('recordResult stores the first result as the best', () => {
  const storage = fakeStorage()
  const outcome = recordResult(storage, 'easy', 5000)
  assert.deepEqual(outcome, { best: 5000, isNewBest: true })
  assert.equal(getPersonalBest(storage, 'easy'), 5000)
})

test('recordResult keeps the faster (lower) time as the best', () => {
  const storage = fakeStorage()
  recordResult(storage, 'medium', 4000)

  const slower = recordResult(storage, 'medium', 4500)
  assert.deepEqual(slower, { best: 4000, isNewBest: false })
  assert.equal(getPersonalBest(storage, 'medium'), 4000)

  const faster = recordResult(storage, 'medium', 3200)
  assert.deepEqual(faster, { best: 3200, isNewBest: true })
  assert.equal(getPersonalBest(storage, 'medium'), 3200)
})

test('best times are tracked independently per difficulty', () => {
  const storage = fakeStorage()
  recordResult(storage, 'easy', 2000)
  recordResult(storage, 'hard', 9000)

  assert.equal(getPersonalBest(storage, 'easy'), 2000)
  assert.equal(getPersonalBest(storage, 'hard'), 9000)
  assert.equal(getPersonalBest(storage, 'medium'), null)
})

test('a corrupted stored value degrades to no personal best rather than throwing', () => {
  const storage: StorageLike = { getItem: () => 'not-json{{{', setItem: () => {} }
  assert.equal(getPersonalBest(storage, 'easy'), null)
})

test('a storage that throws on write does not crash recordResult', () => {
  const storage: StorageLike = {
    getItem: () => null,
    setItem: () => {
      throw new Error('quota exceeded')
    },
  }
  assert.doesNotThrow(() => recordResult(storage, 'easy', 1000))
})
