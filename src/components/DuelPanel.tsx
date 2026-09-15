import { useState } from 'react'
import type { KeystrokeRun } from '../../shared/timingEngine'
import { TypingEngine } from './TypingEngine'

interface Props {
  address: string
  sendPayment: (recipient: string, valueLuna: number) => Promise<string>
}

type Stage =
  | { name: 'idle' }
  | { name: 'staking' }
  | { name: 'revealing', stakeTxHash: string }
  | { name: 'typing', stakeTxHash: string, paragraph: string }
  | { name: 'submitting', stakeTxHash: string }
  | { name: 'waiting', entryId: string, expiresAt: string }
  | { name: 'error', message: string, stakeTxHash: string | null }

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

async function readJsonOrThrow(res: Response, fallback: string): Promise<Record<string, unknown>> {
  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>
  if (!res.ok) {
    const reason = typeof body.error === 'string' ? body.error : fallback
    throw new Error(reason)
  }
  return body
}

export function DuelPanel({ address, sendPayment }: Props) {
  const [stage, setStage] = useState<Stage>({ name: 'idle' })

  async function revealParagraph(stakeTxHash: string) {
    setStage({ name: 'revealing', stakeTxHash })
    try {
      const res = await fetch('/api/entries/reveal', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nimAddress: address, stakeTxHash }),
      })
      const body = await readJsonOrThrow(res, 'Could not reveal the paragraph')
      setStage({ name: 'typing', stakeTxHash, paragraph: body.paragraphBody as string })
    }
    catch (error) {
      setStage({ name: 'error', message: errorMessage(error), stakeTxHash })
    }
  }

  async function handleStake() {
    setStage({ name: 'staking' })
    try {
      const houseRes = await fetch('/api/house-address')
      const house = await readJsonOrThrow(houseRes, 'Could not reach the house wallet')
      const stakeTxHash = await sendPayment(house.address as string, house.stakeLuna as number)
      await revealParagraph(stakeTxHash)
    }
    catch (error) {
      setStage({ name: 'error', message: errorMessage(error), stakeTxHash: null })
    }
  }

  async function handleSubmitRun(stakeTxHash: string, run: KeystrokeRun) {
    setStage({ name: 'submitting', stakeTxHash })
    try {
      const res = await fetch('/api/entries', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nimAddress: address, stakeTxHash, events: run.events }),
      })
      const body = await readJsonOrThrow(res, 'Could not submit your run')
      setStage({ name: 'waiting', entryId: body.entryId as string, expiresAt: body.expiresAt as string })
    }
    catch (error) {
      setStage({ name: 'error', message: errorMessage(error), stakeTxHash })
    }
  }

  if (stage.name === 'idle') {
    return (
      <div className="duel-panel">
        <p className="section-note">
          Stake 1 NIM, type today's paragraph, and wait for someone to take the bet. Your time stays
          hidden until they finish theirs.
        </p>
        <p className="duel-warning">
          Once you stake, closing this tab before you finish typing forfeits the stake — it is not
          automatically refunded. Only a fully OPEN entry that nobody challenges within 24h gets refunded.
        </p>
        <button type="button" className="btn btn-primary" onClick={() => void handleStake()}>
          Stake 1 NIM to start a duel
        </button>
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
          onSubmit={(run) => void handleSubmitRun(stage.stakeTxHash, run)}
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

  const { stakeTxHash } = stage
  return (
    <div className="duel-panel">
      <p className="address-card-error">{stage.message}</p>
      <button
        type="button"
        className="btn btn-primary"
        onClick={() => void (stakeTxHash ? revealParagraph(stakeTxHash) : handleStake())}
      >
        Try again
      </button>
    </div>
  )
}
