import assert from 'node:assert/strict'
import { test } from 'node:test'
import { GROUP_HOUSE_RAKE, paidPlaces, splitGroupPot } from './stateMachine.ts'

test('paidPlaces is the top half rounded up', () => {
  assert.equal(paidPlaces(10), 5)
  assert.equal(paidPlaces(5), 3)
  assert.equal(paidPlaces(4), 2)
  assert.equal(paidPlaces(3), 2)
  assert.equal(paidPlaces(2), 1)
  assert.equal(paidPlaces(1), 1)
})

test('splitGroupPot pays only the top paidPlaces finishers, weighted by rank', () => {
  const finishers = ['a', 'b', 'c', 'd', 'e']
  const result = splitGroupPot(1_000_000, finishers)

  assert.deepEqual(result.map((r) => r.userId), finishers)
  assert.deepEqual(result.map((r) => r.rank), [1, 2, 3, 4, 5])
  // paidPlaces(5) === 3: ranks 4 and 5 get nothing.
  assert.equal(result[3].amountLuna, 0)
  assert.equal(result[4].amountLuna, 0)
  // Strictly decreasing among the paid places.
  assert.ok(result[0].amountLuna > result[1].amountLuna)
  assert.ok(result[1].amountLuna > result[2].amountLuna)
})

test('splitGroupPot amounts always sum to exactly the raked pot, no Luna lost to rounding', () => {
  for (const finisherCount of [1, 2, 3, 4, 5, 6, 7, 9, 10, 11, 23]) {
    for (const pot of [100_000, 333_333, 1, 999_999_999]) {
      const finishers = Array.from({ length: finisherCount }, (_, i) => `user-${i}`)
      const result = splitGroupPot(pot, finishers)
      const total = result.reduce((sum, r) => sum + r.amountLuna, 0)
      const expected = Math.round(pot * (1 - GROUP_HOUSE_RAKE))
      assert.equal(total, expected, `finisherCount=${finisherCount} pot=${pot}`)
    }
  }
})

test('a single finisher takes the whole raked pot', () => {
  const result = splitGroupPot(500_000, ['only-finisher'])
  assert.equal(result.length, 1)
  assert.equal(result[0].amountLuna, Math.round(500_000 * (1 - GROUP_HOUSE_RAKE)))
})

test('splitGroupPot rejects zero finishers', () => {
  assert.throws(() => splitGroupPot(100_000, []))
})
