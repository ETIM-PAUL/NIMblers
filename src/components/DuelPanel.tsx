import { useEffect, useState } from 'react'
import type { KeystrokeRun } from '../../shared/timingEngine'
import type { Difficulty, HouseAddressInfo, Visibility } from '../lib/api'
import { buildDuelDeepLink, DIFFICULTIES, DIFFICULTY_LABELS, errorMessage, fetchHouseAddress, formatLuna, readJsonOrThrow } from '../lib/api'
import { TypingEngine } from './TypingEngine'

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
  const [houseInfo, setHouseInfo] = useState<HouseAddressInfo | null>(null)
  const [copyStatus, setCopyStatus] = useState<'idle' | 'copied' | 'failed'>('idle')

  useEffect(() => {
    fetchHouseAddress().then(setHouseInfo).catch(() => {
      // Stake amounts just won't show on the picker buttons yet — handleStake
      // fetches this again anyway and surfaces any real error there.
    })
  }, [])

  async function revealParagraph(difficulty: Difficulty, stakeTxHash: string) {
    setStage({ name: 'revealing', difficulty, stakeTxHash })
    try {
      const res = await fetch('/api/entries/reveal', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nimAddress: address, stakeTxHash, difficulty }),
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
      const house = await fetchHouseAddress()
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
        body: JSON.stringify({ nimAddress: address, stakeTxHash, difficulty, events: run.events, visibility, allowRematch }),
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
    try {
      await navigator.clipboard.writeText(link)
      setCopyStatus('copied')
    }
    catch {
      setCopyStatus('failed')
    }
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
            Public — anyone can find it
          </button>
          <button
            type="button"
            className={`btn btn-toggle ${visibility === 'PRIVATE' ? 'btn-toggle-active' : ''}`}
            onClick={() => setVisibility('PRIVATE')}
          >
            Private — invite by link
          </button>
        </div>
        <label className="rematch-toggle">
          <input type="checkbox" checked={allowRematch} onChange={(e) => setAllowRematch(e.target.checked)} />
          Allow double trial (loser can retry for 2x)
        </label>
        <div className="difficulty-picker">
          {DIFFICULTIES.map((d) => (
            <button
              key={d}
              type="button"
              className={`btn btn-difficulty btn-difficulty-${d}`}
              onClick={() => void handleStake(d)}
            >
              {DIFFICULTY_LABELS[d]}
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
    if (stage.visibility === 'PRIVATE') {
      const link = buildDuelDeepLink(stage.entryId)
      return (
        <div className="duel-panel">
          <p className="section-note-best">Private entry created.</p>
          <p className="section-note">Refunded in 24h if unclaimed.{stage.allowRematch && ' Double trial is on.'}</p>
          <input className="share-link-input" readOnly value={link} onFocus={(e) => e.currentTarget.select()} />
          <button type="button" className="btn btn-primary" onClick={() => void copyDeepLink(stage.entryId)}>
            {copyStatus === 'copied' ? 'Copied!' : 'Copy link'}
          </button>
          {copyStatus === 'failed' && (
            <p className="address-card-error">Couldn't copy — select it manually.</p>
          )}
        </div>
      )
    }
    return (
      <div className="duel-panel">
        <p className="section-note-best">Waiting for a challenger.</p>
        <p className="section-note">Refunded in 24h if unclaimed.{stage.allowRematch && ' Double trial is on.'}</p>
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
