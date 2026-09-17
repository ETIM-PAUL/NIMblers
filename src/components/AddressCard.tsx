import { useState } from 'react'
import { formatAddressShort } from '../lib/api'
import { Identicon } from './Identicon'

interface Props {
  address: string | null
  isLoading: boolean
  error: string | null
  onConnect: () => void
}

export function AddressCard({ address, isLoading, error, onConnect }: Props) {
  const [copied, setCopied] = useState(false)

  async function handleCopy() {
    if (!address) return
    try {
      await navigator.clipboard.writeText(address)
      setCopied(true)
      setTimeout(() => setCopied(false), 1200)
    }
    catch {
      // Clipboard access can fail quietly (permissions, insecure context) — the address is still visible either way.
    }
  }

  if (address) {
    return (
      <button type="button" className="wallet-chip" onClick={() => void handleCopy()} title={address}>
        <Identicon address={address} size={24} />
        <span className="wallet-chip-text">{copied ? 'Copied!' : formatAddressShort(address)}</span>
      </button>
    )
  }

  return (
    <>
      <button type="button" className="wallet-chip-connect" onClick={onConnect} disabled={isLoading}>
        {isLoading ? 'Connecting…' : 'Connect wallet'}
      </button>
      {error && <p className="address-card-error">{error}</p>}
    </>
  )
}
