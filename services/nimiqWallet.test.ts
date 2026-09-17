import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import type { IncomingMessage, Server, ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { after, before, beforeEach, test } from 'node:test'
import * as Nimiq from '@nimiq/core'
import { createHouseWallet, RpcError } from './nimiqWallet.ts'

/**
 * `@nimiq/core`'s v2 P2P light client (`Client.create()`) doesn't work
 * under Node.js — see nimiqWallet.ts's doc comment and
 * nimiq/core-rs-albatross#3417 — so this module talks to a Nimiq node
 * over plain JSON-RPC instead. That makes it fully testable without a
 * real network: this file stands up a tiny local HTTP server that speaks
 * the same JSON-RPC contract a real node would, and drives the wallet
 * against it — proving the request/response wire format, transaction
 * signing, and error handling are all correct, with nothing to mock at
 * the `HouseWallet` interface level (unlike server-side callers, which
 * always test against a fake `HouseWallet` — this is what proves that
 * fake's contract is actually implementable for real).
 */

const TEST_PRIVATE_KEY = Nimiq.PrivateKey.generate().toHex()
const TEST_ADDRESS = Nimiq.KeyPair.derive(Nimiq.PrivateKey.fromHex(TEST_PRIVATE_KEY)).toAddress().toUserFriendlyAddress()
// A real (but unrelated) address — Address.fromUserFriendlyAddress checksum-validates its input for real, unlike the loosely-typed fake addresses used elsewhere in this codebase's server-side tests.
const RECIPIENT_ADDRESS = Nimiq.KeyPair.derive(Nimiq.PrivateKey.generate()).toAddress().toUserFriendlyAddress()

type RpcHandler = (method: string, params: unknown[]) => unknown

let server: Server
let baseUrl: string
let handler: RpcHandler
let receivedAuthHeader: string | undefined
let lastRawTransactionHex: string | undefined

function defaultHandler(method: string): unknown {
  if (method === 'getAccountByAddress') return { address: TEST_ADDRESS, balance: 5_000_000 }
  if (method === 'getBlockNumber') return 1234
  if (method === 'sendRawTransaction') return 'fake-tx-hash'
  if (method === 'getTransactionByHash') return null
  throw new Error(`unexpected RPC method in test: ${method}`)
}

before(async () => {
  server = createServer((req: IncomingMessage, res: ServerResponse) => {
    receivedAuthHeader = req.headers.authorization
    const chunks: Buffer[] = []
    req.on('data', (chunk: Buffer) => chunks.push(chunk))
    req.on('end', () => {
      const body = JSON.parse(Buffer.concat(chunks).toString('utf-8')) as { method: string, params: unknown[], id: number }
      if (body.method === 'sendRawTransaction') lastRawTransactionHex = body.params[0] as string
      try {
        const data = handler(body.method, body.params)
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ jsonrpc: '2.0', id: body.id, result: { data, metadata: null } }))
      }
      catch (error) {
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ jsonrpc: '2.0', id: body.id, error: { message: error instanceof Error ? error.message : String(error) } }))
      }
    })
  })
  await new Promise<void>((resolve) => server.listen(0, resolve))
  const { port } = server.address() as AddressInfo
  baseUrl = `http://localhost:${port}`
})

beforeEach(() => {
  handler = defaultHandler
  receivedAuthHeader = undefined
  lastRawTransactionHex = undefined
})

after(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()))
})

test('createHouseWallet derives the correct address from the private key, with no RPC call needed', async () => {
  const wallet = await createHouseWallet({ privateKeyHex: TEST_PRIVATE_KEY, rpcUrl: baseUrl })
  assert.equal(wallet.address, TEST_ADDRESS)
})

test('getBalance reads the account balance over RPC', async () => {
  handler = (method) => (method === 'getAccountByAddress' ? { address: TEST_ADDRESS, balance: 42_000 } : defaultHandler(method))
  const wallet = await createHouseWallet({ privateKeyHex: TEST_PRIVATE_KEY, rpcUrl: baseUrl })
  assert.equal(await wallet.getBalance(), 42_000)
})

test('send builds, signs, and broadcasts a real transaction — the raw hex sent to sendRawTransaction verifies as a valid signed transaction for this exact sender, recipient, and value', async () => {
  const wallet = await createHouseWallet({ privateKeyHex: TEST_PRIVATE_KEY, rpcUrl: baseUrl })
  const result = await wallet.send(RECIPIENT_ADDRESS, 250_000)

  assert.equal(result.txHash, 'fake-tx-hash')
  assert.equal(result.senderAddress, TEST_ADDRESS)
  assert.equal(result.recipientAddress, RECIPIENT_ADDRESS)
  assert.equal(result.valueLuna, 250_000)
  assert.equal(result.state, 'pending')

  assert.ok(lastRawTransactionHex, 'expected sendRawTransaction to have been called with the signed hex')
  const tx = Nimiq.Transaction.fromAny(lastRawTransactionHex!)
  assert.equal(tx.sender.toUserFriendlyAddress(), TEST_ADDRESS)
  assert.equal(tx.recipient.toUserFriendlyAddress(), RECIPIENT_ADDRESS)
  assert.equal(tx.value, 250_000n)
  assert.equal(tx.networkId, 5, 'must be signed for TestAlbatross (NetworkId 5)')
})

test('send uses the current block height (from getBlockNumber) as the validity start height', async () => {
  handler = (method) => (method === 'getBlockNumber' ? 999_999 : defaultHandler(method))
  const wallet = await createHouseWallet({ privateKeyHex: TEST_PRIVATE_KEY, rpcUrl: baseUrl })
  await wallet.send(RECIPIENT_ADDRESS, 1000)

  const tx = Nimiq.Transaction.fromAny(lastRawTransactionHex!)
  assert.equal(tx.validityStartHeight, 999_999)
})

test('getTransaction returns null when the transaction is not found', async () => {
  handler = (method) => (method === 'getTransactionByHash' ? null : defaultHandler(method))
  const wallet = await createHouseWallet({ privateKeyHex: TEST_PRIVATE_KEY, rpcUrl: baseUrl })
  assert.equal(await wallet.getTransaction('does-not-exist'), null)
})

test('getTransaction normalizes a flat transaction result', async () => {
  handler = (method) =>
    method === 'getTransactionByHash'
      ? { hash: 'tx-1', blockNumber: 42, confirmations: 3, from: TEST_ADDRESS, to: RECIPIENT_ADDRESS, value: 5000 }
      : defaultHandler(method)
  const wallet = await createHouseWallet({ privateKeyHex: TEST_PRIVATE_KEY, rpcUrl: baseUrl })
  const tx = await wallet.getTransaction('tx-1')
  assert.deepEqual(tx, {
    txHash: 'tx-1',
    senderAddress: TEST_ADDRESS,
    recipientAddress: RECIPIENT_ADDRESS,
    relatedAddresses: [TEST_ADDRESS, RECIPIENT_ADDRESS],
    valueLuna: 5000,
    state: 'confirmed',
    confirmations: 3,
  })
})

test('getTransaction passes through relatedAddresses from the RPC node as-is, instead of just [from, to]', async () => {
  // Nimiq Pay routes mini-app payments through a short-lived HTLC, so the
  // real node's relatedAddresses for such a transaction includes the
  // player's own address even though it isn't the on-chain sender or
  // recipient of this particular transaction.
  const htlcAddress = 'NQ11 HTLC AAAA AAAA AAAA AAAA AAAA AAAA AAAA'
  handler = (method) =>
    method === 'getTransactionByHash'
      ? {
          hash: 'tx-htlc',
          blockNumber: 42,
          confirmations: 3,
          from: htlcAddress,
          to: RECIPIENT_ADDRESS,
          value: 5000,
          relatedAddresses: [TEST_ADDRESS, htlcAddress, RECIPIENT_ADDRESS],
        }
      : defaultHandler(method)
  const wallet = await createHouseWallet({ privateKeyHex: TEST_PRIVATE_KEY, rpcUrl: baseUrl })
  const tx = await wallet.getTransaction('tx-htlc')
  assert.deepEqual(tx?.relatedAddresses, [TEST_ADDRESS, htlcAddress, RECIPIENT_ADDRESS])
  assert.equal(tx?.senderAddress, htlcAddress, 'senderAddress stays the literal on-chain sender, not a related party')
})

test('getTransaction normalizes a nested { transaction: {...} } result the same way', async () => {
  handler = (method) =>
    method === 'getTransactionByHash'
      ? { transaction: { hash: 'tx-2', blockNumber: 10, from: TEST_ADDRESS, to: RECIPIENT_ADDRESS, value: 1 }, executionResult: true }
      : defaultHandler(method)
  const wallet = await createHouseWallet({ privateKeyHex: TEST_PRIVATE_KEY, rpcUrl: baseUrl })
  const tx = await wallet.getTransaction('tx-2')
  assert.equal(tx?.txHash, 'tx-2')
  assert.equal(tx?.state, 'included', 'blockNumber present but no confirmations yet — included, not yet confirmed')
})

test('getTransaction reports pending for a transaction with no blockNumber yet', async () => {
  handler = (method) =>
    method === 'getTransactionByHash'
      ? { hash: 'tx-3', from: TEST_ADDRESS, to: RECIPIENT_ADDRESS, value: 1 }
      : defaultHandler(method)
  const wallet = await createHouseWallet({ privateKeyHex: TEST_PRIVATE_KEY, rpcUrl: baseUrl })
  const tx = await wallet.getTransaction('tx-3')
  assert.equal(tx?.state, 'pending')
})

test('an RPC-level error surfaces as a clear RpcError instead of a confusing downstream failure', async () => {
  handler = () => {
    throw new Error('block not found')
  }
  const wallet = await createHouseWallet({ privateKeyHex: TEST_PRIVATE_KEY, rpcUrl: baseUrl })
  await assert.rejects(() => wallet.getBalance(), (error: unknown) => {
    assert.ok(error instanceof RpcError)
    assert.match(error.message, /block not found/)
    return true
  })
})

test('an unreachable RPC node surfaces a clear error naming the URL', async () => {
  const wallet = await createHouseWallet({ privateKeyHex: TEST_PRIVATE_KEY, rpcUrl: 'http://localhost:1' })
  await assert.rejects(() => wallet.getBalance(), (error: unknown) => {
    assert.ok(error instanceof RpcError)
    assert.match(error.message, /localhost:1/)
    return true
  })
})

test('sends HTTP Basic Auth when RPC credentials are configured, and none when they are not', async () => {
  const withAuth = await createHouseWallet({ privateKeyHex: TEST_PRIVATE_KEY, rpcUrl: baseUrl, rpcUsername: 'alice', rpcPassword: 'secret' })
  await withAuth.getBalance()
  assert.equal(receivedAuthHeader, `Basic ${Buffer.from('alice:secret').toString('base64')}`)

  const withoutAuth = await createHouseWallet({ privateKeyHex: TEST_PRIVATE_KEY, rpcUrl: baseUrl })
  await withoutAuth.getBalance()
  assert.equal(receivedAuthHeader, undefined)
})

test('close() resolves without needing to tear down any connection', async () => {
  const wallet = await createHouseWallet({ privateKeyHex: TEST_PRIVATE_KEY, rpcUrl: baseUrl })
  await wallet.close()
})
