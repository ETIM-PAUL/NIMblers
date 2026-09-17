import type { HouseWallet } from '../../services/escrow.ts'
import { createHouseWallet } from '../../services/escrow.ts'

function requireEnv(name: string): string {
  const value = process.env[name]
  if (!value) throw new Error(`Missing required env var ${name}. See .env.example.`)
  return value
}

// Created once, lazily, on the first request that actually needs it —
// not eagerly at server startup, which would block every other route
// behind however long the first RPC call takes.
let walletPromise: Promise<HouseWallet> | null = null
let walletFactory: () => Promise<HouseWallet> = () =>
  createHouseWallet({
    privateKeyHex: requireEnv('ESCROW_PRIVATE_KEY'),
    rpcUrl: requireEnv('NIMIQ_RPC_URL'),
    rpcUsername: process.env.NIMIQ_RPC_USERNAME || undefined,
    rpcPassword: process.env.NIMIQ_RPC_PASSWORD || undefined,
  })

export function getHouseWallet(): Promise<HouseWallet> {
  walletPromise ??= walletFactory()
  return walletPromise
}

/** For tests: forget the cached connection so a fresh one (or a fake) can be substituted. */
export function resetHouseWallet(): void {
  walletPromise = null
}

/** For tests: inject a fake wallet instead of connecting to the real Nimiq network. */
export function setHouseWalletForTesting(wallet: HouseWallet): void {
  walletFactory = () => Promise.resolve(wallet)
  walletPromise = null
}

/**
 * For tests: inject a factory instead of a ready wallet — e.g. to simulate
 * a connection failure. Kept lazy (called only when `getHouseWallet()` is
 * actually invoked) so a rejection is created and caught within the same
 * request, rather than sitting as an unhandled rejection before anything
 * ever awaits it.
 */
export function setHouseWalletFactoryForTesting(factory: () => Promise<HouseWallet>): void {
  walletFactory = factory
  walletPromise = null
}
