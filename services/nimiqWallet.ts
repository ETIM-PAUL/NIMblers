import * as Nimiq from '@nimiq/core'

/**
 * The house wallet's view of a single transaction, normalized away from
 * the underlying RPC wire format so `services/escrow.ts` never has to know
 * about it. Albatross doesn't have the old PoW-style "more confirmations
 * = safer" model — a transaction is either not yet in a block, or it's in
 * one and BFT-finalized almost immediately — so `confirmations` here is
 * informational, not something callers need to threshold on.
 */
export interface HouseWalletTransaction {
  txHash: string
  senderAddress: string
  recipientAddress: string
  /**
   * Every address the chain associates with this transaction, sender and
   * recipient included. For a plain basic-to-basic payment that's just
   * `[senderAddress, recipientAddress]` — but Nimiq Pay routes mini-app
   * payments through a short-lived HTLC, so the transaction that actually
   * lands in the house wallet is *sent by the HTLC*, not by the player's
   * own address. The player's address still shows up here (the node
   * tracks it as a party to the transfer), which is what callers should
   * check identity against instead of `senderAddress`. Optional because
   * not every `HouseWallet` implementation bothers populating it (e.g. a
   * test double) — callers should fall back to `[senderAddress]` when absent.
   */
  relatedAddresses?: string[]
  valueLuna: number
  state: 'pending' | 'included' | 'confirmed'
  confirmations: number
}

/**
 * Everything `services/escrow.ts` is allowed to do with real NIM. This is
 * the only interface that ever touches a private key — see CLAUDE.md's
 * "money moves in exactly one module" rule. Nothing outside
 * `services/escrow.ts` should import this module.
 */
export interface HouseWallet {
  /** The house wallet's own address, in user-friendly (IBAN-style) format. */
  address: string
  getBalance(): Promise<number>
  send(recipientAddress: string, valueLuna: number): Promise<HouseWalletTransaction>
  getTransaction(txHash: string): Promise<HouseWalletTransaction | null>
  close(): Promise<void>
}

export interface CreateHouseWalletOptions {
  /** Hex-encoded 32-byte Nimiq private key. Testnet only — see CLAUDE.md. */
  privateKeyHex: string
  /**
   * A Nimiq testnet node's JSON-RPC endpoint. Either request devnet RPC
   * access from Nimiq's team, or run your own testnet node with RPC
   * enabled — see README.md's "House wallet setup" section for why this
   * is needed instead of just connecting a light client directly.
   */
  rpcUrl: string
  rpcUsername?: string
  rpcPassword?: string
  /** How long to wait for each individual RPC call before giving up. */
  requestTimeoutMs?: number
}

/** NetworkId::TestAlbatross — see core-rs-albatross/primitives/src/networks.rs. Not exported as a JS constant by @nimiq/core, so pinned here. */
const TESTNET_NETWORK_ID = 5

export class RpcError extends Error {}

interface RpcAccount {
  address: string
  balance: number
}

interface RpcTransaction {
  hash: string
  blockNumber?: number
  confirmations?: number
  from: string
  to: string
  value: number
  relatedAddresses?: string[]
}

/**
 * A minimal hand-rolled JSON-RPC 2.0 client — no new dependency for what's
 * a handful of POST requests. Matches the shape every Nimiq RPC node
 * speaks: `{jsonrpc, method, params, id}` in, `{result: {data, metadata}}`
 * or `{error}` out, HTTP Basic Auth when credentials are configured.
 */
function createRpcClient(options: CreateHouseWalletOptions) {
  const timeoutMs = options.requestTimeoutMs ?? 15_000
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (options.rpcUsername && options.rpcPassword) {
    headers.Authorization = `Basic ${Buffer.from(`${options.rpcUsername}:${options.rpcPassword}`).toString('base64')}`
  }

  return async function call<T>(method: string, params: unknown[] = []): Promise<T> {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    let res: Response
    try {
      res = await fetch(options.rpcUrl, {
        method: 'POST',
        headers,
        body: JSON.stringify({ jsonrpc: '2.0', method, params, id: Date.now() }),
        signal: controller.signal,
      })
    }
    catch (error) {
      throw new RpcError(`Could not reach Nimiq RPC node at ${options.rpcUrl}: ${error instanceof Error ? error.message : String(error)}`)
    }
    finally {
      clearTimeout(timer)
    }

    if (!res.ok) throw new RpcError(`Nimiq RPC HTTP error ${res.status}: ${res.statusText}`)
    const json = (await res.json()) as { result?: { data: T }, error?: { message: string } }
    if (json.error) throw new RpcError(`Nimiq RPC error calling ${method}: ${json.error.message}`)
    if (!json.result) throw new RpcError(`Nimiq RPC returned an unexpected shape for ${method}`)
    return json.result.data
  }
}

/** A raw RPC transaction result can come back flat or nested under `.transaction` depending on the calling context — normalize either way. */
function normalizeRpcTransaction(raw: unknown): RpcTransaction | null {
  if (!raw || typeof raw !== 'object') return null
  const candidate = 'transaction' in raw ? (raw as { transaction: unknown }).transaction : raw
  if (!candidate || typeof candidate !== 'object' || typeof (candidate as RpcTransaction).hash !== 'string') return null
  return candidate as RpcTransaction
}

function toHouseWalletTransaction(tx: RpcTransaction): HouseWalletTransaction {
  const state: HouseWalletTransaction['state'] =
    tx.blockNumber === undefined ? 'pending' : (tx.confirmations ?? 0) > 0 ? 'confirmed' : 'included'
  return {
    txHash: tx.hash,
    senderAddress: tx.from,
    recipientAddress: tx.to,
    relatedAddresses: tx.relatedAddresses ?? [tx.from, tx.to],
    valueLuna: tx.value,
    state,
    confirmations: tx.confirmations ?? 0,
  }
}

/**
 * Wraps a Nimiq testnet house wallet as a `HouseWallet` — signing happens
 * entirely locally (the private key never leaves this process), and every
 * network operation (balance, broadcast, transaction lookup) goes over
 * plain JSON-RPC to a node you point it at, rather than running a P2P
 * light client (`Nimiq.Client.create()`) in this process.
 *
 * That's a deliberate workaround, not a preference: `@nimiq/core`'s v2
 * light client spawns a worker thread whose WASM internals call a
 * browser-only `addEventListener`, which Node's `Worker` doesn't provide —
 * a confirmed upstream bug (nimiq/core-rs-albatross#3417), reproduced with
 * the exact same `Client.create()` pattern this file used to use, under
 * plain Node.js — not something specific to any one sandbox or host.
 * Transaction *building and signing* (`PrivateKey`, `KeyPair`,
 * `TransactionBuilder`) are unaffected: those run synchronously against
 * `@nimiq/core`'s WASM module in the main thread, no worker involved, so
 * they're used here exactly as before. Nimiq has no general smart
 * contracts — only basic, vesting, and HTLC accounts, and an HTLC's
 * recipient is fixed at creation — so there is no trustless on-chain
 * construct that can hold a duel's stake until a winner is decided. This
 * wallet, holding a real private key server-side, is the custodial escrow
 * by necessity: it receives stakes and pays out winners/refunds directly.
 */
export async function createHouseWallet(options: CreateHouseWalletOptions): Promise<HouseWallet> {
  const privateKey = Nimiq.PrivateKey.fromHex(options.privateKeyHex)
  const keyPair = Nimiq.KeyPair.derive(privateKey)
  const address = keyPair.toAddress()
  const call = createRpcClient(options)

  return {
    address: address.toUserFriendlyAddress(),

    async getBalance() {
      const account = await call<RpcAccount>('getAccountByAddress', [address.toUserFriendlyAddress()])
      return account.balance
    },

    async send(recipientAddress, valueLuna) {
      const recipient = Nimiq.Address.fromUserFriendlyAddress(recipientAddress)
      const headHeight = await call<number>('getBlockNumber')
      const tx = Nimiq.TransactionBuilder.newBasic(address, recipient, BigInt(valueLuna), null, headHeight, TESTNET_NETWORK_ID)
      keyPair.signTransaction(tx)
      const txHash = await call<string>('sendRawTransaction', [tx.toHex()])
      return {
        txHash,
        senderAddress: address.toUserFriendlyAddress(),
        recipientAddress,
        relatedAddresses: [address.toUserFriendlyAddress(), recipientAddress],
        valueLuna,
        state: 'pending',
        confirmations: 0,
      }
    },

    async getTransaction(txHash) {
      try {
        const raw = await call<unknown>('getTransactionByHash', [txHash])
        const tx = normalizeRpcTransaction(raw)
        return tx ? toHouseWalletTransaction(tx) : null
      }
      catch {
        return null
      }
    },

    async close() {
      // Every call above is a stateless HTTP request — there's no persistent connection to tear down.
    },
  }
}
