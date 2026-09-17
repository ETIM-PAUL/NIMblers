import assert from 'node:assert/strict'
import { beforeEach, test } from 'node:test'
import type { DatabaseSync } from 'node:sqlite'
import { closeDb, getDb } from '../db/client.ts'
import { migrateUp } from '../db/migrate.ts'
import { getOrGenerateParagraphForStake } from './repository.ts'

process.env.DB_PATH = ':memory:'

let db: DatabaseSync

beforeEach(() => {
  closeDb()
  migrateUp()
  db = getDb()
})

test('getOrGenerateParagraphForStake generates and persists a fresh paragraph for a new stake', () => {
  const paragraph = getOrGenerateParagraphForStake(db, 'tx-1', 'easy')
  assert.ok(paragraph.id)
  assert.ok(paragraph.body.length > 0)
  assert.equal(paragraph.difficulty, 'easy')

  const row = db.prepare('SELECT reveal_stake_tx_hash FROM paragraphs WHERE id = ?').get(paragraph.id) as
    | { reveal_stake_tx_hash: string }
    | undefined
  assert.equal(row?.reveal_stake_tx_hash, 'tx-1')
})

test('getOrGenerateParagraphForStake is idempotent — the same stake always gets back the same paragraph, not a new one', () => {
  const first = getOrGenerateParagraphForStake(db, 'tx-1', 'easy')
  const second = getOrGenerateParagraphForStake(db, 'tx-1', 'easy')
  assert.deepEqual(first, second)

  const count = db.prepare('SELECT COUNT(*) c FROM paragraphs WHERE reveal_stake_tx_hash = ?').get('tx-1') as { c: number }
  assert.equal(count.c, 1, 'a retry must not insert a second row')
})

test('different stakes get different paragraphs', () => {
  const first = getOrGenerateParagraphForStake(db, 'tx-1', 'easy')
  const second = getOrGenerateParagraphForStake(db, 'tx-2', 'easy')
  assert.notEqual(first.id, second.id)
})
