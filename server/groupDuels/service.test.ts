import assert from 'node:assert/strict'
import { beforeEach, test } from 'node:test'
import type { Db } from '../db/client.ts'
import { closeDb, getDb } from '../db/client.ts'
import { migrateUp } from '../db/migrate.ts'
import { DUEL_STAKE_LUNA_BY_DIFFICULTY } from '../entries/service.ts'
import { runGroupDuelExpirySweep } from './expiryJob.ts'
import { createGroupDuel, getGroupDuelPreview, getGroupDuelStatus, joinGroupDuel, listMyGroupDuels, submitGroupRun } from './service.ts'
import type { HouseWallet, HouseWalletTransaction } from '../../services/escrow.ts'

process.env.DB_PATH = ':memory:'

const HOUSE_ADDRESS = 'NQ07 HOUS EAAA AAAA AAAA AAAA AAAA AAAA AAAA'

function addressFor(name: string): string {
  return `NQ07 ${name.toUpperCase().padEnd(35, 'A').slice(0, 35)}`
}

interface FakeWallet extends HouseWallet {
  sends: { recipientAddress: string, valueLuna: number }[]
  stakes: Map<string, HouseWalletTransaction>
}

/** A wallet that confirms whatever stake tx hashes `stakeTx` registers on it, and records every send. */
function createFakeWallet(): FakeWallet {
  const stakes = new Map<string, HouseWalletTransaction>()
  const sends: { recipientAddress: string, valueLuna: number }[] = []
  let sendCount = 0
  return {
    address: HOUSE_ADDRESS,
    stakes,
    sends,
    async getBalance() { return 50_000_000 },
    async send(recipientAddress, valueLuna) {
      sendCount += 1
      sends.push({ recipientAddress, valueLuna })
      return { txHash: `send-${sendCount}`, senderAddress: HOUSE_ADDRESS, recipientAddress, valueLuna, state: 'confirmed', confirmations: 5 }
    },
    async getTransaction(txHash) { return stakes.get(txHash) ?? null },
    async close() {},
  }
}

/** Registers a confirmed stake transaction on a fake wallet so `joinGroupDuel`/`confirmStake` can verify it. */
function stakeTx(wallet: FakeWallet, txHash: string, fromAddress: string, valueLuna: number): void {
  wallet.stakes.set(txHash, { txHash, senderAddress: fromAddress, recipientAddress: HOUSE_ADDRESS, valueLuna, state: 'confirmed', confirmations: 5 })
}

function honestEventsFor(target: string, msPerChar = 100): { key: string, tRelativeMs: number, resultingLength: number }[] {
  return target.split('').map((char, i) => ({ key: char, tRelativeMs: i * msPerChar, resultingLength: i + 1 }))
}

let db: Db

beforeEach(async () => {
  closeDb()
  await migrateUp()
  db = await getDb()
})

test('createGroupDuel generates a code and the correct stake for the tier, without revealing the paragraph', async () => {
  const result = await createGroupDuel(db, { nimAddress: addressFor('host'), difficulty: 'medium', maxParticipants: 5 })
  assert.equal(result.ok, true)
  if (!result.ok) return
  assert.equal(result.code.length, 6)
  assert.equal(result.stakeLuna, DUEL_STAKE_LUNA_BY_DIFFICULTY.medium)
  assert.equal(Object.keys(result).includes('paragraphBody'), false)
})

test('createGroupDuel rejects an out-of-range maxParticipants', async () => {
  const tooFew = await createGroupDuel(db, { nimAddress: addressFor('host'), difficulty: 'easy', maxParticipants: 1 })
  assert.equal(tooFew.ok, false)
  const tooMany = await createGroupDuel(db, { nimAddress: addressFor('host'), difficulty: 'easy', maxParticipants: 51 })
  assert.equal(tooMany.ok, false)
})

test('getGroupDuelPreview shows stake/slots but never the paragraph', async () => {
  const created = await createGroupDuel(db, { nimAddress: addressFor('host'), difficulty: 'easy', maxParticipants: 4 })
  assert.equal(created.ok, true)
  if (!created.ok) return
  const preview = await getGroupDuelPreview(db, created.code)
  assert.equal(preview.ok, true)
  if (!preview.ok) return
  assert.equal(preview.preview.maxParticipants, 4)
  assert.equal(preview.preview.joinedCount, 0)
  assert.equal(preview.preview.status, 'OPEN')
})

test('getGroupDuelPreview rejects an unknown code', async () => {
  const result = await getGroupDuelPreview(db, 'ZZZZZZ')
  assert.equal(result.ok, false)
})

test('getGroupDuelPreview reports whether the given address has already joined, and whether it has submitted', async () => {
  const wallet = createFakeWallet()
  const { created, fastJoin } = await createFull2PlayerDuel(wallet)

  const notJoinedYet = await getGroupDuelPreview(db, created.code, addressFor('someone-else'))
  assert.equal(notJoinedYet.ok, true)
  if (notJoinedYet.ok) assert.deepEqual(notJoinedYet.preview.you, { joined: false })

  const joinedNotSubmitted = await getGroupDuelPreview(db, created.code, addressFor('fast'))
  assert.equal(joinedNotSubmitted.ok, true)
  if (joinedNotSubmitted.ok) {
    assert.equal(joinedNotSubmitted.preview.you?.joined, true)
    if (joinedNotSubmitted.preview.you?.joined) assert.equal(joinedNotSubmitted.preview.you.submitted, false)
  }

  await submitGroupRun(db, wallet, { groupDuelId: fastJoin.groupDuelId, nimAddress: addressFor('fast'), events: honestEventsFor(fastJoin.paragraphBody, 100) })

  const joinedAndSubmitted = await getGroupDuelPreview(db, created.code, addressFor('fast'))
  assert.equal(joinedAndSubmitted.ok, true)
  if (joinedAndSubmitted.ok) {
    assert.equal(joinedAndSubmitted.preview.you?.joined, true)
    if (joinedAndSubmitted.preview.you?.joined) assert.equal(joinedAndSubmitted.preview.you.submitted, true)
  }

  const noAddressGiven = await getGroupDuelPreview(db, created.code)
  assert.equal(noAddressGiven.ok, true)
  if (noAddressGiven.ok) assert.equal(noAddressGiven.preview.you, null)
})

async function createFull2PlayerDuel(wallet: ReturnType<typeof createFakeWallet>) {
  const created = await createGroupDuel(db, { nimAddress: addressFor('host'), difficulty: 'easy', maxParticipants: 2 })
  assert.equal(created.ok, true)
  if (!created.ok) throw new Error('unreachable')

  stakeTx(wallet, 'tx-fast', addressFor('fast'), created.stakeLuna)
  stakeTx(wallet, 'tx-slow', addressFor('slow'), created.stakeLuna)

  const fastJoin = await joinGroupDuel(db, wallet, { code: created.code, nimAddress: addressFor('fast'), stakeTxHash: 'tx-fast' })
  const slowJoin = await joinGroupDuel(db, wallet, { code: created.code, nimAddress: addressFor('slow'), stakeTxHash: 'tx-slow' })
  assert.equal(fastJoin.ok, true)
  assert.equal(slowJoin.ok, true)
  if (!fastJoin.ok || !slowJoin.ok) throw new Error('unreachable')

  return { created, fastJoin, slowJoin }
}

test('joinGroupDuel rejects an unknown code', async () => {
  const wallet = createFakeWallet()
  const result = await joinGroupDuel(db, wallet, { code: 'ZZZZZZ', nimAddress: addressFor('a'), stakeTxHash: 'tx-1' })
  assert.equal(result.ok, false)
})

test('joinGroupDuel rejects once the group is full', async () => {
  const wallet = createFakeWallet()
  const { created } = await createFull2PlayerDuel(wallet)

  stakeTx(wallet, 'tx-third', addressFor('third'), created.stakeLuna)
  const thirdJoin = await joinGroupDuel(db, wallet, { code: created.code, nimAddress: addressFor('third'), stakeTxHash: 'tx-third' })
  assert.equal(thirdJoin.ok, false)
})

test('joinGroupDuel is idempotent per participant — rejoining returns the same paragraph without re-staking', async () => {
  const wallet = createFakeWallet()
  const created = await createGroupDuel(db, { nimAddress: addressFor('host'), difficulty: 'easy', maxParticipants: 3 })
  assert.equal(created.ok, true)
  if (!created.ok) return

  stakeTx(wallet, 'tx-a', addressFor('a'), created.stakeLuna)
  const first = await joinGroupDuel(db, wallet, { code: created.code, nimAddress: addressFor('a'), stakeTxHash: 'tx-a' })
  const second = await joinGroupDuel(db, wallet, { code: created.code, nimAddress: addressFor('a'), stakeTxHash: 'tx-a' })
  assert.deepEqual(first, second)

  const preview = await getGroupDuelPreview(db, created.code)
  assert.equal(preview.ok, true)
  if (preview.ok) assert.equal(preview.preview.joinedCount, 1, 'rejoining must not claim a second slot')
})

test('submitGroupRun resolves the group automatically once every joined slot has submitted, splitting the pot by rank', async () => {
  const wallet = createFakeWallet()
  const { created, fastJoin, slowJoin } = await createFull2PlayerDuel(wallet)

  const fastSubmit = await submitGroupRun(db, wallet, { groupDuelId: fastJoin.groupDuelId, nimAddress: addressFor('fast'), events: honestEventsFor(fastJoin.paragraphBody, 100) })
  assert.equal(fastSubmit.ok, true, JSON.stringify(fastSubmit))
  const slowSubmit = await submitGroupRun(db, wallet, { groupDuelId: slowJoin.groupDuelId, nimAddress: addressFor('slow'), events: honestEventsFor(slowJoin.paragraphBody, 300) })
  assert.equal(slowSubmit.ok, true, JSON.stringify(slowSubmit))

  const status = await getGroupDuelStatus(db, { groupDuelId: fastJoin.groupDuelId })
  assert.equal(status.ok, true)
  if (!status.ok || !status.resolved) throw new Error('expected the group duel to be resolved')

  const fastResult = status.results.find((r) => r.address === addressFor('fast'))
  const slowResult = status.results.find((r) => r.address === addressFor('slow'))
  assert.equal(fastResult?.rank, 1)
  assert.equal(slowResult?.rank, 2)
  assert.ok((fastResult?.payoutLuna ?? 0) > 0, 'the faster finisher must be paid')

  // paidPlaces(2) === 1 — only rank 1 gets paid, rank 2 gets nothing.
  assert.equal(slowResult?.payoutLuna, 0)

  const pot = created.stakeLuna * 2
  assert.equal(fastResult?.payoutLuna, Math.round(pot * 0.9))
  assert.equal(wallet.sends.length, 1, 'only the winner is actually paid out')
})

test('a participant who never submits forfeits their stake into the pot instead of being refunded', async () => {
  const wallet = createFakeWallet()
  const { created, fastJoin } = await createFull2PlayerDuel(wallet)

  // Only the fast player submits before the 72h window closes; the sweep resolves the rest.
  await submitGroupRun(db, wallet, { groupDuelId: fastJoin.groupDuelId, nimAddress: addressFor('fast'), events: honestEventsFor(fastJoin.paragraphBody, 100) })

  const past = new Date(Date.now() + 73 * 60 * 60_000)
  const sweep = await runGroupDuelExpirySweep(db, wallet, past)
  assert.equal(sweep.resolved.length, 1)
  assert.equal(sweep.errors.length, 0)

  const status = await getGroupDuelStatus(db, { groupDuelId: fastJoin.groupDuelId })
  assert.equal(status.ok, true)
  if (!status.ok || !status.resolved) throw new Error('expected the group duel to be resolved')

  const fastResult = status.results.find((r) => r.address === addressFor('fast'))
  const slowResult = status.results.find((r) => r.address === addressFor('slow'))
  assert.equal(fastResult?.forfeited, false)
  assert.equal(slowResult?.forfeited, true)
  assert.equal(slowResult?.payoutLuna, 0)
  // The lone finisher takes the whole pot (both stakes), raked — not just their own stake back.
  assert.equal(fastResult?.payoutLuna, Math.round(created.stakeLuna * 2 * 0.9))
})

test('if nobody ever submits, every joined stake is refunded in full with no rake', async () => {
  const wallet = createFakeWallet()
  const { created, fastJoin } = await createFull2PlayerDuel(wallet)

  const past = new Date(Date.now() + 73 * 60 * 60_000)
  const sweep = await runGroupDuelExpirySweep(db, wallet, past)
  assert.equal(sweep.resolved.length, 1)

  const status = await getGroupDuelStatus(db, { groupDuelId: fastJoin.groupDuelId })
  assert.equal(status.ok, true)
  if (!status.ok || !status.resolved) throw new Error('expected the group duel to be resolved')
  assert.equal(status.results.every((r) => r.forfeited), true)

  assert.equal(wallet.sends.length, 2)
  for (const send of wallet.sends) assert.equal(send.valueLuna, created.stakeLuna, 'a full refund, no rake taken')
})

test('listMyGroupDuels finds a group both for its host (who never joined) and for a participant, but not for an outsider', async () => {
  const wallet = createFakeWallet()
  const { created, fastJoin } = await createFull2PlayerDuel(wallet)

  const hostView = await listMyGroupDuels(db, addressFor('host'))
  assert.equal(hostView.length, 1)
  assert.equal(hostView[0].code, created.code)
  assert.equal(hostView[0].isHost, true)
  assert.equal(hostView[0].youJoined, false, 'the host never joined their own group in this scenario')

  const participantView = await listMyGroupDuels(db, addressFor('fast'))
  assert.equal(participantView.length, 1)
  assert.equal(participantView[0].isHost, false)
  assert.equal(participantView[0].youJoined, true)
  assert.equal(participantView[0].youSubmitted, false)

  await submitGroupRun(db, wallet, { groupDuelId: fastJoin.groupDuelId, nimAddress: addressFor('fast'), events: honestEventsFor(fastJoin.paragraphBody, 100) })
  const afterSubmit = await listMyGroupDuels(db, addressFor('fast'))
  assert.equal(afterSubmit[0].youSubmitted, true)

  const outsiderView = await listMyGroupDuels(db, addressFor('nobody'))
  assert.equal(outsiderView.length, 0)
})

test('the expiry sweep is idempotent — running it twice never pays twice', async () => {
  const wallet = createFakeWallet()
  const { fastJoin } = await createFull2PlayerDuel(wallet)
  await submitGroupRun(db, wallet, { groupDuelId: fastJoin.groupDuelId, nimAddress: addressFor('fast'), events: honestEventsFor(fastJoin.paragraphBody, 100) })

  const past = new Date(Date.now() + 73 * 60 * 60_000)
  await runGroupDuelExpirySweep(db, wallet, past)
  await runGroupDuelExpirySweep(db, wallet, past)

  assert.equal(wallet.sends.length, 1)
})
