import { useCallback, useEffect, useState } from 'react'
import type { KeystrokeRun } from '../../shared/timingEngine'
import type { Difficulty } from '../lib/api'
import { DIFFICULTY_LABELS, errorMessage, fetchHouseAddress, formatAge, formatLuna, readJsonOrThrow } from '../lib/api'
import { Identicon } from './Identicon'
import { TypingEngine } from './TypingEngine'

interface Props {
  address: string
  sendPayment: (recipient: string, valueLuna: number) => Promise<string>
  /** Set when the app was opened via a private duel's shared link — skips browsing and jumps straight to that one entry. */
  presetEntryId?: string
}

interface OpenEntry {
  entryId: string
  creatorAddress: string
  stakeLuna: number
  difficulty: Difficulty
  createdAt: string
}

interface SettledReveal {
  outcome: 'creator' | 'challenger' | 'tie'
  creatorDurationMs: number
  challengerDurationMs: number
  deltaMs: number
  txHashes: string[]
}

type SubmitResult =
  | { pending: true, retryDeadline: string, retryStakeLuna: number }
  | ({ pending: false } & SettledReveal)

type Stage =
  | { name: 'browsing' }
  | { name: 'loading-invite' }
  | { name: 'invite', entry: OpenEntry }
  | { name: 'staking', entryId: string, creatorAddress: string }
  | { name: 'challenging', entryId: string, creatorAddress: string, stakeTxHash: string }
  | { name: 'typing', entryId: string, creatorAddress: string, paragraph: string }
  | { name: 'submitting', entryId: string, creatorAddress: string, paragraph: string }
  | { name: 'pending-retry', entryId: string, creatorAddress: string, paragraph: string, retryDeadline: string, retryStakeLuna: number }
  | { name: 'retry-staking', entryId: string, creatorAddress: string, paragraph: string }
  | { name: 'retry-typing', entryId: string, creatorAddress: string, paragraph: string, stakeTxHash: string }
  | { name: 'retry-submitting', entryId: string, creatorAddress: string }
  | { name: 'declining', entryId: string, creatorAddress: string }
  | { name: 'settled', reveal: SettledReveal, creatorAddress: string }
  | { name: 'error', message: string }

function formatSeconds(ms: number): string {
  return `${(ms / 1000).toFixed(2)}s`
}

export function ChallengeBrowser({ address, sendPayment, presetEntryId }: Props) {
  const [stage, setStage] = useState<Stage>(presetEntryId ? { name: 'loading-invite' } : { name: 'browsing' })
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

  useEffect(() => {
    if (!presetEntryId) return
    let cancelled = false
    fetch(`/api/entries/lookup?entryId=${encodeURIComponent(presetEntryId)}&exclude=${encodeURIComponent(address)}`)
      .then((res) => readJsonOrThrow(res, 'Could not load this duel'))
      .then((body) => {
        if (!cancelled) setStage({ name: 'invite', entry: body.entry as OpenEntry })
      })
      .catch((error: unknown) => {
        if (!cancelled) setStage({ name: 'error', message: errorMessage(error) })
      })
    return () => {
      cancelled = true
    }
  }, [presetEntryId, address])

  async function challenge(entryId: string, creatorAddress: string, stakeTxHash: string) {
    setStage({ name: 'challenging', entryId, creatorAddress, stakeTxHash })
    try {
      const res = await fetch('/api/entries/challenge', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ entryId, nimAddress: address, stakeTxHash }),
      })
      const body = await readJsonOrThrow(res, 'Could not take this bet')
      setStage({ name: 'typing', entryId, creatorAddress, paragraph: body.paragraphBody as string })
    }
    catch (error) {
      setStage({ name: 'error', message: errorMessage(error) })
    }
  }

  async function handleChallenge(entryId: string, stakeLuna: number, creatorAddress: string) {
    setStage({ name: 'staking', entryId, creatorAddress })
    try {
      const house = await fetchHouseAddress()
      const stakeTxHash = await sendPayment(house.address, stakeLuna)
      await challenge(entryId, creatorAddress, stakeTxHash)
    }
    catch (error) {
      setStage({ name: 'error', message: errorMessage(error) })
    }
  }

  function handleSubmitResult(creatorAddress: string, body: SubmitResult, fallback: { entryId: string, paragraph: string }) {
    if (body.pending) {
      setStage({
        name: 'pending-retry',
        entryId: fallback.entryId,
        creatorAddress,
        paragraph: fallback.paragraph,
        retryDeadline: body.retryDeadline,
        retryStakeLuna: body.retryStakeLuna,
      })
    }
    else {
      setStage({ name: 'settled', reveal: body, creatorAddress })
    }
  }

  async function handleSubmitRun(entryId: string, creatorAddress: string, paragraph: string, run: KeystrokeRun) {
    setStage({ name: 'submitting', entryId, creatorAddress, paragraph })
    try {
      const res = await fetch('/api/entries/challenge/submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ entryId, nimAddress: address, events: run.events }),
      })
      const body = await readJsonOrThrow(res, 'Could not submit your run')
      handleSubmitResult(creatorAddress, body as unknown as SubmitResult, { entryId, paragraph })
    }
    catch (error) {
      setStage({ name: 'error', message: errorMessage(error) })
    }
  }

  async function handleRetry(entryId: string, creatorAddress: string, paragraph: string, retryStakeLuna: number) {
    setStage({ name: 'retry-staking', entryId, creatorAddress, paragraph })
    try {
      const house = await fetchHouseAddress()
      const stakeTxHash = await sendPayment(house.address, retryStakeLuna)
      const res = await fetch('/api/entries/challenge/retry/stake', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ entryId, nimAddress: address, stakeTxHash }),
      })
      await readJsonOrThrow(res, 'Could not verify the retry stake')
      setStage({ name: 'retry-typing', entryId, creatorAddress, paragraph, stakeTxHash })
    }
    catch (error) {
      setStage({ name: 'error', message: errorMessage(error) })
    }
  }

  async function handleRetrySubmit(entryId: string, creatorAddress: string, stakeTxHash: string, run: KeystrokeRun) {
    setStage({ name: 'retry-submitting', entryId, creatorAddress })
    try {
      const res = await fetch('/api/entries/challenge/retry/submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ entryId, nimAddress: address, stakeTxHash, events: run.events }),
      })
      const body = await readJsonOrThrow(res, 'Could not submit your retry')
      setStage({ name: 'settled', reveal: body as unknown as SettledReveal, creatorAddress })
    }
    catch (error) {
      setStage({ name: 'error', message: errorMessage(error) })
    }
  }

  async function handleDecline(entryId: string, creatorAddress: string) {
    setStage({ name: 'declining', entryId, creatorAddress })
    try {
      const res = await fetch('/api/entries/challenge/decline-retry', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ entryId, nimAddress: address }),
      })
      const body = await readJsonOrThrow(res, 'Could not take the loss')
      setStage({ name: 'settled', reveal: body as unknown as SettledReveal, creatorAddress })
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
                <Identicon address={entry.creatorAddress} size={36} />
                <div className="entry-list-info">
                  <span className="entry-list-address">{entry.creatorAddress}</span>
                  <span className="entry-list-meta">
                    {DIFFICULTY_LABELS[entry.difficulty]} · {formatLuna(entry.stakeLuna)} · {formatAge(entry.createdAt)}
                  </span>
                </div>
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={() => void handleChallenge(entry.entryId, entry.stakeLuna, entry.creatorAddress)}
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

  if (stage.name === 'loading-invite') {
    return <p className="section-note">Loading this duel…</p>
  }

  if (stage.name === 'invite') {
    const { entry } = stage
    return (
      <div className="duel-panel">
        <p className="section-note-best">You've been challenged to a duel.</p>
        <ul className="entry-list">
          <li className="entry-list-item">
            <Identicon address={entry.creatorAddress} size={36} />
            <div className="entry-list-info">
              <span className="entry-list-address">{entry.creatorAddress}</span>
              <span className="entry-list-meta">
                {DIFFICULTY_LABELS[entry.difficulty]} · {formatLuna(entry.stakeLuna)} · {formatAge(entry.createdAt)}
              </span>
            </div>
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => void handleChallenge(entry.entryId, entry.stakeLuna, entry.creatorAddress)}
            >
              Challenge
            </button>
          </li>
        </ul>
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
        <p className="duel-warning">Closing this tab now forfeits your stake.</p>
        <TypingEngine
          paragraph={stage.paragraph}
          onSubmit={(run) => void handleSubmitRun(stage.entryId, stage.creatorAddress, stage.paragraph, run)}
        />
      </>
    )
  }

  if (stage.name === 'submitting') {
    return <p className="section-note">Submitting your run…</p>
  }

  if (stage.name === 'pending-retry') {
    const { entryId, creatorAddress, paragraph, retryDeadline, retryStakeLuna } = stage
    return (
      <div className="duel-panel">
        <p className="section-note">You didn't beat it. Retry or take the loss by {new Date(retryDeadline).toLocaleTimeString()}.</p>
        <button type="button" className="btn btn-rematch" onClick={() => void handleRetry(entryId, creatorAddress, paragraph, retryStakeLuna)}>
          Retry — stake {formatLuna(retryStakeLuna)}, double or nothing
        </button>
        <button type="button" className="btn btn-secondary" onClick={() => void handleDecline(entryId, creatorAddress)}>
          Take the loss
        </button>
      </div>
    )
  }

  if (stage.name === 'retry-staking') {
    return <p className="section-note">Confirm the retry stake in Nimiq Pay…</p>
  }

  if (stage.name === 'retry-typing') {
    return (
      <>
        <p className="duel-warning">Final attempt — settles the duel either way.</p>
        <TypingEngine
          paragraph={stage.paragraph}
          onSubmit={(run) => void handleRetrySubmit(stage.entryId, stage.creatorAddress, stage.stakeTxHash, run)}
        />
      </>
    )
  }

  if (stage.name === 'retry-submitting') {
    return <p className="section-note">Submitting your retry…</p>
  }

  if (stage.name === 'declining') {
    return <p className="section-note">Taking the loss…</p>
  }

  if (stage.name === 'settled') {
    const { reveal, creatorAddress } = stage
    const youWon = reveal.outcome === 'challenger'
    const headline = reveal.outcome === 'tie'
      ? "It's a tie — both stakes refunded in full."
      : youWon
        ? 'You won!'
        : 'You lost this one.'
    return (
      <div className="duel-panel">
        <p className={reveal.outcome === 'challenger' ? 'section-note-best' : 'section-note'}>{headline}</p>
        <div className="reveal-card">
          <div className="reveal-row">
            <span className="reveal-who"><Identicon address={creatorAddress} size={24} /> Opponent</span>
            <span>{formatSeconds(reveal.creatorDurationMs)}</span>
          </div>
          <div className="reveal-row">
            <span className="reveal-who"><Identicon address={address} size={24} /> You</span>
            <span>{formatSeconds(reveal.challengerDurationMs)}</span>
          </div>
          <div className="reveal-row">
            <span>Delta</span>
            <span>{formatSeconds(reveal.deltaMs)}</span>
          </div>
        </div>
        {reveal.txHashes.map((hash) => (
          <p key={hash} className="reveal-tx">{hash}</p>
        ))}
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
