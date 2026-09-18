import assert from 'node:assert/strict'
import { beforeEach, test } from 'node:test'
import type { Db } from '../db/client.ts'
import { closeDb, getDb } from '../db/client.ts'
import { migrateUp } from '../db/migrate.ts'
import { getOrGenerateParagraphForStake } from './repository.ts'

process.env.DB_PATH = ':memory:'

let db: Db

beforeEach(async () => {
  closeDb()
  await migrateUp()
  db = await getDb()
})

test('getOrGenerateParagraphForStake generates and persists a fresh paragraph for a new stake', async () => {
  const paragraph = await getOrGenerateParagraphForStake(db, 'tx-1', 'easy')
  assert.ok(paragraph.id)
  assert.ok(paragraph.body.length > 0)
  assert.equal(paragraph.difficulty, 'easy')

  const row = (await db.execute({ sql: 'SELECT reveal_stake_tx_hash FROM paragraphs WHERE id = ?', args: [paragraph.id] }))
    .rows[0] as unknown as { reveal_stake_tx_hash: string } | undefined
  assert.equal(row?.reveal_stake_tx_hash, 'tx-1')
})

test('getOrGenerateParagraphForStake is idempotent — the same stake always gets back the same paragraph, not a new one', async () => {
  const first = await getOrGenerateParagraphForStake(db, 'tx-1', 'easy')
  const second = await getOrGenerateParagraphForStake(db, 'tx-1', 'easy')
  assert.deepEqual(first, second)

  const count = (await db.execute({ sql: 'SELECT COUNT(*) c FROM paragraphs WHERE reveal_stake_tx_hash = ?', args: ['tx-1'] }))
    .rows[0] as unknown as { c: number }
  assert.equal(count.c, 1, 'a retry must not insert a second row')
})

test('different stakes get different paragraphs', async () => {
  const first = await getOrGenerateParagraphForStake(db, 'tx-1', 'easy')
  const second = await getOrGenerateParagraphForStake(db, 'tx-2', 'easy')
  assert.notEqual(first.id, second.id)
})
