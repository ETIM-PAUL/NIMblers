import { randomUUID } from 'node:crypto'
import { closeDb, getDb } from '../server/db/client.ts'
import { migrateUp } from '../server/db/migrate.ts'
import { createHouseWallet, getBalance, payout, receiveStake, refund } from '../services/escrow.ts'

/**
 * Demonstrates the full escrow flow against real Nimiq testnet: connect the
 * house wallet, receive a stake, refund it, and prove payout() is
 * idempotent — all with real signed, broadcast transactions.
 *
 * A real duel has a *separate* player wallet sending the stake. This script
 * only has the one funded house wallet, so it stakes from itself to itself
 * — same code path, same on-chain verification, just demoing with one
 * account instead of two. See README.md for how to fund ESCROW_PRIVATE_KEY.
 *
 * Run with: npm run escrow:demo
 */

const STAKE_LUNA = 100 // trivial amount — this is a mechanism demo, not a real wager

function requireEnv(name: string): string {
  const value = process.env[name]
  if (!value) throw new Error(`Missing required env var ${name}. See .env.example.`)
  return value
}

async function waitForConfirmation(
  wallet: Awaited<ReturnType<typeof createHouseWallet>>,
  txHash: string,
  timeoutMs = 60_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const tx = await wallet.getTransaction(txHash)
    if (tx && (tx.state === 'included' || tx.state === 'confirmed')) return
    await new Promise((resolve) => setTimeout(resolve, 2000))
  }
  throw new Error(`Transaction ${txHash} did not confirm within ${timeoutMs}ms`)
}

async function main() {
  process.env.DB_PATH ??= 'server/db/data.sqlite'
  await migrateUp()
  const db = await getDb()

  const wallet = await createHouseWallet({
    privateKeyHex: requireEnv('ESCROW_PRIVATE_KEY'),
    rpcUrl: requireEnv('NIMIQ_RPC_URL'),
    rpcUsername: process.env.NIMIQ_RPC_USERNAME || undefined,
    rpcPassword: process.env.NIMIQ_RPC_PASSWORD || undefined,
  })
  console.log(`House wallet address: ${wallet.address}`)

  const startingBalance = await getBalance(wallet)
  console.log(`Starting balance: ${startingBalance} Luna`)
  if (startingBalance < STAKE_LUNA * 10) {
    console.log(
      'Balance is low or zero. Fund this address from Nimiq Pay\'s testnet faucet ' +
        '("Get free NIM" in the dev menu) before running this demo for real.',
    )
  }

  const userId = randomUUID()
  await db.execute({
    sql: 'INSERT INTO users (id, nim_address, created_at) VALUES (?, ?, ?)',
    args: [userId, wallet.address, new Date().toISOString()],
  })

  console.log(`\n--- Stake ---`)
  console.log(`Sending ${STAKE_LUNA} Luna from the house wallet to itself (simulating a player's stake)...`)
  const stakeTx = await wallet.send(wallet.address, STAKE_LUNA)
  console.log(`Sent. Transaction hash: ${stakeTx.txHash}`)
  console.log('Waiting for confirmation...')
  await waitForConfirmation(wallet, stakeTx.txHash)
  console.log('Confirmed.')

  const stakeRecord = await receiveStake(db, wallet, {
    idempotencyKey: `demo-stake-${stakeTx.txHash}`,
    userId,
    fromAddress: wallet.address,
    valueLuna: STAKE_LUNA,
    txHash: stakeTx.txHash,
  })
  console.log(`receiveStake() recorded: ${JSON.stringify(stakeRecord)}`)

  console.log(`\n--- Refund ---`)
  const refundKey = `demo-refund-${stakeTx.txHash}`
  const refundRecord = await refund(db, wallet, {
    idempotencyKey: refundKey,
    userId,
    recipientAddress: wallet.address,
    valueLuna: STAKE_LUNA,
  })
  console.log(`refund() sent transaction: ${refundRecord.txHash}`)

  console.log(`\n--- Idempotency check ---`)
  console.log('Calling payout() twice with the same idempotency key...')
  const payoutKey = `demo-payout-${randomUUID()}`
  const payoutInput = { idempotencyKey: payoutKey, userId, recipientAddress: wallet.address, valueLuna: STAKE_LUNA }
  const first = await payout(db, wallet, payoutInput)
  const second = await payout(db, wallet, payoutInput)
  console.log(`First call:  ${JSON.stringify(first)}`)
  console.log(`Second call: ${JSON.stringify(second)}`)
  console.log(first.txHash === second.txHash ? 'PASS: same result both times, one transaction sent.' : 'FAIL: results differ.')

  const endingBalance = await getBalance(wallet)
  console.log(`\nFinal balance: ${endingBalance} Luna`)

  await wallet.close()
  closeDb()
}

main()
  .catch((error: unknown) => {
    console.error('Demo failed:', error instanceof Error ? error.message : error)
    process.exitCode = 1
  })
  .finally(() => {
    process.exit(process.exitCode ?? 0)
  })
