import { useEffect, useState } from 'react'
import type { KeystrokeRun } from '../../shared/timingEngine'
import type { Difficulty, HouseAddressInfo } from '../lib/api'
import { DIFFICULTIES, DIFFICULTY_LABELS, errorMessage, fetchHouseAddress, formatLuna, readJsonOrThrow } from '../lib/api'
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
  | { name: 'waiting', entryId: string, expiresAt: string }
  | { name: 'error', message: string, difficulty: Difficulty, stakeTxHash: string | null }

export function DuelPanel({ address, sendPayment }: Props) {
  const [stage, setStage] = useState<Stage>({ name: 'picking' })
  const [houseInfo, setHouseInfo] = useState<HouseAddressInfo | null>(null)

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
        body: JSON.stringify({ nimAddress: address, stakeTxHash, difficulty, events: run.events }),
      })
      const body = await readJsonOrThrow(res, 'Could not submit your run')
      setStage({ name: 'waiting', entryId: body.entryId as string, expiresAt: body.expiresAt as string })
    }
    catch (error) {
      setStage({ name: 'error', message: errorMessage(error), difficulty, stakeTxHash })
    }
  }

  if (stage.name === 'picking') {
    return (
      <div className="duel-panel">
        <p className="section-note">
          Stake NIM, type today's paragraph for that level, and wait for someone to take the bet.
          Your time stays hidden until they finish theirs.
        </p>
        <p className="duel-warning">
          Once you stake, closing this tab before you finish typing forfeits the stake — it is not
          automatically refunded. Only a fully OPEN entry that nobody challenges within 24h gets refunded.
        </p>
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
        <p className="duel-warning">Closing this tab now forfeits your stake — finish typing to lock in your entry.</p>
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
    return (
      <div className="duel-panel">
        <p className="section-note-best">Entry created — waiting for a challenger.</p>
        <p className="section-note">
          Your time is hidden from everyone, including you, until someone takes the bet. Refunded
          automatically if nobody challenges within 24 hours (by {new Date(stage.expiresAt).toLocaleString()}).
        </p>
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
