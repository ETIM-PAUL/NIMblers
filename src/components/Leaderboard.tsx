import { useCallback, useEffect, useState } from 'react'
import type { LeaderboardEntry, LeaderboardScope } from '../lib/api'
import { errorMessage, fetchLeaderboard, formatAddressShort, formatLuna } from '../lib/api'
import { BoardIcon } from './NavIcons'
import { EmptyState } from './EmptyState'
import { Identicon } from './Identicon'

/** Weekly is a fast-moving "who's hot right now" snapshot — 5 keeps it skimmable. All-time is a hall of fame players might actually want to scroll a bit further into. */
const LIMIT_BY_SCOPE: Record<LeaderboardScope, number> = { weekly: 5, 'all-time': 10 }

export function Leaderboard() {
  const [scope, setScope] = useState<LeaderboardScope>('weekly')
  const [entries, setEntries] = useState<LeaderboardEntry[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async (nextScope: LeaderboardScope) => {
    try {
      setEntries(await fetchLeaderboard(nextScope, LIMIT_BY_SCOPE[nextScope]))
      setError(null)
    }
    catch (err) {
      setError(errorMessage(err))
    }
  }, [])

  useEffect(() => {
    setEntries(null)
    void load(scope)
  }, [scope, load])

  return (
    <>
      <div className="visibility-picker">
        <button
          type="button"
          className={`btn btn-toggle ${scope === 'weekly' ? 'btn-toggle-active' : ''}`}
          onClick={() => setScope('weekly')}
        >
          This week
        </button>
        <button
          type="button"
          className={`btn btn-toggle ${scope === 'all-time' ? 'btn-toggle-active' : ''}`}
          onClick={() => setScope('all-time')}
        >
          All time
        </button>
      </div>
      <button type="button" className="btn btn-secondary refresh-btn" onClick={() => void load(scope)}>
        Refresh
      </button>

      {error && <p className="address-card-error">{error}</p>}
      {entries === null && !error && <p className="section-note">Loading leaderboard…</p>}
      {entries !== null && entries.length === 0 && (
        <EmptyState
          icon={<BoardIcon />}
          title={scope === 'weekly' ? 'No winners this week' : 'No winners yet'}
          subtitle={
            scope === 'weekly'
              ? 'Be the first to win a duel and claim the top spot. Resets every Monday 00:00 UTC.'
              : 'Every NIM ever won will show up here, permanently.'
          }
        />
      )}
      {entries !== null && entries.length > 0 && (
        <>
          <p className="section-note">
            {scope === 'weekly' ? "This week's winners — resets Monday 00:00 UTC." : 'Every NIM ever won, all-time.'}
          </p>
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
      )}
    </>
  )
}
