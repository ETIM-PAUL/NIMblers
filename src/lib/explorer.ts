/** Nimiq's community block explorer — testnet, to match this app's "testnet only" rule (see CLAUDE.md). */
const EXPLORER_BASE_URL = 'https://test.nimiq.watch'

/** A link to a transaction (or block) on the testnet explorer — the site's router reads the hash straight off the URL fragment, no path segment needed. */
export function buildExplorerTxLink(txHash: string): string {
  return `${EXPLORER_BASE_URL}/#${txHash}`
}
