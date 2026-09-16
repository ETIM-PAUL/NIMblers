import { useEffect, useState } from 'react'
import { errorMessage, formatLuna, readJsonOrThrow } from '../lib/api'
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
  if (entries.length === 0) return <p className="section-note">No winnings yet — be the first to win a duel.</p>

  return (
    <ol className="leaderboard-list">
      {entries.map((entry) => (
        <li key={entry.nimAddress} className="leaderboard-row">
          <span className="leaderboard-rank">#{entry.rank}</span>
          <Identicon address={entry.nimAddress} size={28} />
          <span className="leaderboard-address">{entry.nimAddress}</span>
          <span className="leaderboard-stats">
            <span className="leaderboard-winnings">{formatLuna(entry.totalWonLuna)}</span>
            <span className="leaderboard-wins">{entry.wins} win{entry.wins === 1 ? '' : 's'}</span>
          </span>
        </li>
      ))}
    </ol>
  )
}
