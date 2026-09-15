import { closeDb, getDb } from '../server/db/client.ts'
import { migrateUp } from '../server/db/migrate.ts'
import { runExpirySweep } from '../server/duels/expiryJob.ts'
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
  migrateUp()
  const db = getDb()

  console.log('Connecting house wallet to Nimiq testnet (this can take up to a minute)...')
  const wallet = await createHouseWallet({ privateKeyHex: requireEnv('ESCROW_PRIVATE_KEY') })

  const result = await runExpirySweep(db, wallet)
  console.log(`Released ${result.releasedLocks.length} stale lock(s): ${JSON.stringify(result.releasedLocks)}`)
  console.log(`Refunded ${result.refundedEntries.length} expired entr(y/ies): ${JSON.stringify(result.refundedEntries)}`)
  if (result.errors.length > 0) {
    console.log(`${result.errors.length} refund(s) failed and will retry next sweep: ${JSON.stringify(result.errors)}`)
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
    // Same as escrow-testnet-demo.ts: the WASM client's worker keeps timers
    // alive even after a caught error, so force the exit once done.
    process.exit(process.exitCode ?? 0)
  })
