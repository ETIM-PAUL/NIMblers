import * as Nimiq from '@nimiq/core'

/**
 * The house wallet's view of a single transaction, normalized away from
 * `@nimiq/core`'s wire format so `services/escrow.ts` never has to know
 * about the underlying chain library's types.
 */
export interface HouseWalletTransaction {
  txHash: string
  senderAddress: string
  recipientAddress: string
  valueLuna: number
  state: Nimiq.TransactionState
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
  /** How long to wait for the light client to establish consensus before giving up. */
  consensusTimeoutMs?: number
}

function toHouseWalletTransaction(tx: Nimiq.PlainTransactionDetails): HouseWalletTransaction {
  return {
    txHash: tx.transactionHash,
    senderAddress: tx.sender,
    recipientAddress: tx.recipient,
    valueLuna: tx.value,
    state: tx.state,
    confirmations: tx.confirmations ?? 0,
  }
}

/**
 * Connects a real Nimiq Albatross light client to **testnet only** and
 * wraps it as a `HouseWallet`. Nimiq has no general smart contracts — only
 * basic, vesting, and HTLC accounts, and an HTLC's recipient is fixed at
 * creation — so there is no trustless on-chain construct that can hold a
 * duel's stake until a winner is decided. This wallet, holding a real
 * private key server-side, is the custodial escrow by necessity: it
 * receives stakes and pays out winners/refunds directly.
 */
export async function createHouseWallet(options: CreateHouseWalletOptions): Promise<HouseWallet> {
  const { privateKeyHex, consensusTimeoutMs = 60_000 } = options

  const privateKey = Nimiq.PrivateKey.fromHex(privateKeyHex)
  const keyPair = Nimiq.KeyPair.derive(privateKey)
  const address = keyPair.toAddress()

  const config = new Nimiq.ClientConfiguration()
  config.network('testalbatross')
  const client = await Nimiq.Client.create(config.build())

  await Promise.race([
    client.waitForConsensusEstablished(),
    new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error('Timed out waiting for Nimiq testnet consensus')), consensusTimeoutMs)
    }),
  ])

  return {
    address: address.toUserFriendlyAddress(),

    async getBalance() {
      const account = await client.getAccount(address)
      return account.balance
    },

    async send(recipientAddress, valueLuna) {
      const recipient = Nimiq.Address.fromUserFriendlyAddress(recipientAddress)
      const headHeight = await client.getHeadHeight()
      const networkId = await client.getNetworkId()
      const tx = Nimiq.TransactionBuilder.newBasic(address, recipient, BigInt(valueLuna), null, headHeight, networkId)
      keyPair.signTransaction(tx)
      const details = await client.sendTransaction(tx)
      return toHouseWalletTransaction(details)
    },

    async getTransaction(txHash) {
      try {
        const details = await client.getTransaction(txHash)
        return toHouseWalletTransaction(details)
      }
      catch {
        return null
      }
    },

    async close() {
      await client.disconnectNetwork()
    },
  }
}
