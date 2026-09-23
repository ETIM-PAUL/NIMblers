import { useEffect, useRef, useState } from 'react'
import type { KeystrokeRun } from '../../shared/timingEngine'
import type { Difficulty, HouseAddressInfo, MyEntry, Visibility } from '../lib/api'
import { buildDuelDeepLink, DIFFICULTIES, DIFFICULTY_LABELS, errorMessage, fetchHouseAddress, fetchMyEntries, formatLuna, readJsonOrThrow } from '../lib/api'
import { copyText } from '../lib/clipboard'
import { LanguagePicker, useDefaultLanguage } from './LanguagePicker'
import { BoardIcon, EasyIcon, HardIcon, MediumIcon } from './NavIcons'
import { TypingEngine } from './TypingEngine'

/** How often to check whether a challenger has taken/settled this entry while its creator is sitting on the waiting screen. */
const WAITING_POLL_MS = 8_000

const DIFFICULTY_ICONS: Record<Difficulty, React.ReactNode> = { easy: <EasyIcon />, medium: <MediumIcon />, hard: <HardIcon /> }

interface Props {
  address: string
  sendPayment: (recipient: string, valueLuna: number) => Promise<string>
}

type Stage =
  | { name: 'picking' }
  | { name: 'staking', difficulty: Difficulty }
  | { name: 'revealing', difficulty: Difficulty, stakeTxHash: string }
  | { name: 'typing', difficulty: Difficulty, stakeTxHash: string, paragraph: string }
  | { name: 'submitting', difficulty: Difficulty, stakeTxHash: string }
  | { name: 'waiting', entryId: string, expiresAt: string, visibility: Visibility, allowRematch: boolean }
  | { name: 'error', message: string, difficulty: Difficulty, stakeTxHash: string | null }

export function DuelPanel({ address, sendPayment }: Props) {
  const [stage, setStage] = useState<Stage>({ name: 'picking' })
  const [visibility, setVisibility] = useState<Visibility>('PUBLIC')
  const [allowRematch, setAllowRematch] = useState(false)
  const [language, setLanguage, languageOverridden] = useDefaultLanguage()
  const [houseInfo, setHouseInfo] = useState<HouseAddressInfo | null>(null)
  const [copyStatus, setCopyStatus] = useState<'idle' | 'copied' | 'failed'>('idle')
  const [resolvedEntry, setResolvedEntry] = useState<MyEntry | null>(null)
  const linkInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    fetchHouseAddress().then(setHouseInfo).catch(() => {
      // Stake amounts just won't show on the picker buttons yet — handleStake
      // fetches this again anyway and surfaces any real error there.
    })
  }, [])

  // The waiting screen is otherwise frozen the instant it's shown: nothing
  // else re-fetches once a challenger takes the entry, so without this, a
  // creator who stays on this screen (or just switches tabs and back)
  // keeps seeing "waiting" and a live copy-link long after the duel has
  // actually been played and settled elsewhere — the exact same duel then
  // disagreeing with itself between this screen and My Duels/History.
  const waitingEntryId = stage.name === 'waiting' ? stage.entryId : null
  useEffect(() => {
    if (waitingEntryId === null) {
      setResolvedEntry(null)
      return
    }
    let cancelled = false
    let timeoutId: ReturnType<typeof setTimeout>

    async function poll() {
      try {
        const entries = await fetchMyEntries(address)
        const mine = entries.find((e) => e.entryId === waitingEntryId)
        if (cancelled) return
        if (mine && mine.status !== 'OPEN') {
          setResolvedEntry(mine)
          return // reached a terminal state — stop polling
        }
      }
      catch {
        // Transient network hiccup — the next tick will just try again.
      }
      if (!cancelled) timeoutId = setTimeout(() => void poll(), WAITING_POLL_MS)
    }

    timeoutId = setTimeout(() => void poll(), WAITING_POLL_MS)
    return () => {
      cancelled = true
      clearTimeout(timeoutId)
    }
  }, [waitingEntryId, address])

  async function revealParagraph(difficulty: Difficulty, stakeTxHash: string) {
    setStage({ name: 'revealing', difficulty, stakeTxHash })
    try {
      const res = await fetch('/api/entries/reveal', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nimAddress: address, stakeTxHash, difficulty, language }),
      })
      const body = await readJsonOrThrow(res, 'Could not reveal the paragraph')
      setStage({ name: 'typing', difficulty, stakeTxHash, paragraph: body.paragraphBody as string })
    }
    catch (error) {
      setStage({ name: 'error', message: errorMessage(error), difficulty, stakeTxHash })
    }
  }

  async function handleStake(difficulty: Difficulty) {
    setStage({ name: 'staking', difficulty })
    try {
      // Use the address already fetched on mount rather than awaiting a
      // fresh network call here — an `await` sitting between this tap and
      // sendPayment() (which needs to pop a native confirmation sheet) can
      // cost the click its "this came from a real tap" standing in some
      // WebViews, leaving the sheet stuck never appearing. Only falls back
      // to a fresh fetch if the mount-time one hasn't resolved yet.
      const house = houseInfo ?? await fetchHouseAddress()
      const stakeTxHash = await sendPayment(house.address, house.stakes[difficulty])
      await revealParagraph(difficulty, stakeTxHash)
    }
    catch (error) {
      setStage({ name: 'error', message: errorMessage(error), difficulty, stakeTxHash: null })
    }
  }

  async function handleSubmitRun(difficulty: Difficulty, stakeTxHash: string, run: KeystrokeRun) {
    setStage({ name: 'submitting', difficulty, stakeTxHash })
    try {
      const res = await fetch('/api/entries', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nimAddress: address, stakeTxHash, difficulty, events: run.events, visibility, allowRematch, language }),
      })
      const body = await readJsonOrThrow(res, 'Could not submit your run')
      setCopyStatus('idle')
      setStage({
        name: 'waiting',
        entryId: body.entryId as string,
        expiresAt: body.expiresAt as string,
        visibility: body.visibility as Visibility,
        allowRematch: body.allowRematch as boolean,
      })
    }
    catch (error) {
      setStage({ name: 'error', message: errorMessage(error), difficulty, stakeTxHash })
    }
  }

  async function copyDeepLink(entryId: string) {
    const link = buildDuelDeepLink(entryId)
    const copied = await copyText(link, linkInputRef.current)
    setCopyStatus(copied ? 'copied' : 'failed')
  }

  function startAnotherDuel() {
    setCopyStatus('idle')
    setStage({ name: 'picking' })
  }

  if (stage.name === 'picking') {
    return (
      <div className="duel-panel">
        <p className="section-note">Stake NIM, type the paragraph, wait for a challenger.</p>
        <p className="duel-warning">Closing this tab before you finish forfeits your stake.</p>
        <div className="visibility-picker">
          <button
            type="button"
            className={`btn btn-toggle ${visibility === 'PUBLIC' ? 'btn-toggle-active' : ''}`}
            onClick={() => setVisibility('PUBLIC')}
          >
            Public
          </button>
          <button
            type="button"
            className={`btn btn-toggle ${visibility === 'PRIVATE' ? 'btn-toggle-active' : ''}`}
            onClick={() => setVisibility('PRIVATE')}
          >
            Private — invite by link
          </button>
        </div>
        <label className="rematch-toggle" style={{ margin: '1rem 0' }}>
          <input type="checkbox" checked={allowRematch} onChange={(e) => setAllowRematch(e.target.checked)} />
          Allow double trial (loser can retry for 2x)
        </label>
        <LanguagePicker language={language} onChange={setLanguage} overridden={languageOverridden} />
        <div className="difficulty-picker">
          {DIFFICULTIES.map((d) => (
            <button
              key={d}
              type="button"
              className={`btn-difficulty btn-difficulty-${d}`}
              onClick={() => void handleStake(d)}
            >
              <span className="btn-difficulty-icon">{DIFFICULTY_ICONS[d]}</span>
              <span className="btn-difficulty-label">{DIFFICULTY_LABELS[d]}</span>
              {houseInfo && <span className="btn-difficulty-stake">{formatLuna(houseInfo.stakes[d])}</span>}
            </button>
          ))}
        </div>
      </div>
    )
  }

  if (stage.name === 'staking') {
    return <p className="section-note">Confirm the payment in Nimiq Pay…</p>
  }

  if (stage.name === 'revealing') {
    return <p className="section-note">Verifying your stake…</p>
  }

  if (stage.name === 'typing') {
    return (
      <>
        <p className="duel-warning">Closing this tab now forfeits your stake.</p>
        <TypingEngine
          paragraph={stage.paragraph}
          onSubmit={(run) => void handleSubmitRun(stage.difficulty, stage.stakeTxHash, run)}
        />
      </>
    )
  }

  if (stage.name === 'submitting') {
    return <p className="section-note">Submitting your run…</p>
  }

  if (stage.name === 'waiting') {
    if (resolvedEntry && resolvedEntry.status === 'LOCKED') {
      return (
        <div className="duel-panel">
          <p className="section-note-best">Someone's playing your duel now.</p>
          <p className="section-note">Check back soon to see who won.</p>
          <button type="button" className="btn btn-secondary" onClick={startAnotherDuel}>
            Create another duel
          </button>
        </div>
      )
    }
    if (resolvedEntry && resolvedEntry.status === 'EXPIRED') {
      return (
        <div className="duel-panel">
          <div className="result-banner result-banner-tied">
            <p className="result-banner-title">Expired</p>
            <p className="result-banner-subtitle">Nobody challenged it in time — your stake was refunded.</p>
          </div>
          <button type="button" className="btn btn-secondary" onClick={startAnotherDuel}>
            Create another duel
          </button>
        </div>
      )
    }
    if (resolvedEntry && resolvedEntry.status === 'SETTLED') {
      const modifier = resolvedEntry.outcome === 'creator' ? 'won' : resolvedEntry.outcome === 'challenger' ? 'lost' : 'tied'
      const title = modifier === 'won' ? 'You won!' : modifier === 'lost' ? 'You lost' : "It's a tie"
      const subtitle = modifier === 'tied' ? 'Both stakes refunded in full.' : 'See the full result, including both times, in History.'
      return (
        <div className="duel-panel">
          <div className={`result-banner result-banner-${modifier}`}>
            {modifier === 'won' && <span className="result-banner-icon"><BoardIcon /></span>}
            <p className="result-banner-title">{title}</p>
            <p className="result-banner-subtitle">{subtitle}</p>
          </div>
          <button type="button" className="btn btn-secondary" onClick={startAnotherDuel}>
            Create another duel
          </button>
        </div>
      )
    }
    if (stage.visibility === 'PRIVATE') {
      const link = buildDuelDeepLink(stage.entryId)
      return (
        <div className="duel-panel">
          <p className="section-note-best">Private entry created.</p>
          <p className="section-note">Refunded in 24h if unclaimed.{stage.allowRematch && ' Double trial is on.'}</p>
          <input
            ref={linkInputRef}
            className="share-link-input"
            readOnly
            value={link}
            onFocus={(e) => e.currentTarget.select()}
          />
          <button type="button" className="btn btn-primary" onClick={() => void copyDeepLink(stage.entryId)}>
            {copyStatus === 'copied' ? 'Copied!' : 'Copy link'}
          </button>
          {copyStatus === 'failed' && (
            <p className="address-card-error">Couldn't copy — tap the link above and copy it manually.</p>
          )}
          <button type="button" className="btn btn-secondary" onClick={startAnotherDuel}>
            Create another duel
          </button>
        </div>
      )
    }
    return (
      <div className="duel-panel">
        <p className="section-note-best">Waiting for a challenger.</p>
        <p className="section-note">
          Refunded in 24h if unclaimed.{stage.allowRematch && ' Double trial is on.'} It's listed publicly now
          — check My duels to see it (it won't show in your own Open duels).
        </p>
        <button type="button" className="btn btn-secondary" onClick={startAnotherDuel}>
          Create another duel
        </button>
      </div>
    )
  }

  const { difficulty, stakeTxHash } = stage
  return (
    <div className="duel-panel">
      <p className="address-card-error">{stage.message}</p>
      <button
        type="button"
        className="btn btn-primary"
        onClick={() => void (stakeTxHash ? revealParagraph(difficulty, stakeTxHash) : handleStake(difficulty))}
      >
        Try again
      </button>
    </div>
  )
}
