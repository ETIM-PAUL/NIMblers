import { useEffect, useState } from 'react'
import type { DuelHistoryEntry, DuelHistoryResult, EarnedBadge } from '../lib/api'
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

function BadgeRow({ badges }: { badges: EarnedBadge[] }) {
  if (badges.length === 0) return null
  return (
    <div className="badge-row">
      {badges.map((badge) => (
        <span key={badge.id} className="badge-pill" title={badge.description}>
          {badge.label}
        </span>
      ))}
    </div>
  )
}

export function DuelHistory({ address }: Props) {
  const [result, setResult] = useState<DuelHistoryResult | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    fetchDuelHistory(address)
      .then((res) => { if (!cancelled) setResult(res) })
      .catch((err: unknown) => { if (!cancelled) setError(errorMessage(err)) })
    return () => {
      cancelled = true
    }
  }, [address])

  if (error) return <p className="address-card-error">{error}</p>
  if (result === null) return <p className="section-note">Loading your history…</p>
  if (result.history.length === 0) {
    return <EmptyState icon={<HistoryIcon />} title="No finished duels yet" subtitle="Wins, losses, and ties will show up here once a duel settles." />
  }

  return (
    <>
      <BadgeRow badges={result.badges} />
      <ul className="entry-list">
        {result.history.map((entry) => (
          <li key={entry.entryId} className="entry-list-item entry-list-item-column">
            <div className="entry-list-info">
              <span className="entry-list-meta">
                <DifficultyChip difficulty={entry.difficulty} /> {formatLuna(entry.stakeLuna)} · {formatAge(entry.settledAt)}
                {entry.flawless && entry.outcome === 'won' && <span className="badge-pill badge-pill-inline" title="Won without a single correction">Flawless</span>}
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
    </>
  )
}
