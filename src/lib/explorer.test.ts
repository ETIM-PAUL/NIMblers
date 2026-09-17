import assert from 'node:assert/strict'
import { test } from 'node:test'
import { buildExplorerTxLink } from './explorer.ts'

test('buildExplorerTxLink points at the testnet explorer with the hash as a URL fragment', () => {
  const hash = '44afa914586d7161c2f04a29c37be595d2beb74be7a96c9765089dab151ea141'
  assert.equal(buildExplorerTxLink(hash), `https://test.nimiq.watch/#${hash}`)
})
