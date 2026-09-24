import { useEffect, useState } from 'react'
import type { WeakKeyStat } from '../lib/api'
import { fetchWeakKeys } from '../lib/api'

interface Props {
  address: string
}

/** A space is a real, trackable "key" in the data but invisible if rendered literally. */
function displayKey(key: string): string {
  return key === ' ' ? 'Space' : key
}

const MAX_ROWS = 8

/**
 * The characters this player most often types wrong and then corrects,
 * ranked by how often — see server/runs/weakKeys.ts for how that's
 * computed. Purely a nice-to-have on top of the history list: any failure
 * to load it (or genuinely not having enough data yet) just means the card
 * doesn't render, rather than competing with History's own loading/error
 * states for attention.
 */
export function WeakKeysCard({ address }: Props) {
  const [weakKeys, setWeakKeys] = useState<WeakKeyStat[] | null>(null)

  useEffect(() => {
    let cancelled = false
    fetchWeakKeys(address)
      .then((keys) => { if (!cancelled) setWeakKeys(keys) })
      .catch(() => { if (!cancelled) setWeakKeys([]) })
    return () => {
      cancelled = true
    }
  }, [address])

  if (weakKeys === null || weakKeys.length === 0) return null

  const shown = weakKeys.slice(0, MAX_ROWS)
  const maxRate = Math.max(...shown.map((k) => k.mistakeRate))

  return (
    <div className="weak-keys-card">
      <p className="weak-keys-title">Your weak keys</p>
      <ul className="weak-keys-list">
        {shown.map((k) => (
          <li key={k.key} className="weak-keys-row">
            <span className="weak-keys-key">{displayKey(k.key)}</span>
            <div className="weak-keys-bar-track">
              <div className="weak-keys-bar-fill" style={{ width: `${(k.mistakeRate / maxRate) * 100}%` }} />
            </div>
            <span className="weak-keys-rate">{Math.round(k.mistakeRate * 100)}%</span>
          </li>
        ))}
      </ul>
    </div>
  )
}
