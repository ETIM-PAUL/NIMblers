import { Identicon } from './Identicon'

interface Props {
  address: string | null
  isLoading: boolean
  error: string | null
  onConnect: () => void
}

export function AddressCard({ address, isLoading, error, onConnect }: Props) {
  if (address) {
    return (
      <div className="address-card">
        <Identicon address={address} size={56} />
        <span className="address-card-label">Your NIM address</span>
        <span className="address-card-value">{address}</span>
      </div>
    )
  }

  return (
    <div className="address-card">
      <button type="button" className="btn btn-primary" onClick={onConnect} disabled={isLoading}>
        {isLoading ? 'Connecting…' : 'Show my address'}
      </button>
      {error && <p className="address-card-error">{error}</p>}
    </div>
  )
}
