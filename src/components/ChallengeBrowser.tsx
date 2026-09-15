import { useCallback, useEffect, useState } from 'react'
import type { KeystrokeRun } from '../../shared/timingEngine'
import { errorMessage, fetchHouseAddress, formatAge, formatLuna, readJsonOrThrow } from '../lib/api'
import { TypingEngine } from './TypingEngine'

interface Props {
  address: string
  sendPayment: (recipient: string, valueLuna: number) => Promise<string>
}

interface OpenEntry {
  entryId: string
  creatorAddress: string
  stakeLuna: number
  createdAt: string
}

type Stage =
  | { name: 'browsing' }
  | { name: 'staking', entryId: string }
  | { name: 'challenging', entryId: string, stakeTxHash: string }
  | { name: 'typing', entryId: string, paragraph: string }
  | { name: 'submitting', entryId: string }
  | { name: 'submitted' }
  | { name: 'error', message: string }

export function ChallengeBrowser({ address, sendPayment }: Props) {
  const [stage, setStage] = useState<Stage>({ name: 'browsing' })
  const [entries, setEntries] = useState<OpenEntry[] | null>(null)
  const [listError, setListError] = useState<string | null>(null)

  const loadEntries = useCallback(async () => {
    try {
      const res = await fetch(`/api/entries?exclude=${encodeURIComponent(address)}`)
      const body = await readJsonOrThrow(res, 'Could not load open duels')
      setEntries(body.entries as OpenEntry[])
      setListError(null)
    }
    catch (error) {
      setListError(errorMessage(error))
    }
  }, [address])

  useEffect(() => {
    if (stage.name === 'browsing') void loadEntries()
  }, [stage.name, loadEntries])

  async function challenge(entryId: string, stakeTxHash: string) {
    setStage({ name: 'challenging', entryId, stakeTxHash })
    try {
      const res = await fetch('/api/entries/challenge', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ entryId, nimAddress: address, stakeTxHash }),
      })
      const body = await readJsonOrThrow(res, 'Could not take this bet')
      setStage({ name: 'typing', entryId, paragraph: body.paragraphBody as string })
    }
    catch (error) {
      setStage({ name: 'error', message: errorMessage(error) })
    }
  }

  async function handleChallenge(entryId: string, stakeLuna: number) {
    setStage({ name: 'staking', entryId })
    try {
      const house = await fetchHouseAddress()
      const stakeTxHash = await sendPayment(house.address, stakeLuna)
      await challenge(entryId, stakeTxHash)
    }
    catch (error) {
      setStage({ name: 'error', message: errorMessage(error) })
    }
  }

  async function handleSubmitRun(entryId: string, run: KeystrokeRun) {
    setStage({ name: 'submitting', entryId })
    try {
      const res = await fetch('/api/entries/challenge/submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ entryId, nimAddress: address, events: run.events }),
      })
      await readJsonOrThrow(res, 'Could not submit your run')
      setStage({ name: 'submitted' })
    }
    catch (error) {
      setStage({ name: 'error', message: errorMessage(error) })
    }
  }

  if (stage.name === 'browsing') {
    return (
      <div className="duel-panel">
        {listError && <p className="address-card-error">{listError}</p>}
        {entries === null && !listError && <p className="section-note">Loading open duels…</p>}
        {entries !== null && entries.length === 0 && <p className="section-note">No open duels right now — check back soon.</p>}
        {entries !== null && entries.length > 0 && (
          <ul className="entry-list">
            {entries.map((entry) => (
              <li key={entry.entryId} className="entry-list-item">
                <div className="entry-list-info">
                  <span className="entry-list-address">{entry.creatorAddress}</span>
                  <span className="entry-list-meta">{formatLuna(entry.stakeLuna)} · {formatAge(entry.createdAt)}</span>
                </div>
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={() => void handleChallenge(entry.entryId, entry.stakeLuna)}
                >
                  Challenge
                </button>
              </li>
            ))}
          </ul>
        )}
        <button type="button" className="btn btn-secondary" onClick={() => void loadEntries()}>
          Refresh
        </button>
      </div>
    )
  }

  if (stage.name === 'staking') {
    return <p className="section-note">Confirm the payment in Nimiq Pay…</p>
  }

  if (stage.name === 'challenging') {
    return <p className="section-note">Locking in your challenge…</p>
  }

  if (stage.name === 'typing') {
    return (
      <>
        <p className="duel-warning">
          Closing this tab now forfeits your stake — finish typing to lock in your run. Your opponent's
          time stays hidden from you the whole time.
        </p>
        <TypingEngine
          paragraph={stage.paragraph}
          onSubmit={(run) => void handleSubmitRun(stage.entryId, run)}
        />
      </>
    )
  }

  if (stage.name === 'submitting') {
    return <p className="section-note">Submitting your run…</p>
  }

  if (stage.name === 'submitted') {
    return (
      <div className="duel-panel">
        <p className="section-note-best">Run submitted!</p>
        <p className="section-note">Results aren't settled yet — that's coming in a later phase.</p>
        <button type="button" className="btn btn-secondary" onClick={() => setStage({ name: 'browsing' })}>
          Back to open duels
        </button>
      </div>
    )
  }

  return (
    <div className="duel-panel">
      <p className="address-card-error">{stage.message}</p>
      <button type="button" className="btn btn-primary" onClick={() => setStage({ name: 'browsing' })}>
        Back to open duels
      </button>
    </div>
  )
}
