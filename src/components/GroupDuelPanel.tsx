import { useCallback, useEffect, useRef, useState } from 'react'
import type { KeystrokeRun } from '../../shared/timingEngine'
import type { Difficulty, GroupDuelPreview, GroupDuelResultRow, HouseAddressInfo } from '../lib/api'
import {
  buildGroupDuelDeepLink,
  DIFFICULTIES,
  DIFFICULTY_LABELS,
  errorMessage,
  fetchGroupDuelPreview,
  fetchGroupDuelStatus,
  fetchHouseAddress,
  formatAddressShort,
  formatLuna,
  formatSeconds,
  readJsonOrThrow,
} from '../lib/api'
import { copyText } from '../lib/clipboard'
import { parseGroupDuelCode } from '../lib/groupDuelLink'
import { Identicon } from './Identicon'
import { LanguagePicker, useDefaultLanguage } from './LanguagePicker'
import { BoardIcon, EasyIcon, GroupIcon, HardIcon, MediumIcon } from './NavIcons'
import { TypingEngine } from './TypingEngine'
import { EmptyState } from './EmptyState'

/** How often to poll a resolved-or-not group duel while waiting on the rest of the roster. */
const WAITING_POLL_MS = 8_000

const DIFFICULTY_ICONS: Record<Difficulty, React.ReactNode> = { easy: <EasyIcon />, medium: <MediumIcon />, hard: <HardIcon /> }

const MIN_PARTICIPANTS = 2
const MAX_PARTICIPANTS = 50

interface Props {
  address: string
  sendPayment: (recipient: string, valueLuna: number) => Promise<string>
  /** Set once, from `?groupDuel=<code>` on mount — opens straight to that group's preview instead of the home screen. */
  presetCode?: string
}

type Stage =
  | { name: 'home' }
  | { name: 'loading-invite' }
  | { name: 'preview', code: string, preview: GroupDuelPreview }
  | { name: 'creating' }
  | { name: 'created', code: string, groupDuelId: string, stakeLuna: number, maxParticipants: number }
  | { name: 'staking', code: string, stakeLuna: number, maxParticipants: number }
  | { name: 'joining', code: string, stakeTxHash: string, maxParticipants: number }
  | { name: 'typing', code: string, groupDuelId: string, paragraph: string, maxParticipants: number }
  | { name: 'submitting', code: string, groupDuelId: string, maxParticipants: number }
  | { name: 'waiting', code: string, groupDuelId: string, maxParticipants: number }
  | { name: 'results', results: GroupDuelResultRow[] }
  | { name: 'error', message: string }

interface WaitingInfo {
  joinedCount: number
  youSubmitted: boolean
}

export function GroupDuelPanel({ address, sendPayment, presetCode }: Props) {
  const [stage, setStage] = useState<Stage>(presetCode ? { name: 'loading-invite' } : { name: 'home' })
  const [houseInfo, setHouseInfo] = useState<HouseAddressInfo | null>(null)
  const [difficulty, setDifficulty] = useState<Difficulty>('easy')
  const [maxParticipants, setMaxParticipants] = useState('10')
  const [language, setLanguage, languageOverridden] = useDefaultLanguage()
  const [pastedCode, setPastedCode] = useState('')
  const [pastedCodeError, setPastedCodeError] = useState<string | null>(null)
  const [copyStatus, setCopyStatus] = useState<'idle' | 'copied' | 'failed'>('idle')
  const [waitingInfo, setWaitingInfo] = useState<WaitingInfo | null>(null)
  const linkInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    fetchHouseAddress().then(setHouseInfo).catch(() => {
      // Only needed to know the house address before sendPayment — the
      // join flow re-fetches it if this hasn't resolved yet by then.
    })
  }, [])

  const loadPreview = useCallback(async (code: string) => {
    try {
      const preview = await fetchGroupDuelPreview(code, address)
      setStage({ name: 'preview', code: preview.code, preview })
    }
    catch (error) {
      setStage({ name: 'error', message: errorMessage(error) })
    }
  }, [address])

  // `presetCode` isn't fixed at mount — the Open tab's "Group duels" list
  // can change it mid-session too (App.tsx's `openGroupDuelTab`), so this
  // reruns and reloads the preview every time it actually changes, not
  // just once on the initial shared-link open.
  useEffect(() => {
    if (presetCode) void loadPreview(presetCode)
  }, [presetCode, loadPreview])

  const waitingGroupDuelId = stage.name === 'waiting' ? stage.groupDuelId : null
  useEffect(() => {
    if (waitingGroupDuelId === null) {
      setWaitingInfo(null)
      return
    }
    let cancelled = false
    let timeoutId: ReturnType<typeof setTimeout>

    async function poll() {
      try {
        const status = await fetchGroupDuelStatus(waitingGroupDuelId!, address)
        if (cancelled) return
        if (status.resolved) {
          setStage({ name: 'results', results: status.results })
          return // reached a terminal state — stop polling
        }
        setWaitingInfo({ joinedCount: status.joinedCount, youSubmitted: status.youSubmitted })
      }
      catch {
        // Transient network hiccup — the next tick just tries again.
      }
      if (!cancelled) timeoutId = setTimeout(() => void poll(), WAITING_POLL_MS)
    }

    void poll()
    return () => {
      cancelled = true
      clearTimeout(timeoutId)
    }
  }, [waitingGroupDuelId, address])

  async function handleCreate() {
    const count = Number(maxParticipants)
    if (!Number.isInteger(count) || count < MIN_PARTICIPANTS || count > MAX_PARTICIPANTS) {
      setStage({ name: 'error', message: `Group size must be between ${MIN_PARTICIPANTS} and ${MAX_PARTICIPANTS}.` })
      return
    }
    setStage({ name: 'creating' })
    try {
      const res = await fetch('/api/group-duels', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nimAddress: address, difficulty, maxParticipants: count, language }),
      })
      const body = await readJsonOrThrow(res, 'Could not create the group duel')
      setCopyStatus('idle')
      setStage({
        name: 'created',
        code: body.code as string,
        groupDuelId: body.groupDuelId as string,
        stakeLuna: body.stakeLuna as number,
        maxParticipants: body.maxParticipants as number,
      })
    }
    catch (error) {
      setStage({ name: 'error', message: errorMessage(error) })
    }
  }

  async function handleJoin(code: string, stakeLuna: number, maxParticipants: number) {
    setStage({ name: 'staking', code, stakeLuna, maxParticipants })
    try {
      // Same reasoning as DuelPanel's handleStake: use the address already
      // fetched on mount rather than awaiting a fresh call here, so this
      // tap's "real user gesture" provenance survives through to
      // sendPayment's native confirmation sheet.
      const house = houseInfo ?? await fetchHouseAddress()
      const stakeTxHash = await sendPayment(house.address, stakeLuna)
      await submitJoin(code, stakeTxHash, maxParticipants)
    }
    catch (error) {
      setStage({ name: 'error', message: errorMessage(error) })
    }
  }

  async function submitJoin(code: string, stakeTxHash: string, maxParticipants: number) {
    setStage({ name: 'joining', code, stakeTxHash, maxParticipants })
    try {
      const res = await fetch('/api/group-duels/join', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code, nimAddress: address, stakeTxHash }),
      })
      const body = await readJsonOrThrow(res, 'Could not join this group duel')
      setStage({ name: 'typing', code, groupDuelId: body.groupDuelId as string, paragraph: body.paragraphBody as string, maxParticipants })
    }
    catch (error) {
      setStage({ name: 'error', message: errorMessage(error) })
    }
  }

  async function handleSubmitRun(code: string, groupDuelId: string, maxParticipants: number, run: KeystrokeRun) {
    setStage({ name: 'submitting', code, groupDuelId, maxParticipants })
    try {
      const res = await fetch('/api/group-duels/submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ groupDuelId, nimAddress: address, events: run.events }),
      })
      await readJsonOrThrow(res, 'Could not submit your run')
      setStage({ name: 'waiting', code, groupDuelId, maxParticipants })
    }
    catch (error) {
      setStage({ name: 'error', message: errorMessage(error) })
    }
  }

  async function copyGroupLink(code: string) {
    const link = buildGroupDuelDeepLink(code)
    const copied = await copyText(link, linkInputRef.current)
    setCopyStatus(copied ? 'copied' : 'failed')
  }

  function handleFindGroup() {
    const code = parseGroupDuelCode(pastedCode)
    if (!code) {
      setPastedCodeError("That doesn't look like a group duel link or code.")
      return
    }
    setPastedCodeError(null)
    void loadPreview(code)
  }

  function backToHome() {
    setCopyStatus('idle')
    setPastedCode('')
    setPastedCodeError(null)
    setStage({ name: 'home' })
  }

  if (stage.name === 'loading-invite') {
    return <p className="section-note">Loading this group duel…</p>
  }

  if (stage.name === 'home') {
    return (
      <div className="duel-panel">
        <p className="section-note">Race up to {MAX_PARTICIPANTS} friends on the same paragraph. Everyone stakes, types, and the pot splits by rank once the group's done.</p>
        <p className="duel-warning">Stake and don't finish before the group resolves, and your stake forfeits into the pot.</p>

        <LanguagePicker language={language} onChange={setLanguage} overridden={languageOverridden} />

        <div className="difficulty-picker">
          {DIFFICULTIES.map((d) => (
            <button
              key={d}
              type="button"
              className={`btn-difficulty btn-difficulty-${d} ${difficulty === d ? 'btn-difficulty-selected' : ''}`}
              onClick={() => setDifficulty(d)}
            >
              <span className="btn-difficulty-icon">{DIFFICULTY_ICONS[d]}</span>
              <span className="btn-difficulty-label">{DIFFICULTY_LABELS[d]}</span>
              {houseInfo && <span className="btn-difficulty-stake">{formatLuna(houseInfo.stakes[d])}</span>}
            </button>
          ))}
        </div>

        <label className="section-note" style={{ display: 'block', margin: '1rem 0 0.5rem' }}>
          Group size (2–{MAX_PARTICIPANTS})
        </label>
        <input
          type="number"
          min={MIN_PARTICIPANTS}
          max={MAX_PARTICIPANTS}
          className="find-duel-input share-link-input"
          value={maxParticipants}
          onChange={(e) => setMaxParticipants(e.target.value)}
        />

        <button type="button" className="btn btn-primary" style={{ marginTop: '1rem' }} onClick={() => void handleCreate()}>
          Create group duel
        </button>

        <p className="section-note" style={{ marginTop: '2rem' }}>Have a code? Join one instead.</p>
        <div className="find-duel">
          <input
            className="find-duel-input share-link-input"
            placeholder="Paste a group duel link or code"
            value={pastedCode}
            onChange={(e) => { setPastedCode(e.target.value); setPastedCodeError(null) }}
            onKeyDown={(e) => { if (e.key === 'Enter') handleFindGroup() }}
          />
          <button type="button" className="btn btn-tinted" onClick={handleFindGroup} disabled={!pastedCode.trim()}>
            Find
          </button>
        </div>
        {pastedCodeError && <p className="address-card-error">{pastedCodeError}</p>}
      </div>
    )
  }

  if (stage.name === 'preview') {
    const { preview, code } = stage
    const full = preview.joinedCount >= preview.maxParticipants
    const closed = preview.status !== 'OPEN'
    // Already have a slot — routing back through "Join & stake" here would
    // be a brand-new real payment the backend has nothing to refund it
    // against (see getGroupDuelPreview's `you` doc comment). Resume instead.
    const you = preview.you?.joined === true ? preview.you : null
    return (
      <div className="duel-panel">
        <p className="section-note-best">Group duel {code}</p>
        <div className="entry-list-item">
          <div className="entry-list-info">
            <span className="entry-list-address">{DIFFICULTY_LABELS[preview.difficulty]} — {formatLuna(preview.stakeLuna)} stake</span>
            <span className="entry-list-meta">{preview.joinedCount} / {preview.maxParticipants} joined</span>
          </div>
        </div>
        {closed && (
          <p className="address-card-error">This group duel has already {preview.status === 'SETTLED' ? 'finished' : 'expired'}.</p>
        )}
        {!closed && you && you.submitted && (
          <button type="button" className="btn btn-primary" onClick={() => setStage({ name: 'waiting', code, groupDuelId: you.groupDuelId, maxParticipants: preview.maxParticipants })}>
            You're in — check status
          </button>
        )}
        {!closed && you && !you.submitted && (
          <button type="button" className="btn btn-primary" onClick={() => void submitJoin(code, '(already staked)', preview.maxParticipants)}>
            Continue typing
          </button>
        )}
        {!closed && !you && full && <p className="address-card-error">This group duel is full.</p>}
        {!closed && !you && !full && (
          <button type="button" className="btn btn-primary" onClick={() => void handleJoin(code, preview.stakeLuna, preview.maxParticipants)}>
            Join & stake {formatLuna(preview.stakeLuna)}
          </button>
        )}
        <button type="button" className="btn btn-secondary" onClick={backToHome}>Back</button>
      </div>
    )
  }

  if (stage.name === 'creating') {
    return <p className="section-note">Creating your group duel…</p>
  }

  if (stage.name === 'created') {
    const link = buildGroupDuelDeepLink(stage.code)
    return (
      <div className="duel-panel">
        <p className="section-note-best">Group duel created.</p>
        <p className="section-note">Share this code with up to {stage.maxParticipants} friends. Resolves once everyone's typed, or in 72h — whichever comes first.</p>
        <input
          ref={linkInputRef}
          className="share-link-input"
          readOnly
          value={link}
          onFocus={(e) => e.currentTarget.select()}
        />
        <button type="button" className="btn btn-primary" onClick={() => void copyGroupLink(stage.code)}>
          {copyStatus === 'copied' ? 'Copied!' : 'Copy link'}
        </button>
        {copyStatus === 'failed' && (
          <p className="address-card-error">Couldn't copy — tap the link above and copy it manually.</p>
        )}
        <button type="button" className="btn btn-secondary" style={{ marginTop: '0.5rem' }} onClick={() => void handleJoin(stage.code, stage.stakeLuna, stage.maxParticipants)}>
          Join & stake {formatLuna(stage.stakeLuna)}
        </button>
        <button type="button" className="btn btn-secondary" onClick={backToHome}>Done — I'll check back later</button>
      </div>
    )
  }

  if (stage.name === 'staking') {
    return <p className="section-note">Confirm the payment in Nimiq Pay…</p>
  }

  if (stage.name === 'joining') {
    return <p className="section-note">Verifying your stake…</p>
  }

  if (stage.name === 'typing') {
    return (
      <>
        <p className="duel-warning">Closing this tab now forfeits your stake. Share code: <strong>{stage.code}</strong></p>
        <TypingEngine
          paragraph={stage.paragraph}
          onSubmit={(run) => void handleSubmitRun(stage.code, stage.groupDuelId, stage.maxParticipants, run)}
        />
      </>
    )
  }

  if (stage.name === 'submitting') {
    return <p className="section-note">Submitting your run…</p>
  }

  if (stage.name === 'waiting') {
    const link = buildGroupDuelDeepLink(stage.code)
    return (
      <div className="duel-panel">
        <p className="section-note-best">
          {waitingInfo ? `${waitingInfo.joinedCount} / ${stage.maxParticipants} joined` : 'Waiting for the rest of the group.'}
        </p>
        <p className="section-note">Resolves once everyone's typed, or 72h after creation — whichever comes first. Nobody's time, including yours, shows until then.</p>
        <p className="section-note">Still missing players? Share the code again:</p>
        <input
          ref={linkInputRef}
          className="share-link-input"
          readOnly
          value={link}
          onFocus={(e) => e.currentTarget.select()}
        />
        <button type="button" className="btn btn-primary" onClick={() => void copyGroupLink(stage.code)}>
          {copyStatus === 'copied' ? 'Copied!' : 'Copy link'}
        </button>
        {copyStatus === 'failed' && (
          <p className="address-card-error">Couldn't copy — tap the link above and copy it manually.</p>
        )}
        <button type="button" className="btn btn-secondary" onClick={backToHome}>Back to Group Duels</button>
      </div>
    )
  }

  if (stage.name === 'results') {
    const ranked = [...stage.results].sort((a, b) => (a.rank ?? Infinity) - (b.rank ?? Infinity))
    const me = ranked.find((r) => r.address === address)
    return (
      <div className="duel-panel">
        <div className={`result-banner ${me?.rank === 1 ? 'result-banner-won' : me?.forfeited ? 'result-banner-lost' : 'result-banner-tied'}`}>
          {me?.rank === 1 && <span className="result-banner-icon"><BoardIcon /></span>}
          <p className="result-banner-title">
            {me?.forfeited ? 'You forfeited' : me?.rank ? `You placed #${me.rank}` : 'Resolved'}
          </p>
          <p className="result-banner-subtitle">
            {me?.forfeited
              ? 'No run was submitted in time — your stake went to the pot.'
              : (me?.payoutLuna ?? 0) > 0
                ? `You won ${formatLuna(me!.payoutLuna)}.`
                : 'Outside the paid places this time.'}
          </p>
        </div>
        {ranked.length === 0
          ? <EmptyState icon={<GroupIcon />} title="No results" />
          : (
              <ol className="leaderboard-list">
                {ranked.map((r) => (
                  <li key={r.address} className={`leaderboard-row ${r.rank && r.rank <= 3 ? `leaderboard-row-${r.rank}` : ''}`}>
                    <span className={`leaderboard-medal ${r.rank && r.rank <= 3 ? `leaderboard-medal-${r.rank}` : ''}`}>
                      {r.rank ?? '—'}
                    </span>
                    <Identicon address={r.address} size={28} />
                    <span className="leaderboard-address" title={r.address}>{formatAddressShort(r.address)}</span>
                    <span className="leaderboard-stats">
                      <span className="leaderboard-winnings">
                        {r.forfeited ? 'Forfeited' : r.durationMs !== null ? formatSeconds(r.durationMs) : '—'}
                      </span>
                      {r.payoutLuna > 0 && <span className="leaderboard-wins">+{formatLuna(r.payoutLuna)}</span>}
                    </span>
                  </li>
                ))}
              </ol>
            )}
        <button type="button" className="btn btn-secondary" onClick={backToHome}>Back to Group Duels</button>
      </div>
    )
  }

  return (
    <div className="duel-panel">
      <p className="address-card-error">{stage.message}</p>
      <button type="button" className="btn btn-primary" onClick={backToHome}>
        Back to Group Duels
      </button>
    </div>
  )
}
