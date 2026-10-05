import { closeDb, getDb } from '../server/db/client.ts'
import { migrateUp } from '../server/db/migrate.ts'
import { runExpirySweep } from '../server/duels/expiryJob.ts'
import { runGroupDuelExpirySweep } from '../server/groupDuels/expiryJob.ts'
import { createHouseWallet } from '../services/escrow.ts'

/**
 * The scheduled sweep from the build plan: run this on a timer (cron,
 * a serverless scheduled function, etc — nothing in this repo schedules it
 * itself). Refunds entries nobody challenged within 24h and releases
 * challenger locks whose TTL lapsed with no submitted run. Idempotent — see
 * server/duels/expiryJob.ts — so overlapping or repeated runs are safe.
 *
 * Run with: npm run expiry:sweep
 */

function requireEnv(name: string): string {
  const value = process.env[name]
  if (!value) throw new Error(`Missing required env var ${name}. See .env.example.`)
  return value
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

  const result = await runExpirySweep(db, wallet)
  console.log(`Released ${result.releasedLocks.length} stale lock(s): ${JSON.stringify(result.releasedLocks)}`)
  console.log(`Refunded ${result.refundedEntries.length} expired entr(y/ies): ${JSON.stringify(result.refundedEntries)}`)
  if (result.errors.length > 0) {
    console.log(`${result.errors.length} refund(s) failed and will retry next sweep: ${JSON.stringify(result.errors)}`)
  }

  const groupResult = await runGroupDuelExpirySweep(db, wallet)
  console.log(`Resolved ${groupResult.resolved.length} group duel(s) past their 72h window: ${JSON.stringify(groupResult.resolved)}`)
  if (groupResult.errors.length > 0) {
    console.log(`${groupResult.errors.length} group duel resolution(s) failed and will retry next sweep: ${JSON.stringify(groupResult.errors)}`)
  }

  await wallet.close()
  closeDb()
}

main()
  .catch((error: unknown) => {
    console.error('Expiry sweep failed:', error instanceof Error ? error.message : error)
    process.exitCode = 1
  })
  .finally(() => {
    process.exit(process.exitCode ?? 0)
  })
