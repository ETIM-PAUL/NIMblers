import { useEffect, useState } from 'react'
import { errorMessage, formatAddressShort, formatLuna, readJsonOrThrow } from '../lib/api'
import { BoardIcon } from './NavIcons'
import { EmptyState } from './EmptyState'
import { Identicon } from './Identicon'

interface LeaderboardEntry {
  rank: number
  nimAddress: string
  totalWonLuna: number
  wins: number
}

export function Leaderboard() {
  const [entries, setEntries] = useState<LeaderboardEntry[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    fetch('/api/leaderboard')
      .then((res) => readJsonOrThrow(res, 'Could not load the leaderboard'))
      .then((body) => {
        if (!cancelled) setEntries(body.leaderboard as LeaderboardEntry[])
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(errorMessage(err))
      })
    return () => {
      cancelled = true
    }
  }, [])

  if (error) return <p className="address-card-error">{error}</p>
  if (entries === null) return <p className="section-note">Loading leaderboard…</p>
  if (entries.length === 0) {
    return (
      <EmptyState
        icon={<BoardIcon />}
        title="No winners this week"
        subtitle="Be the first to win a duel and claim the top spot. Resets every Monday 00:00 UTC."
      />
    )
  }

  return (
    <>
      <p className="section-note">This week's winners — resets Monday 00:00 UTC.</p>
      <ol className="leaderboard-list">
        {entries.map((entry) => (
          <li key={entry.nimAddress} className={`leaderboard-row ${entry.rank <= 3 ? `leaderboard-row-${entry.rank}` : ''}`}>
            <span className={`leaderboard-medal ${entry.rank <= 3 ? `leaderboard-medal-${entry.rank}` : ''}`}>{entry.rank}</span>
            <Identicon address={entry.nimAddress} size={28} />
            <span className="leaderboard-address" title={entry.nimAddress}>{formatAddressShort(entry.nimAddress)}</span>
            <span className="leaderboard-stats">
              <span className="leaderboard-winnings">{formatLuna(entry.totalWonLuna)}</span>
              <span className="leaderboard-wins">{entry.wins} win{entry.wins === 1 ? '' : 's'}</span>
            </span>
          </li>
        ))}
      </ol>
    </>
  )
}
