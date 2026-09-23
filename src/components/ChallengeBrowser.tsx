import { useCallback, useEffect, useRef, useState } from 'react'
import type { KeystrokeRun } from '../../shared/timingEngine'
import type { Difficulty, Language, MyEntry } from '../lib/api'
import { buildDuelDeepLink, errorMessage, fetchHouseAddress, fetchMyEntries, formatAge, formatLuna, formatSeconds, readJsonOrThrow } from '../lib/api'
import { copyText } from '../lib/clipboard'
import { parseDuelEntryId } from '../lib/duelLink'
import { buildExplorerTxLink } from '../lib/explorer'
import { DifficultyChip } from './DifficultyChip'
import { EmptyState } from './EmptyState'
import { Identicon } from './Identicon'
import { LanguageChip } from './LanguageChip'
import { BoardIcon, OpenIcon } from './NavIcons'
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
  language: Language
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

/** The creator's-eye view of one of their own entries — a status pill's text and color modifier. */
function myEntryStatus(entry: MyEntry): { label: string, modifier: string } {
  if (entry.status === 'OPEN') return { label: 'Waiting for a challenger', modifier: 'waiting' }
  if (entry.status === 'LOCKED') {
    return { label: `Being played${entry.challengerAddress ? ` — vs ${entry.challengerAddress}` : ''}`, modifier: 'playing' }
  }
  if (entry.status === 'EXPIRED') return { label: 'Expired — refunded', modifier: 'neutral' }
  // SETTLED
  if (entry.outcome === 'creator') return { label: 'You won', modifier: 'won' }
  if (entry.outcome === 'challenger') return { label: 'You lost', modifier: 'lost' }
  return { label: 'Tied — refunded', modifier: 'neutral' }
}

export function ChallengeBrowser({ address, sendPayment, presetEntryId }: Props) {
  const [stage, setStage] = useState<Stage>(presetEntryId ? { name: 'loading-invite' } : { name: 'browsing' })
  const [browseTab, setBrowseTab] = useState<'open' | 'mine'>('open')
  const [entries, setEntries] = useState<OpenEntry[] | null>(null)
  const [listError, setListError] = useState<string | null>(null)
  const [myEntries, setMyEntries] = useState<MyEntry[] | null>(null)
  const [myEntriesError, setMyEntriesError] = useState<string | null>(null)
  const [pastedLink, setPastedLink] = useState('')
  const [pastedLinkError, setPastedLinkError] = useState<string | null>(null)
  const [copiedEntryId, setCopiedEntryId] = useState<string | null>(null)
  const [houseAddress, setHouseAddress] = useState<string | null>(null)
  const copyFallbackRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    fetchHouseAddress().then((info) => setHouseAddress(info.address)).catch(() => {
      // handleChallenge/handleRetry fetch this again if it's still missing
      // when the user actually taps — this is just a warm cache.
    })
  }, [])

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

  const loadMyEntries = useCallback(async () => {
    try {
      setMyEntries(await fetchMyEntries(address))
      setMyEntriesError(null)
    }
    catch (error) {
      setMyEntriesError(errorMessage(error))
    }
  }, [address])

  useEffect(() => {
    if (stage.name !== 'browsing') return
    if (browseTab === 'open') void loadEntries()
    else void loadMyEntries()
  }, [stage.name, browseTab, loadEntries, loadMyEntries])

  const loadInvite = useCallback(async (entryId: string) => {
    setStage({ name: 'loading-invite' })
    try {
      const res = await fetch(`/api/entries/lookup?entryId=${encodeURIComponent(entryId)}&exclude=${encodeURIComponent(address)}`)
      const body = await readJsonOrThrow(res, 'Could not load this duel')
      setStage({ name: 'invite', entry: body.entry as OpenEntry })
    }
    catch (error) {
      setStage({ name: 'error', message: errorMessage(error) })
    }
  }, [address])

  useEffect(() => {
    // ChallengeBrowser only mounts once `address` is connected, and
    // `presetEntryId` is fixed at App's initial render — both are stable
    // for this component's whole lifetime, so this is only ever meant to
    // run once, for the link this component was opened with.
    if (presetEntryId) void loadInvite(presetEntryId)
  }, [presetEntryId, loadInvite])

  function backToOpenDuels() {
    setPastedLink('')
    setPastedLinkError(null)
    setStage({ name: 'browsing' })
  }

  async function handleCopyMyEntryLink(entryId: string) {
    const link = buildDuelDeepLink(entryId)
    const input = copyFallbackRef.current
    if (input) input.value = link
    const copied = await copyText(link, input)
    setCopiedEntryId(copied ? entryId : null)
    if (copied) setTimeout(() => setCopiedEntryId((current) => (current === entryId ? null : current)), 1200)
  }

  // A duel link's clickability depends on whatever app it's shared
  // through, so pasting the link (or just the code) back in is the
  // reliable fallback way to reach a private duel.
  function handleFindDuel() {
    const entryId = parseDuelEntryId(pastedLink)
    if (!entryId) {
      setPastedLinkError("That doesn't look like a duel link or code.")
      return
    }
    setPastedLinkError(null)
    void loadInvite(entryId)
  }

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
      // Use the address already fetched on mount rather than awaiting a
      // fresh network call here — an `await` sitting between this tap and
      // sendPayment() (which needs to pop a native confirmation sheet) can
      // cost the click its "this came from a real tap" standing in some
      // WebViews, leaving the sheet stuck never appearing.
      const recipient = houseAddress ?? (await fetchHouseAddress()).address
      const stakeTxHash = await sendPayment(recipient, stakeLuna)
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
      const recipient = houseAddress ?? (await fetchHouseAddress()).address
      const stakeTxHash = await sendPayment(recipient, retryStakeLuna)
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
        <input ref={copyFallbackRef} readOnly className="visually-hidden-input copy-fallback-input" tabIndex={-1} aria-hidden="true" />
        <div className="find-duel">
          <input
            className="find-duel-input share-link-input"
            placeholder="Paste a private duel link or code"
            value={pastedLink}
            onChange={(e) => { setPastedLink(e.target.value); setPastedLinkError(null) }}
            onKeyDown={(e) => { if (e.key === 'Enter') handleFindDuel() }}
          />
          <button type="button" className="btn btn-tinted" onClick={handleFindDuel} disabled={!pastedLink.trim()}>
            Find
          </button>
        </div>
        {pastedLinkError && <p className="address-card-error">{pastedLinkError}</p>}

        <div className="visibility-picker">
          <button
            type="button"
            className={`btn btn-toggle ${browseTab === 'open' ? 'btn-toggle-active' : ''}`}
            onClick={() => setBrowseTab('open')}
          >
            Open duels
          </button>
          <button
            type="button"
            className={`btn btn-toggle ${browseTab === 'mine' ? 'btn-toggle-active' : ''}`}
            onClick={() => setBrowseTab('mine')}
          >
            My duels
          </button>
        </div>

        {browseTab === 'open' && (
          <>
            <button type="button" className="btn btn-secondary refresh-btn" onClick={() => void loadEntries()}>
              Refresh
            </button>
            {listError && <p className="address-card-error">{listError}</p>}
            {entries === null && !listError && <p className="section-note">Loading open duels…</p>}
            {entries !== null && entries.length === 0 && (
              <EmptyState icon={<OpenIcon />} title="No open duels right now" subtitle="Check back soon, or create one yourself." />
            )}
            {entries !== null && entries.length > 0 && (
              <ul className="entry-list">
                {entries.map((entry) => (
                  <li key={entry.entryId} className="entry-list-item">
                    <Identicon address={entry.creatorAddress} size={36} />
                    <div className="entry-list-info">
                      <span className="entry-list-address">{entry.creatorAddress}</span>
                      <span className="entry-list-meta">
                        <DifficultyChip difficulty={entry.difficulty} /> <LanguageChip language={entry.language} /> {formatLuna(entry.stakeLuna)} · {formatAge(entry.createdAt)}
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
          </>
        )}

        {browseTab === 'mine' && (
          <>
            <button type="button" className="btn btn-secondary refresh-btn" onClick={() => void loadMyEntries()}>
              Refresh
            </button>
            {myEntriesError && <p className="address-card-error">{myEntriesError}</p>}
            {myEntries === null && !myEntriesError && <p className="section-note">Loading your duels…</p>}
            {myEntries !== null && myEntries.length === 0 && (
              <EmptyState icon={<OpenIcon />} title="No duels yet" subtitle="Create one from the Duel tab to see it here." />
            )}
            {myEntries !== null && myEntries.length > 0 && (
              <ul className="entry-list">
                {myEntries.map((entry) => {
                  const { label, modifier } = myEntryStatus(entry)
                  return (
                    <li key={entry.entryId} className="entry-list-item">
                      <div className="entry-list-info">
                        <span className="entry-list-meta">
                          <DifficultyChip difficulty={entry.difficulty} /> <LanguageChip language={entry.language} /> {formatLuna(entry.stakeLuna)} · {formatAge(entry.createdAt)}
                          {entry.visibility === 'PRIVATE' && ' · Private'}
                        </span>
                        <span className={`my-entry-status my-entry-status-${modifier}`}>{label}</span>
                      </div>
                      {entry.visibility === 'PRIVATE' && entry.status === 'OPEN' && (
                        <button type="button" className="btn btn-tinted" onClick={() => void handleCopyMyEntryLink(entry.entryId)}>
                          {copiedEntryId === entry.entryId ? 'Copied!' : 'Copy link'}
                        </button>
                      )}
                    </li>
                  )
                })}
              </ul>
            )}
          </>
        )}
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
                <DifficultyChip difficulty={entry.difficulty} /> <LanguageChip language={entry.language} /> {formatLuna(entry.stakeLuna)} · {formatAge(entry.createdAt)}
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
        <button type="button" className="btn btn-secondary" onClick={backToOpenDuels}>
          Back to open duels
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
    const tied = reveal.outcome === 'tie'
    const modifier = tied ? 'tied' : youWon ? 'won' : 'lost'
    const headline = tied ? "It's a tie" : youWon ? 'You won!' : 'You lost'
    const subline = tied
      ? 'Both stakes refunded in full.'
      : youWon
        ? `Faster by ${formatSeconds(reveal.deltaMs)} — pot's on its way to you.`
        : `Slower by ${formatSeconds(reveal.deltaMs)} — better luck on the next one.`
    return (
      <div className="duel-panel">
        <div className={`result-banner result-banner-${modifier}`}>
          {modifier === 'won' && <span className="result-banner-icon"><BoardIcon /></span>}
          <p className="result-banner-title">{headline}</p>
          <p className="result-banner-subtitle">{subline}</p>
        </div>
        <div className="reveal-card">
          <div className={`reveal-row ${!tied && !youWon ? 'reveal-row-winner' : ''}`}>
            <span className="reveal-who"><Identicon address={creatorAddress} size={24} /> Opponent</span>
            <span>{formatSeconds(reveal.creatorDurationMs)}</span>
          </div>
          <div className={`reveal-row ${!tied && youWon ? 'reveal-row-winner' : ''}`}>
            <span className="reveal-who"><Identicon address={address} size={24} /> You</span>
            <span>{formatSeconds(reveal.challengerDurationMs)}</span>
          </div>
          <div className="reveal-row reveal-row-delta">
            <span>Delta</span>
            <span>{formatSeconds(reveal.deltaMs)}</span>
          </div>
        </div>
        {reveal.txHashes.map((hash) => (
          <a key={hash} className="reveal-tx" href={buildExplorerTxLink(hash)} target="_blank" rel="noopener noreferrer">
            {hash}
          </a>
        ))}
        <button type="button" className="btn btn-secondary" onClick={backToOpenDuels}>
          Back to open duels
        </button>
      </div>
    )
  }

  return (
    <div className="duel-panel">
      <p className="address-card-error">{stage.message}</p>
      <button type="button" className="btn btn-primary" onClick={backToOpenDuels}>
        Back to open duels
      </button>
    </div>
  )
}
