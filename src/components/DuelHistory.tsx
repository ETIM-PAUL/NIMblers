import { useEffect, useState } from 'react'
import type { DuelHistoryEntry } from '../lib/api'
import { errorMessage, fetchDuelHistory, formatAddressShort, formatAge, formatLuna, formatSeconds } from '../lib/api'
import { DifficultyChip } from './DifficultyChip'
import { EmptyState } from './EmptyState'
import { HistoryIcon } from './NavIcons'

interface Props {
  address: string
}

function outcomeLabel(outcome: DuelHistoryEntry['outcome']): string {
  if (outcome === 'won') return 'Won'
  if (outcome === 'lost') return 'Lost'
  return 'Tied'
}

export function DuelHistory({ address }: Props) {
  const [entries, setEntries] = useState<DuelHistoryEntry[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    fetchDuelHistory(address)
      .then((history) => { if (!cancelled) setEntries(history) })
      .catch((err: unknown) => { if (!cancelled) setError(errorMessage(err)) })
    return () => {
      cancelled = true
    }
  }, [address])

  if (error) return <p className="address-card-error">{error}</p>
  if (entries === null) return <p className="section-note">Loading your history…</p>
  if (entries.length === 0) {
    return <EmptyState icon={<HistoryIcon />} title="No finished duels yet" subtitle="Wins, losses, and ties will show up here once a duel settles." />
  }

  return (
    <ul className="entry-list">
      {entries.map((entry) => (
        <li key={entry.entryId} className="entry-list-item entry-list-item-column">
          <div className="entry-list-info">
            <span className="entry-list-meta">
              <DifficultyChip difficulty={entry.difficulty} /> {formatLuna(entry.stakeLuna)} · {formatAge(entry.settledAt)}
            </span>
            <span className={`my-entry-status my-entry-status-${entry.outcome === 'won' ? 'won' : entry.outcome === 'lost' ? 'lost' : 'neutral'}`}>
              {outcomeLabel(entry.outcome)} · vs {formatAddressShort(entry.opponentAddress)}
            </span>
            <span className="history-times">
              You {formatSeconds(entry.myDurationMs)} · Opponent {formatSeconds(entry.opponentDurationMs)} · Δ {formatSeconds(entry.deltaMs)}
            </span>
          </div>
        </li>
      ))}
    </ul>
  )
}
