import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { beforeEach, test } from 'node:test'
import type { DatabaseSync } from 'node:sqlite'
import { closeDb, getDb } from '../db/client.ts'
import { migrateUp } from '../db/migrate.ts'
import { getOrCreateUser } from '../db/users.ts'
import { challengeEntry, declineRetry, getEntryForChallenge, listMyDuelHistory, listMyEntries, listOpenEntries, retryStake, retrySubmit, submitChallenge } from './service.ts'
import type { HouseWallet, HouseWalletTransaction } from '../../services/escrow.ts'

process.env.DB_PATH = ':memory:'

const HOUSE_ADDRESS = 'NQ07 HOUS EAAA AAAA AAAA AAAA AAAA AAAA AAAA'
const CREATOR_ADDRESS = 'NQ07 CREA TORA AAAA AAAA AAAA AAAA AAAA AAAA'
const CHALLENGER_ADDRESS = 'NQ07 CHAL LENG ERAA AAAA AAAA AAAA AAAA AAAA'
const OTHER_CHALLENGER_ADDRESS = 'NQ07 OTHE RCHA LLEN GERA AAAA AAAA AAAA AAAA'
const TARGET = 'hi there'
const PARAGRAPH_ID = 'test-paragraph'
const STAKE_LUNA = 100_000

function honestEventsFor(target: string): { key: string, tRelativeMs: number, resultingLength: number }[] {
  return target.split('').map((char, i) => ({ key: char, tRelativeMs: i * 100, resultingLength: i + 1 }))
}

/** Slower than the creator's seeded 5000ms run — the challenger loses. */
function slowEventsFor(target: string): { key: string, tRelativeMs: number, resultingLength: number }[] {
  return target.split('').map((char, i) => ({ key: char, tRelativeMs: i * 800, resultingLength: i + 1 }))
}

/** A wallet whose `send()` throws — for tests that must never reach settlement's payout/refund step. */
function fakeWallet(): HouseWallet {
  return {
    address: HOUSE_ADDRESS,
    async getBalance() { return 5_000_000 },
    async send() { throw new Error('should not send in this test') },
    async getTransaction(txHash): Promise<HouseWalletTransaction | null> {
      if (txHash === 'bad-tx') return null
      return {
        txHash,
        senderAddress: txHash.includes('challenger2') ? OTHER_CHALLENGER_ADDRESS : CHALLENGER_ADDRESS,
        recipientAddress: HOUSE_ADDRESS,
        valueLuna: STAKE_LUNA,
        state: 'confirmed',
        confirmations: 5,
      }
    },
    async close() {},
  }
}

/** A wallet that actually "sends" (fake tx hashes), for tests that settle a duel. */
function fakeSettlingWallet(): HouseWallet {
  let sendCount = 0
  return {
    ...fakeWallet(),
    async send(recipientAddress, valueLuna) {
      sendCount += 1
      return {
        txHash: `settlement-tx-${sendCount}`,
        senderAddress: HOUSE_ADDRESS,
        recipientAddress,
        valueLuna,
        state: 'confirmed',
        confirmations: 5,
      }
    },
  }
}

let db: DatabaseSync
let entryId: string

beforeEach(() => {
  closeDb()
  migrateUp()
  db = getDb()
  const now = new Date().toISOString()
  db.prepare('INSERT INTO paragraphs (id, body, difficulty, created_at) VALUES (?, ?, ?, ?)').run(
    PARAGRAPH_ID,
    TARGET,
    'easy',
    now,
  )

  const creatorId = getOrCreateUser(db, CREATOR_ADDRESS)
  const runId = randomUUID()
  db.prepare(
    'INSERT INTO keystroke_runs (id, user_id, paragraph_id, events, duration_ms, created_at) VALUES (?, ?, ?, ?, ?, ?)',
  ).run(runId, creatorId, PARAGRAPH_ID, '[]', 5000, now)

  entryId = randomUUID()
  const expiresAt = new Date(Date.now() + 24 * 60 * 60_000).toISOString()
  db.prepare(
    `INSERT INTO entries (id, creator_user_id, paragraph_id, keystroke_run_id, stake_luna, status, created_at, expires_at, stake_tx_hash)
     VALUES (?, ?, ?, ?, ?, 'OPEN', ?, ?, ?)`,
  ).run(entryId, creatorId, PARAGRAPH_ID, runId, STAKE_LUNA, now, expiresAt, 'creator-stake-tx')
})

test('listOpenEntries returns opponent address, stake, and age — no time', () => {
  const list = listOpenEntries(db)
  assert.equal(list.length, 1)
  assert.equal(list[0].entryId, entryId)
  assert.equal(list[0].creatorAddress, CREATOR_ADDRESS)
  assert.equal(list[0].stakeLuna, STAKE_LUNA)
  assert.ok(list[0].createdAt)
  const keys = Object.keys(list[0]).join(',').toLowerCase()
  assert.ok(!keys.includes('duration'), `listing leaked timing info: ${keys}`)
})

test('listOpenEntries excludes the caller\'s own entries', () => {
  const list = listOpenEntries(db, CREATOR_ADDRESS)
  assert.equal(list.length, 0)
})

test('listOpenEntries excludes entries that are no longer OPEN', () => {
  db.prepare("UPDATE entries SET status = 'LOCKED' WHERE id = ?").run(entryId)
  assert.equal(listOpenEntries(db).length, 0)
})

test('listOpenEntries excludes entries past their 24h window', () => {
  db.prepare('UPDATE entries SET expires_at = ? WHERE id = ?').run(new Date(Date.now() - 1000).toISOString(), entryId)
  assert.equal(listOpenEntries(db).length, 0)
})

test('listOpenEntries excludes PRIVATE entries — they are only reachable by their link', () => {
  db.prepare("UPDATE entries SET visibility = 'PRIVATE' WHERE id = ?").run(entryId)
  assert.equal(listOpenEntries(db).length, 0)
})

test('getEntryForChallenge finds a PRIVATE entry by id even though it is hidden from the dashboard', () => {
  db.prepare("UPDATE entries SET visibility = 'PRIVATE' WHERE id = ?").run(entryId)

  assert.equal(listOpenEntries(db).length, 0, 'sanity check: still not listed')

  const result = getEntryForChallenge(db, entryId)
  assert.equal(result.ok, true)
  if (!result.ok) return
  assert.equal(result.entry.entryId, entryId)
  assert.equal(result.entry.creatorAddress, CREATOR_ADDRESS)
  assert.equal(result.entry.visibility, 'PRIVATE')
})

test('getEntryForChallenge finds a PUBLIC entry too — the lookup works regardless of visibility', () => {
  const result = getEntryForChallenge(db, entryId)
  assert.equal(result.ok, true)
  if (!result.ok) return
  assert.equal(result.entry.visibility, 'PUBLIC')
})

test('getEntryForChallenge rejects an unknown id', () => {
  const result = getEntryForChallenge(db, 'does-not-exist')
  assert.equal(result.ok, false)
})

test('getEntryForChallenge rejects the creator looking up their own entry', () => {
  const result = getEntryForChallenge(db, entryId, CREATOR_ADDRESS)
  assert.equal(result.ok, false)
})

test('getEntryForChallenge rejects an entry that is no longer OPEN', () => {
  db.prepare("UPDATE entries SET status = 'LOCKED' WHERE id = ?").run(entryId)
  const result = getEntryForChallenge(db, entryId)
  assert.equal(result.ok, false)
})

test('getEntryForChallenge rejects an entry past its 24h window', () => {
  db.prepare('UPDATE entries SET expires_at = ? WHERE id = ?').run(new Date(Date.now() - 1000).toISOString(), entryId)
  const result = getEntryForChallenge(db, entryId)
  assert.equal(result.ok, false)
})

test('listMyEntries returns the creator\'s own entry, regardless of visibility', () => {
  db.prepare("UPDATE entries SET visibility = 'PRIVATE' WHERE id = ?").run(entryId)
  const mine = listMyEntries(db, CREATOR_ADDRESS)
  assert.equal(mine.length, 1)
  assert.equal(mine[0].entryId, entryId)
  assert.equal(mine[0].status, 'OPEN')
  assert.equal(mine[0].visibility, 'PRIVATE')
  assert.equal(mine[0].challengerAddress, null)
  assert.equal(mine[0].outcome, null)
})

test('listMyEntries returns nothing for someone who has not created any entries', () => {
  assert.deepEqual(listMyEntries(db, CHALLENGER_ADDRESS), [])
})

test('listMyEntries shows the challenger once the entry is locked, before settlement', async () => {
  await challengeEntry(db, fakeWallet(), { entryId, nimAddress: CHALLENGER_ADDRESS, stakeTxHash: 'challenger-tx' })
  const mine = listMyEntries(db, CREATOR_ADDRESS)
  assert.equal(mine[0].status, 'LOCKED')
  assert.equal(mine[0].challengerAddress, CHALLENGER_ADDRESS)
  assert.equal(mine[0].outcome, null, 'not settled yet')
})

test('listMyEntries reports the outcome from the creator\'s perspective once settled', async () => {
  const wallet = fakeSettlingWallet()
  await challengeEntry(db, wallet, { entryId, nimAddress: CHALLENGER_ADDRESS, stakeTxHash: 'challenger-tx' })
  // The challenger's slower run loses — the creator (seeded at 5000ms) wins.
  await submitChallenge(db, wallet, { entryId, nimAddress: CHALLENGER_ADDRESS, events: slowEventsFor(TARGET) })

  const mine = listMyEntries(db, CREATOR_ADDRESS)
  assert.equal(mine[0].status, 'SETTLED')
  assert.equal(mine[0].outcome, 'creator')
})

test('a PRIVATE entry can still be challenged and settled through the normal flow', async () => {
  db.prepare("UPDATE entries SET visibility = 'PRIVATE' WHERE id = ?").run(entryId)
  const wallet = fakeSettlingWallet()

  const challengeResult = await challengeEntry(db, wallet, {
    entryId,
    nimAddress: CHALLENGER_ADDRESS,
    stakeTxHash: 'private-challenge-tx',
  })
  assert.equal(challengeResult.ok, true)

  const submitResult = await submitChallenge(db, wallet, { entryId, nimAddress: CHALLENGER_ADDRESS, events: honestEventsFor(TARGET) })
  assert.equal(submitResult.ok, true)
})

test('challengeEntry locks the entry, takes the stake, and reveals the paragraph', async () => {
  const wallet = fakeWallet()
  const result = await challengeEntry(db, wallet, {
    entryId,
    nimAddress: CHALLENGER_ADDRESS,
    stakeTxHash: 'challenger-stake-tx',
  })

  assert.equal(result.ok, true)
  if (!result.ok) return
  assert.equal(result.paragraphId, PARAGRAPH_ID)
  assert.equal(result.paragraphBody, TARGET)

  const entry = db.prepare('SELECT status FROM entries WHERE id = ?').get(entryId) as { status: string }
  assert.equal(entry.status, 'LOCKED')

  const duel = db.prepare('SELECT * FROM duels WHERE entry_id = ?').get(entryId) as { challenger_user_id: string }
  assert.ok(duel)
  const challengerId = getOrCreateUser(db, CHALLENGER_ADDRESS)
  assert.equal(duel.challenger_user_id, challengerId)
})

test('challengeEntry requires matching this specific entry\'s stake, not a fixed global amount', async () => {
  // A pricier ("hard") entry, staked at 500,000 Luna instead of this
  // file's 100,000-Luna default.
  const creatorId = getOrCreateUser(db, CREATOR_ADDRESS)
  const pricierEntryId = randomUUID()
  const runId = randomUUID()
  const now = new Date().toISOString()
  db.prepare(
    'INSERT INTO keystroke_runs (id, user_id, paragraph_id, events, duration_ms, created_at) VALUES (?, ?, ?, ?, ?, ?)',
  ).run(runId, creatorId, PARAGRAPH_ID, '[]', 5000, now)
  db.prepare(
    `INSERT INTO entries (id, creator_user_id, paragraph_id, keystroke_run_id, stake_luna, status, created_at, expires_at, stake_tx_hash)
     VALUES (?, ?, ?, ?, ?, 'OPEN', ?, ?, ?)`,
  ).run(pricierEntryId, creatorId, PARAGRAPH_ID, runId, 500_000, now, new Date(Date.now() + 86_400_000).toISOString(), 'pricier-stake-tx')

  const wallet = fakeWallet() // always reports a 100,000-Luna transaction
  const result = await challengeEntry(db, wallet, {
    entryId: pricierEntryId,
    nimAddress: CHALLENGER_ADDRESS,
    stakeTxHash: 'challenger-underpay-tx',
  })

  assert.equal(result.ok, false, 'a 100,000-Luna stake must not be accepted for a 500,000-Luna entry')
  const entry = db.prepare('SELECT status FROM entries WHERE id = ?').get(pricierEntryId) as { status: string }
  assert.equal(entry.status, 'OPEN', 'the lock must be released after the mismatched stake is rejected')
})

test('challengeEntry rejects challenging your own entry', async () => {
  const wallet = fakeWallet()
  const result = await challengeEntry(db, wallet, {
    entryId,
    nimAddress: CREATOR_ADDRESS,
    stakeTxHash: 'self-challenge-tx',
  })
  assert.equal(result.ok, false)

  const entry = db.prepare('SELECT status FROM entries WHERE id = ?').get(entryId) as { status: string }
  assert.equal(entry.status, 'OPEN', 'an entry must stay OPEN after a rejected self-challenge')
})

test('challengeEntry rejects an unknown entry', async () => {
  const wallet = fakeWallet()
  const result = await challengeEntry(db, wallet, {
    entryId: 'does-not-exist',
    nimAddress: CHALLENGER_ADDRESS,
    stakeTxHash: 'whatever',
  })
  assert.equal(result.ok, false)
})

test('two simultaneous challenge requests on the same entry produce one lock and one clean rejection', async () => {
  const wallet = fakeWallet()

  const [first, second] = await Promise.all([
    challengeEntry(db, wallet, { entryId, nimAddress: CHALLENGER_ADDRESS, stakeTxHash: 'challenger-race-tx' }),
    challengeEntry(db, wallet, { entryId, nimAddress: OTHER_CHALLENGER_ADDRESS, stakeTxHash: 'challenger2-race-tx' }),
  ])

  const outcomes = [first, second]
  const succeeded = outcomes.filter((r) => r.ok)
  const rejected = outcomes.filter((r) => !r.ok)

  assert.equal(succeeded.length, 1, 'exactly one challenger should win the lock')
  assert.equal(rejected.length, 1, 'exactly one challenger should get a clean rejection')

  const duelCount = db.prepare('SELECT COUNT(*) c FROM duels WHERE entry_id = ?').get(entryId) as { c: number }
  assert.equal(duelCount.c, 1, 'only one duel row must ever exist for this entry')

  const entry = db.prepare('SELECT status FROM entries WHERE id = ?').get(entryId) as { status: string }
  assert.equal(entry.status, 'LOCKED')
})

test('challengeEntry called twice by the same challenger is idempotent, not a race loss', async () => {
  const wallet = fakeWallet()
  const first = await challengeEntry(db, wallet, { entryId, nimAddress: CHALLENGER_ADDRESS, stakeTxHash: 'retry-tx' })
  const second = await challengeEntry(db, wallet, { entryId, nimAddress: CHALLENGER_ADDRESS, stakeTxHash: 'retry-tx' })

  assert.deepEqual(first, second)
  const duelCount = db.prepare('SELECT COUNT(*) c FROM duels WHERE entry_id = ?').get(entryId) as { c: number }
  assert.equal(duelCount.c, 1)
})

test('a failed stake releases the lock so someone else can challenge', async () => {
  const wallet = fakeWallet()
  const failed = await challengeEntry(db, wallet, { entryId, nimAddress: CHALLENGER_ADDRESS, stakeTxHash: 'bad-tx' })
  assert.equal(failed.ok, false)

  const entryAfterFailure = db.prepare('SELECT status FROM entries WHERE id = ?').get(entryId) as { status: string }
  assert.equal(entryAfterFailure.status, 'OPEN', 'the lock must be released after a failed stake')

  const retried = await challengeEntry(db, wallet, {
    entryId,
    nimAddress: OTHER_CHALLENGER_ADDRESS,
    stakeTxHash: 'challenger2-good-tx',
  })
  assert.equal(retried.ok, true)
})

async function lockEntryForChallenger(db: DatabaseSync, wallet: HouseWallet = fakeWallet()): Promise<void> {
  const result = await challengeEntry(db, wallet, {
    entryId,
    nimAddress: CHALLENGER_ADDRESS,
    stakeTxHash: 'submit-test-stake-tx',
  })
  assert.equal(result.ok, true)
}

// The seeded creator run in beforeEach() always records duration_ms = 5000.
// honestEventsFor() types at 100ms/char, so an 8-char target ("hi there")
// finishes in 700ms — comfortably faster than the creator, i.e. the
// challenger wins by default in these tests unless a test says otherwise.

test('submitChallenge records the challenger\'s run and settles the duel, revealing both times', async () => {
  const wallet = fakeSettlingWallet()
  await lockEntryForChallenger(db, wallet)
  const events = honestEventsFor(TARGET)
  const result = await submitChallenge(db, wallet, { entryId, nimAddress: CHALLENGER_ADDRESS, events })

  assert.equal(result.ok, true)
  if (!result.ok || result.pending) return
  assert.equal(result.outcome, 'challenger')
  assert.equal(result.creatorDurationMs, 5000)
  assert.equal(result.challengerDurationMs, 700)
  assert.equal(result.deltaMs, 4300)
  assert.equal(result.txHashes.length, 1)

  const duel = db.prepare('SELECT challenger_keystroke_run_id, winner_user_id, settled_at FROM duels WHERE entry_id = ?').get(entryId) as {
    challenger_keystroke_run_id: string | null
    winner_user_id: string | null
    settled_at: string | null
  }
  assert.ok(duel.challenger_keystroke_run_id)
  assert.ok(duel.settled_at)
  assert.equal(duel.winner_user_id, getOrCreateUser(db, CHALLENGER_ADDRESS))

  const entry = db.prepare('SELECT status FROM entries WHERE id = ?').get(entryId) as { status: string }
  assert.equal(entry.status, 'SETTLED')
})

test('submitChallenge pays the winner the pot minus the 10% rake', async () => {
  const wallet = fakeSettlingWallet()
  await lockEntryForChallenger(db, wallet)
  const result = await submitChallenge(db, wallet, { entryId, nimAddress: CHALLENGER_ADDRESS, events: honestEventsFor(TARGET) })
  assert.equal(result.ok, true)

  const winnerId = getOrCreateUser(db, CHALLENGER_ADDRESS)
  const payoutRow = db.prepare("SELECT * FROM payouts WHERE type = 'PAYOUT' AND user_id = ?").get(winnerId) as {
    amount_luna: number
    tx_hash: string | null
  }
  assert.ok(payoutRow, 'expected a PAYOUT row for the winner')
  assert.equal(payoutRow.amount_luna, Math.round(STAKE_LUNA * 2 * 0.9))
  assert.ok(payoutRow.tx_hash)
})

test('submitChallenge refunds both players in full on a tie, no rake taken', async () => {
  const wallet = fakeSettlingWallet()
  await lockEntryForChallenger(db, wallet)
  // Tie the creator's seeded 5000ms exactly by pushing the final keystroke out.
  const tieEvents = honestEventsFor(TARGET)
  tieEvents[tieEvents.length - 1] = { ...tieEvents[tieEvents.length - 1], tRelativeMs: 5000 }
  const result = await submitChallenge(db, wallet, { entryId, nimAddress: CHALLENGER_ADDRESS, events: tieEvents })

  assert.equal(result.ok, true)
  if (!result.ok || result.pending) return
  assert.equal(result.outcome, 'tie')
  assert.equal(result.creatorDurationMs, result.challengerDurationMs)
  assert.equal(result.deltaMs, 0)
  assert.equal(result.txHashes.length, 2)

  const refundRows = db.prepare("SELECT amount_luna FROM payouts WHERE type = 'REFUND'").all() as { amount_luna: number }[]
  assert.equal(refundRows.length, 2)
  for (const row of refundRows) assert.equal(row.amount_luna, STAKE_LUNA, 'a tie refund must not be raked')

  const duel = db.prepare('SELECT winner_user_id FROM duels WHERE entry_id = ?').get(entryId) as { winner_user_id: string | null }
  assert.equal(duel.winner_user_id, null)
})

// --- Double trial ---

test('submitChallenge settles immediately on a win, even when the entry allows a rematch', async () => {
  db.prepare('UPDATE entries SET allow_rematch = 1 WHERE id = ?').run(entryId)
  const wallet = fakeSettlingWallet()
  await lockEntryForChallenger(db, wallet)
  const result = await submitChallenge(db, wallet, { entryId, nimAddress: CHALLENGER_ADDRESS, events: honestEventsFor(TARGET) })

  assert.equal(result.ok, true)
  if (!result.ok) return
  assert.equal(result.pending, false)
})

test('submitChallenge settles immediately on a loss when the entry does not allow a rematch', async () => {
  const wallet = fakeSettlingWallet()
  await lockEntryForChallenger(db, wallet)
  const result = await submitChallenge(db, wallet, { entryId, nimAddress: CHALLENGER_ADDRESS, events: slowEventsFor(TARGET) })

  assert.equal(result.ok, true)
  if (!result.ok || result.pending) return
  assert.equal(result.outcome, 'creator')
})

test('submitChallenge returns a pending decision on a loss when the entry allows a rematch — A\'s time stays hidden', async () => {
  db.prepare('UPDATE entries SET allow_rematch = 1 WHERE id = ?').run(entryId)
  const wallet = fakeSettlingWallet()
  await lockEntryForChallenger(db, wallet)
  const result = await submitChallenge(db, wallet, { entryId, nimAddress: CHALLENGER_ADDRESS, events: slowEventsFor(TARGET) })

  assert.equal(result.ok, true)
  if (!result.ok) return
  assert.equal(result.pending, true)
  if (!result.pending) return
  assert.equal(result.retryStakeLuna, STAKE_LUNA * 2)
  assert.ok(result.retryDeadline)
  assert.ok(!('creatorDurationMs' in result), "A's time must not leak while a retry is still undecided")

  const duel = db.prepare('SELECT settled_at, retry_offer_expires_at FROM duels WHERE entry_id = ?').get(entryId) as {
    settled_at: string | null
    retry_offer_expires_at: string | null
  }
  assert.equal(duel.settled_at, null, 'nothing should be settled yet')
  assert.ok(duel.retry_offer_expires_at)

  const payoutCount = db.prepare("SELECT COUNT(*) c FROM payouts WHERE type IN ('PAYOUT', 'REFUND')").get() as { c: number }
  assert.equal(payoutCount.c, 0, 'no money should move until the retry is decided')
})

test('submitChallenge is idempotent for a pending decision — calling it again returns the same deadline, not a fresh one', async () => {
  db.prepare('UPDATE entries SET allow_rematch = 1 WHERE id = ?').run(entryId)
  const wallet = fakeSettlingWallet()
  await lockEntryForChallenger(db, wallet)
  const events = slowEventsFor(TARGET)
  const first = await submitChallenge(db, wallet, { entryId, nimAddress: CHALLENGER_ADDRESS, events })
  const second = await submitChallenge(db, wallet, { entryId, nimAddress: CHALLENGER_ADDRESS, events })

  assert.deepEqual(first, second, 'a retried call must not push the deadline out further')
})

test('retryStake verifies the doubled stake and rejects the un-doubled original amount', async () => {
  db.prepare('UPDATE entries SET allow_rematch = 1 WHERE id = ?').run(entryId)
  const wallet = fakeSettlingWallet()
  await lockEntryForChallenger(db, wallet)
  await submitChallenge(db, wallet, { entryId, nimAddress: CHALLENGER_ADDRESS, events: slowEventsFor(TARGET) })

  const underpaid = await retryStake(db, wallet, { entryId, nimAddress: CHALLENGER_ADDRESS, stakeTxHash: 'retry-underpay-tx' })
  assert.equal(underpaid.ok, false, 'the fake wallet reports the single stake amount here, not the doubled one')

  const walletForDoubleStake: HouseWallet = {
    ...wallet,
    async getTransaction(txHash) {
      return { txHash, senderAddress: CHALLENGER_ADDRESS, recipientAddress: HOUSE_ADDRESS, valueLuna: STAKE_LUNA * 2, state: 'confirmed', confirmations: 5 }
    },
  }
  const paid = await retryStake(db, walletForDoubleStake, { entryId, nimAddress: CHALLENGER_ADDRESS, stakeTxHash: 'retry-good-tx' })
  assert.equal(paid.ok, true)
})

test('retryStake rejects when no retry is pending for this entry', async () => {
  const wallet = fakeWallet()
  await lockEntryForChallenger(db, wallet)
  const result = await retryStake(db, wallet, { entryId, nimAddress: CHALLENGER_ADDRESS, stakeTxHash: 'whatever' })
  assert.equal(result.ok, false)
})

test('retryStake rejects once the retry window has expired', async () => {
  db.prepare('UPDATE entries SET allow_rematch = 1 WHERE id = ?').run(entryId)
  const wallet = fakeSettlingWallet()
  await lockEntryForChallenger(db, wallet)
  await submitChallenge(db, wallet, { entryId, nimAddress: CHALLENGER_ADDRESS, events: slowEventsFor(TARGET) })
  db.prepare('UPDATE duels SET retry_offer_expires_at = ? WHERE entry_id = ?').run(new Date(Date.now() - 1000).toISOString(), entryId)

  const result = await retryStake(db, wallet, { entryId, nimAddress: CHALLENGER_ADDRESS, stakeTxHash: 'too-late-tx' })
  assert.equal(result.ok, false)
})

function walletForRetryStake(base: HouseWallet, valueLuna: number): HouseWallet {
  return {
    ...base,
    async getTransaction(txHash) {
      return { txHash, senderAddress: CHALLENGER_ADDRESS, recipientAddress: HOUSE_ADDRESS, valueLuna, state: 'confirmed', confirmations: 5 }
    },
  }
}

test('retrySubmit settles a challenger win on the retry — the pot is the original 2x plus the doubled retry stake', async () => {
  db.prepare('UPDATE entries SET allow_rematch = 1 WHERE id = ?').run(entryId)
  const wallet = fakeSettlingWallet()
  await lockEntryForChallenger(db, wallet)
  await submitChallenge(db, wallet, { entryId, nimAddress: CHALLENGER_ADDRESS, events: slowEventsFor(TARGET) })

  const retryWallet = walletForRetryStake(wallet, STAKE_LUNA * 2)
  const result = await retrySubmit(db, retryWallet, {
    entryId,
    nimAddress: CHALLENGER_ADDRESS,
    stakeTxHash: 'retry-win-tx',
    events: honestEventsFor(TARGET), // fast this time — the challenger wins the retry
  })

  assert.equal(result.ok, true)
  if (!result.ok || result.pending) return
  assert.equal(result.outcome, 'challenger')

  const winnerId = getOrCreateUser(db, CHALLENGER_ADDRESS)
  const payoutRow = db.prepare("SELECT amount_luna FROM payouts WHERE type = 'PAYOUT' AND user_id = ?").get(winnerId) as { amount_luna: number }
  // Pot = creator's 1x + challenger's original 1x + challenger's retry 2x = 4x, minus the 10% rake.
  assert.equal(payoutRow.amount_luna, Math.round(STAKE_LUNA * 4 * 0.9))

  const entry = db.prepare('SELECT status FROM entries WHERE id = ?').get(entryId) as { status: string }
  assert.equal(entry.status, 'SETTLED')
})

test('retrySubmit settles a second loss — "that is the end" — paying the creator the full 4x pot', async () => {
  db.prepare('UPDATE entries SET allow_rematch = 1 WHERE id = ?').run(entryId)
  const wallet = fakeSettlingWallet()
  await lockEntryForChallenger(db, wallet)
  await submitChallenge(db, wallet, { entryId, nimAddress: CHALLENGER_ADDRESS, events: slowEventsFor(TARGET) })

  const retryWallet = walletForRetryStake(wallet, STAKE_LUNA * 2)
  const result = await retrySubmit(db, retryWallet, {
    entryId,
    nimAddress: CHALLENGER_ADDRESS,
    stakeTxHash: 'retry-lose-tx',
    events: slowEventsFor(TARGET), // slow again — loses the retry too
  })

  assert.equal(result.ok, true)
  if (!result.ok || result.pending) return
  assert.equal(result.outcome, 'creator')

  const creatorId = getOrCreateUser(db, CREATOR_ADDRESS)
  const payoutRow = db.prepare("SELECT amount_luna FROM payouts WHERE type = 'PAYOUT' AND user_id = ?").get(creatorId) as { amount_luna: number }
  assert.equal(payoutRow.amount_luna, Math.round(STAKE_LUNA * 4 * 0.9))
})

test('retrySubmit is idempotent — calling it twice pays out once', async () => {
  db.prepare('UPDATE entries SET allow_rematch = 1 WHERE id = ?').run(entryId)
  const wallet = fakeSettlingWallet()
  await lockEntryForChallenger(db, wallet)
  await submitChallenge(db, wallet, { entryId, nimAddress: CHALLENGER_ADDRESS, events: slowEventsFor(TARGET) })

  const retryWallet = walletForRetryStake(wallet, STAKE_LUNA * 2)
  const input = { entryId, nimAddress: CHALLENGER_ADDRESS, stakeTxHash: 'retry-idempotent-tx', events: honestEventsFor(TARGET) }
  const first = await retrySubmit(db, retryWallet, input)
  const second = await retrySubmit(db, retryWallet, input)

  assert.deepEqual(first, second)
  const payoutCount = db.prepare("SELECT COUNT(*) c FROM payouts WHERE type = 'PAYOUT'").get() as { c: number }
  assert.equal(payoutCount.c, 1)
})

test('declineRetry settles immediately as a loss at the original pot only — no rake-free bonus for declining', async () => {
  db.prepare('UPDATE entries SET allow_rematch = 1 WHERE id = ?').run(entryId)
  const wallet = fakeSettlingWallet()
  await lockEntryForChallenger(db, wallet)
  await submitChallenge(db, wallet, { entryId, nimAddress: CHALLENGER_ADDRESS, events: slowEventsFor(TARGET) })

  const result = await declineRetry(db, wallet, { entryId, nimAddress: CHALLENGER_ADDRESS })

  assert.equal(result.ok, true)
  if (!result.ok || result.pending) return
  assert.equal(result.outcome, 'creator')

  const creatorId = getOrCreateUser(db, CREATOR_ADDRESS)
  const payoutRow = db.prepare("SELECT amount_luna FROM payouts WHERE type = 'PAYOUT' AND user_id = ?").get(creatorId) as { amount_luna: number }
  assert.equal(payoutRow.amount_luna, Math.round(STAKE_LUNA * 2 * 0.9), 'declining settles the ORIGINAL 2x pot, not the retry-sized one')

  const entry = db.prepare('SELECT status FROM entries WHERE id = ?').get(entryId) as { status: string }
  assert.equal(entry.status, 'SETTLED')
})

test('declineRetry rejects when no retry is pending', async () => {
  const wallet = fakeWallet()
  await lockEntryForChallenger(db, wallet)
  const result = await declineRetry(db, wallet, { entryId, nimAddress: CHALLENGER_ADDRESS })
  assert.equal(result.ok, false)
})

test('declineRetry rejects once the retry has already been taken', async () => {
  db.prepare('UPDATE entries SET allow_rematch = 1 WHERE id = ?').run(entryId)
  const wallet = fakeSettlingWallet()
  await lockEntryForChallenger(db, wallet)
  await submitChallenge(db, wallet, { entryId, nimAddress: CHALLENGER_ADDRESS, events: slowEventsFor(TARGET) })
  const retryWallet = walletForRetryStake(wallet, STAKE_LUNA * 2)
  await retrySubmit(db, retryWallet, { entryId, nimAddress: CHALLENGER_ADDRESS, stakeTxHash: 'already-retried-tx', events: honestEventsFor(TARGET) })

  const result = await declineRetry(db, wallet, { entryId, nimAddress: CHALLENGER_ADDRESS })
  assert.equal(result.ok, true, 'the duel is already settled — reconstructs the real (retry) outcome instead of erroring')
  if (!result.ok || result.pending) return
  assert.equal(result.outcome, 'challenger', 'must reflect what actually happened (the retry), not re-decide it')
})

test('submitChallenge rejects when the entry has not been challenged', async () => {
  const result = await submitChallenge(db, fakeWallet(), { entryId, nimAddress: CHALLENGER_ADDRESS, events: honestEventsFor(TARGET) })
  assert.equal(result.ok, false)
})

test('submitChallenge rejects a submission from someone other than the challenger', async () => {
  const wallet = fakeSettlingWallet()
  await lockEntryForChallenger(db, wallet)
  const result = await submitChallenge(db, wallet, {
    entryId,
    nimAddress: OTHER_CHALLENGER_ADDRESS,
    events: honestEventsFor(TARGET),
  })
  assert.equal(result.ok, false)
})

test('submitChallenge rejects a tampered run and records nothing', async () => {
  const wallet = fakeSettlingWallet()
  await lockEntryForChallenger(db, wallet)
  const events = honestEventsFor(TARGET)
  events[2] = { ...events[2], tRelativeMs: events[1].tRelativeMs - 5 }
  const result = await submitChallenge(db, wallet, { entryId, nimAddress: CHALLENGER_ADDRESS, events })
  assert.equal(result.ok, false)

  const duel = db.prepare('SELECT challenger_keystroke_run_id FROM duels WHERE entry_id = ?').get(entryId) as {
    challenger_keystroke_run_id: string | null
  }
  assert.equal(duel.challenger_keystroke_run_id, null)
})

test('submitChallenge is idempotent — calling it twice records the run once and pays out once', async () => {
  const wallet = fakeSettlingWallet()
  await lockEntryForChallenger(db, wallet)
  const events = honestEventsFor(TARGET)
  const first = await submitChallenge(db, wallet, { entryId, nimAddress: CHALLENGER_ADDRESS, events })
  const second = await submitChallenge(db, wallet, { entryId, nimAddress: CHALLENGER_ADDRESS, events })

  assert.equal(first.ok, true)
  assert.deepEqual(first, second, 'a retry must return the exact same reveal, not move money again')

  const runCount = db.prepare('SELECT COUNT(*) c FROM keystroke_runs').get() as { c: number }
  assert.equal(runCount.c, 2) // creator's seeded run + challenger's one run, not two

  const payoutCount = db.prepare("SELECT COUNT(*) c FROM payouts WHERE type = 'PAYOUT'").get() as { c: number }
  assert.equal(payoutCount.c, 1, 'a retry must not pay out twice')
})

// --- History ---

test('listMyDuelHistory shows a win from the creator\'s side and a loss from the challenger\'s side, with both durations', async () => {
  const wallet = fakeSettlingWallet()
  await lockEntryForChallenger(db, wallet)
  await submitChallenge(db, wallet, { entryId, nimAddress: CHALLENGER_ADDRESS, events: slowEventsFor(TARGET) })

  const creatorHistory = listMyDuelHistory(db, CREATOR_ADDRESS)
  assert.equal(creatorHistory.length, 1)
  assert.equal(creatorHistory[0].outcome, 'won')
  assert.equal(creatorHistory[0].opponentAddress, CHALLENGER_ADDRESS)
  assert.equal(creatorHistory[0].myDurationMs, 5000)
  assert.equal(creatorHistory[0].difficulty, 'easy')
  assert.equal(creatorHistory[0].stakeLuna, STAKE_LUNA)
  assert.ok(creatorHistory[0].deltaMs > 0)

  const challengerHistory = listMyDuelHistory(db, CHALLENGER_ADDRESS)
  assert.equal(challengerHistory.length, 1)
  assert.equal(challengerHistory[0].outcome, 'lost')
  assert.equal(challengerHistory[0].opponentAddress, CREATOR_ADDRESS)
  assert.equal(challengerHistory[0].deltaMs, creatorHistory[0].deltaMs, 'both sides must agree on the delta')
})

test('listMyDuelHistory reports a tie for both players, with a zero delta', async () => {
  const wallet = fakeSettlingWallet()
  await lockEntryForChallenger(db, wallet)
  const tieEvents = honestEventsFor(TARGET)
  tieEvents[tieEvents.length - 1] = { ...tieEvents[tieEvents.length - 1], tRelativeMs: 5000 }
  await submitChallenge(db, wallet, { entryId, nimAddress: CHALLENGER_ADDRESS, events: tieEvents })

  assert.equal(listMyDuelHistory(db, CREATOR_ADDRESS)[0].outcome, 'tied')
  assert.equal(listMyDuelHistory(db, CHALLENGER_ADDRESS)[0].outcome, 'tied')
  assert.equal(listMyDuelHistory(db, CREATOR_ADDRESS)[0].deltaMs, 0)
})

test('listMyDuelHistory excludes duels that are not yet settled', async () => {
  const wallet = fakeWallet()
  await lockEntryForChallenger(db, wallet) // LOCKED, never submitted
  assert.deepEqual(listMyDuelHistory(db, CREATOR_ADDRESS), [])
  assert.deepEqual(listMyDuelHistory(db, CHALLENGER_ADDRESS), [])
})

test('listMyDuelHistory uses the retry\'s duration, not the original losing attempt, once a double trial is decided', async () => {
  db.prepare('UPDATE entries SET allow_rematch = 1 WHERE id = ?').run(entryId)
  const wallet = fakeSettlingWallet()
  await lockEntryForChallenger(db, wallet)
  await submitChallenge(db, wallet, { entryId, nimAddress: CHALLENGER_ADDRESS, events: slowEventsFor(TARGET) })

  const retryWallet = walletForRetryStake(wallet, STAKE_LUNA * 2)
  const retryEvents = honestEventsFor(TARGET)
  await retrySubmit(db, retryWallet, { entryId, nimAddress: CHALLENGER_ADDRESS, stakeTxHash: 'retry-history-tx', events: retryEvents })

  const history = listMyDuelHistory(db, CHALLENGER_ADDRESS)
  assert.equal(history.length, 1, 'the original losing attempt and the retry are one settled duel, not two')
  assert.equal(history[0].outcome, 'won')
  assert.equal(history[0].myDurationMs, retryEvents[retryEvents.length - 1].tRelativeMs, 'must reflect the retry run, not the original slow one')
})

test('listMyDuelHistory sorts newest-decided first', async () => {
  // A second, separately-created and separately-settled entry.
  const secondEntryId = randomUUID()
  const secondRunId = randomUUID()
  const now = new Date().toISOString()
  const creatorId = getOrCreateUser(db, CREATOR_ADDRESS)
  db.prepare(
    'INSERT INTO keystroke_runs (id, user_id, paragraph_id, events, duration_ms, created_at) VALUES (?, ?, ?, ?, ?, ?)',
  ).run(secondRunId, creatorId, PARAGRAPH_ID, '[]', 5000, now)
  const expiresAt = new Date(Date.now() + 24 * 60 * 60_000).toISOString()
  db.prepare(
    `INSERT INTO entries (id, creator_user_id, paragraph_id, keystroke_run_id, stake_luna, status, created_at, expires_at, stake_tx_hash)
     VALUES (?, ?, ?, ?, ?, 'OPEN', ?, ?, ?)`,
  ).run(secondEntryId, creatorId, PARAGRAPH_ID, secondRunId, STAKE_LUNA, now, expiresAt, 'second-entry-stake-tx')

  const wallet = fakeSettlingWallet()
  await challengeEntry(db, wallet, { entryId, nimAddress: CHALLENGER_ADDRESS, stakeTxHash: 'first-settle-tx' })
  await submitChallenge(db, wallet, { entryId, nimAddress: CHALLENGER_ADDRESS, events: honestEventsFor(TARGET) })

  await challengeEntry(db, wallet, { entryId: secondEntryId, nimAddress: CHALLENGER_ADDRESS, stakeTxHash: 'second-settle-tx' })
  await submitChallenge(db, wallet, { entryId: secondEntryId, nimAddress: CHALLENGER_ADDRESS, events: honestEventsFor(TARGET) })

  // Both settlements can land within the same millisecond in a fast
  // in-memory test (never happens for real — a settlement involves an
  // actual chain call) — pin distinct timestamps directly so the ordering
  // assertion below is about the sort, not test-environment clock timing.
  db.prepare("UPDATE duels SET settled_at = '2026-01-01T00:00:00.000Z' WHERE entry_id = ?").run(entryId)
  db.prepare("UPDATE duels SET settled_at = '2026-01-01T00:00:01.000Z' WHERE entry_id = ?").run(secondEntryId)

  const history = listMyDuelHistory(db, CREATOR_ADDRESS)
  assert.equal(history.length, 2)
  assert.equal(history[0].entryId, secondEntryId, 'the more recently settled duel should come first')
  assert.equal(history[1].entryId, entryId)
})
