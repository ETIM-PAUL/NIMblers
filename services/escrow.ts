import { randomUUID } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'
import type { PayoutType } from '../server/db/types.ts'
import type { HouseWallet } from './nimiqWallet.ts'

export type { HouseWallet, HouseWalletTransaction, CreateHouseWalletOptions } from './nimiqWallet.ts'
export { createHouseWallet } from './nimiqWallet.ts'

/**
 * The ONLY module in this codebase allowed to move real NIM. Nimiq has no
 * general smart contracts — only basic, vesting, and HTLC accounts, and an
 * HTLC's recipient is fixed at creation — so there's no trustless on-chain
 * construct that can hold a duel's stake until a winner is decided. Escrow
 * is custodial by necessity: the house wallet (services/nimiqWallet.ts)
 * holds real funds and this module is the sole gateway to it.
 *
 * Every movement is written to `payouts`, keyed by an idempotency key that
 * is claimed atomically (a plain synchronous INSERT, before any `await`)
 * so a retry — concurrent or sequential — can never send twice, only ever
 * return the first result.
 */

export interface PayoutRecord {
  id: string
  idempotencyKey: string
  userId: string
  type: PayoutType
  amountLuna: number
  txHash: string | null
}

interface PayoutRow {
  id: string
  idempotency_key: string
  user_id: string
  type: PayoutType
  amount_luna: number
  tx_hash: string | null
}

/**
 * Nimiq user-friendly addresses ("NQ07 0000 ...") are conventionally
 * space-grouped but not everything that hands one around preserves the
 * spacing or casing exactly — a wallet SDK, an RPC node, and a value typed
 * into a form can each normalize differently. Compare on content, not on
 * incidental formatting.
 */
function normalizeAddress(address: string): string {
  return address.replace(/\s+/g, '').toUpperCase()
}

function toPayoutRecord(row: PayoutRow): PayoutRecord {
  return {
    id: row.id,
    idempotencyKey: row.idempotency_key,
    userId: row.user_id,
    type: row.type,
    amountLuna: row.amount_luna,
    txHash: row.tx_hash,
  }
}

function findByIdempotencyKey(db: DatabaseSync, idempotencyKey: string): PayoutRecord | null {
  const row = db.prepare('SELECT * FROM payouts WHERE idempotency_key = ?').get(idempotencyKey) as
    | PayoutRow
    | undefined
  return row ? toPayoutRecord(row) : null
}

/**
 * Synchronously claims an idempotency key by inserting a placeholder row
 * (no `tx_hash` yet). Because this runs with no `await` in between the
 * uniqueness check (the DB's own `UNIQUE` constraint) and the insert,
 * there's no window for two concurrent calls to both believe they got the
 * key — SQLite raises on the second `INSERT`, not after both already sent
 * money.
 */
function tryClaim(db: DatabaseSync, idempotencyKey: string, userId: string, type: PayoutType, amountLuna: number): string | null {
  const id = randomUUID()
  try {
    db.prepare(
      `INSERT INTO payouts (id, idempotency_key, user_id, type, amount_luna, tx_hash, created_at)
       VALUES (?, ?, ?, ?, ?, NULL, ?)`,
    ).run(id, idempotencyKey, userId, type, amountLuna, new Date().toISOString())
    return id
  }
  catch {
    return null
  }
}

/**
 * Claims an idempotency key, runs `fulfill` (the actual chain call), and
 * records its result. If the key is already claimed, returns the prior
 * result if it finished, or throws if it's still in flight. If `fulfill`
 * throws, the claim is released so the same key can be retried.
 */
async function claimAndRecord(
  db: DatabaseSync,
  input: { idempotencyKey: string, userId: string, type: PayoutType, amountLuna: number },
  fulfill: () => Promise<string>,
): Promise<PayoutRecord> {
  const claimedId = tryClaim(db, input.idempotencyKey, input.userId, input.type, input.amountLuna)

  if (claimedId === null) {
    const existing = findByIdempotencyKey(db, input.idempotencyKey)
    if (existing && existing.txHash !== null) return existing
    throw new Error(
      `Idempotency key "${input.idempotencyKey}" is already claimed but not yet fulfilled — ` +
        'retry once the original call completes.',
    )
  }

  try {
    const txHash = await fulfill()
    db.prepare('UPDATE payouts SET tx_hash = ? WHERE id = ?').run(txHash, claimedId)
    return { id: claimedId, idempotencyKey: input.idempotencyKey, userId: input.userId, type: input.type, amountLuna: input.amountLuna, txHash }
  }
  catch (error) {
    db.prepare('DELETE FROM payouts WHERE id = ?').run(claimedId)
    throw error
  }
}

export async function getBalance(wallet: HouseWallet): Promise<number> {
  return wallet.getBalance()
}

export interface ReceiveStakeInput {
  idempotencyKey: string
  userId: string
  /** The address the stake is claimed to have come from. */
  fromAddress: string
  valueLuna: number
  /** Hash of the transaction the player already sent, through their own Nimiq Pay wallet. */
  txHash: string
  /** Overrides the default wait for the transaction to appear on-chain — tests use this to skip the real-time delay. */
  pollForTransaction?: { attempts?: number, intervalMs?: number }
}

/**
 * Nimiq Pay routes a mini-app payment through a short-lived HTLC: the
 * player's wallet broadcasts one transaction, then Nimiq Pay's own backend
 * settles a second transaction (HTLC to house wallet) once the first is
 * seen — a gap of a few seconds that's entirely normal, not a failure.
 * `getTransactionByHash` on a real node reports "not found" for a hash
 * that simply hasn't landed yet, indistinguishable from one that never
 * will — so give it a real window to show up before concluding it's
 * actually missing.
 */
// Real-time delay only makes sense against a real, slow chain — in tests
// (NODE_ENV=test) it'd otherwise turn every "this stake doesn't exist"
// assertion into a multi-second wait for no reason.
const DEFAULT_POLL_INTERVAL_MS = process.env.NODE_ENV === 'test' ? 0 : 2000

async function waitForTransaction(
  wallet: HouseWallet,
  txHash: string,
  { attempts = 15, intervalMs = DEFAULT_POLL_INTERVAL_MS } = {},
): Promise<NonNullable<Awaited<ReturnType<HouseWallet['getTransaction']>>>> {
  for (let attempt = 1; attempt <= attempts; attempt++) {
    const tx = await wallet.getTransaction(txHash)
    if (tx) return tx
    if (attempt < attempts) await new Promise(resolve => setTimeout(resolve, intervalMs))
  }
  throw new Error(`Transaction ${txHash} was not found`)
}

/**
 * Records a stake — but only once it's independently confirmed on-chain,
 * never just because a client claims it happened. The player sends the
 * stake themselves, through their own Nimiq Pay wallet; this service never
 * holds a player's key, and never trusts a client's word for what a
 * transaction contains. It re-fetches the transaction from the chain and
 * checks every field itself before writing anything.
 */
export function receiveStake(db: DatabaseSync, wallet: HouseWallet, input: ReceiveStakeInput): Promise<PayoutRecord> {
  return claimAndRecord(
    db,
    { idempotencyKey: input.idempotencyKey, userId: input.userId, type: 'STAKE_RECEIVED', amountLuna: input.valueLuna },
    async () => {
      const tx = await waitForTransaction(wallet, input.txHash, input.pollForTransaction)
      if (normalizeAddress(tx.recipientAddress) !== normalizeAddress(wallet.address)) {
        throw new Error(`Transaction was not sent to the house wallet (sent to ${tx.recipientAddress}, expected ${wallet.address})`)
      }
      // Not a plain equality check against tx.senderAddress: Nimiq Pay
      // routes mini-app payments through a short-lived HTLC, so the
      // transaction that lands in the house wallet is sent *by the HTLC*,
      // not by the player's own address. relatedAddresses still lists the
      // player's address as a party to the transfer — that's the right
      // thing to check identity against.
      const relatedAddresses = tx.relatedAddresses ?? [tx.senderAddress]
      if (!relatedAddresses.some(related => normalizeAddress(related) === normalizeAddress(input.fromAddress))) {
        throw new Error(`Transaction sender does not match the claimed address (chain says ${tx.senderAddress}, claimed ${input.fromAddress})`)
      }
      if (tx.valueLuna < input.valueLuna) throw new Error('Transaction value is less than the claimed stake')
      if (tx.state !== 'included' && tx.state !== 'confirmed') {
        throw new Error(`Transaction is not yet confirmed (state: ${tx.state})`)
      }
      return input.txHash
    },
  )
}

interface SendInput {
  idempotencyKey: string
  userId: string
  recipientAddress: string
  valueLuna: number
}

function sendAndRecord(db: DatabaseSync, wallet: HouseWallet, type: 'PAYOUT' | 'REFUND', input: SendInput): Promise<PayoutRecord> {
  return claimAndRecord(
    db,
    { idempotencyKey: input.idempotencyKey, userId: input.userId, type, amountLuna: input.valueLuna },
    async () => {
      const tx = await wallet.send(input.recipientAddress, input.valueLuna)
      return tx.txHash
    },
  )
}

/** Pays a duel's winner. Calling this twice with the same idempotency key sends once. */
export function payout(db: DatabaseSync, wallet: HouseWallet, input: SendInput): Promise<PayoutRecord> {
  return sendAndRecord(db, wallet, 'PAYOUT', input)
}

/** Refunds a stake. Calling this twice with the same idempotency key sends once. */
export function refund(db: DatabaseSync, wallet: HouseWallet, input: SendInput): Promise<PayoutRecord> {
  return sendAndRecord(db, wallet, 'REFUND', input)
}
