import { useEffect, useMemo, useRef, useState } from 'react'
import { generateParagraph } from '../../server/paragraphs/generator'
import { computeCharStates } from '../../shared/typingEngine'
import '../landing.css'

interface Props {
  errorMessage: string | null
  /** Whether the Nimiq Pay provider is actually connected — "Launch App" only makes sense once there's an app to launch into. */
  isReady: boolean
  onLaunch: () => void
}

/** A steady, believable pace for the "someone else" racing bar — not superhuman, just a real typist. */
const GHOST_WPM = 42
const GHOST_CHARS_PER_MS = (GHOST_WPM * 5) / 60_000

function useGhostRace(targetLength: number, startedAtMs: number | null) {
  const [ghostChars, setGhostChars] = useState(0)

  useEffect(() => {
    if (startedAtMs === null) {
      setGhostChars(0)
      return
    }
    let frame: number
    const tick = () => {
      const elapsed = performance.now() - startedAtMs
      setGhostChars(Math.min(targetLength, elapsed * GHOST_CHARS_PER_MS))
      if (elapsed * GHOST_CHARS_PER_MS < targetLength) frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [startedAtMs, targetLength])

  return ghostChars
}

function RaceDemo() {
  const [round, setRound] = useState(0)
  const target = useMemo(() => generateParagraph('easy'), [round])
  const [typed, setTyped] = useState('')
  const [startedAtMs, setStartedAtMs] = useState<number | null>(null)
  // Locked in by whichever crosses the finish line first — never
  // re-derived afterward, so the visitor finishing later can't silently
  // overwrite a ghost win that already happened.
  const [outcome, setOutcome] = useState<'you' | 'ghost' | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const states = computeCharStates(target, typed)
  const done = typed === target
  const ghostChars = useGhostRace(target.length, startedAtMs)
  const ghostDone = ghostChars >= target.length

  useEffect(() => {
    if (outcome !== null) return
    if (done) setOutcome('you')
    else if (ghostDone) setOutcome('ghost')
  }, [done, ghostDone, outcome])

  function handleChange(next: string) {
    if (outcome !== null) return
    if (next.length > target.length) return
    if (startedAtMs === null && next.length > 0) setStartedAtMs(performance.now())
    setTyped(next)
  }

  function tryAgain() {
    setRound((r) => r + 1)
    setTyped('')
    setStartedAtMs(null)
    setOutcome(null)
    inputRef.current?.focus()
  }

  const resolved = outcome !== null

  return (
    <div className="race-demo">
      <p className="race-demo-label">Type the line below. A duel is exactly this fast.</p>
      <p className="race-demo-target" aria-hidden="true">
        {target.split('').map((char, i) => (
          <span key={i} className={`race-char race-char-${states[i]}`}>{char}</span>
        ))}
      </p>
      <input
        ref={inputRef}
        className="race-demo-input"
        value={typed}
        onChange={(e) => handleChange(e.target.value)}
        placeholder="Click here and start typing"
        autoComplete="off"
        autoCorrect="off"
        autoCapitalize="off"
        spellCheck={false}
        disabled={outcome !== null}
        aria-label="Type the demo sentence"
      />
      <div className="race-track">
        <div className="race-lane">
          <span className="race-lane-label">You</span>
          <div className="race-bar">
            <div className="race-bar-fill race-bar-you" style={{ width: `${(typed.length / target.length) * 100}%` }} />
          </div>
        </div>
        <div className="race-lane">
          <span className="race-lane-label">A real typist</span>
          <div className="race-bar">
            <div className="race-bar-fill race-bar-ghost" style={{ width: `${(ghostChars / target.length) * 100}%` }} />
          </div>
        </div>
      </div>
      <div className="race-demo-footer">
        {outcome === 'you' && <p className="race-demo-result race-demo-result-win">You'd have taken the pot.</p>}
        {outcome === 'ghost' && <p className="race-demo-result race-demo-result-lose">They'd have taken the pot.</p>}
        {outcome === null && <p className="race-demo-hint">A fresh line every time — this one didn't exist a second ago.</p>}
        {resolved && (
          <button type="button" className="race-demo-retry" onClick={tryAgain}>
            Try a new line
          </button>
        )}
      </div>
    </div>
  )
}

const SCREENSHOTS = [
  { src: '/screenshots/open-duels.jpg', alt: 'Open duels dashboard', caption: 'NIMblers' },
  { src: '/screenshots/typing.jpg', alt: 'Mid-duel typing screen', caption: 'Live WPM and accuracy while you race' },
  { src: '/screenshots/duel-result.jpg', alt: 'Duel result screen', caption: 'Both times, only revealed once the duel is decided' },
  { src: '/screenshots/history.jpg', alt: 'Duel history list', caption: 'Every duel you have finished, win or lose' },
  { src: '/screenshots/leaderboard.jpg', alt: 'Weekly leaderboard', caption: "This week's winners, ranked by NIM actually won" },
]

const STEPS = [
  { title: 'Stake NIM', body: 'Pick Easy, Medium, or Hard, and a language — English, French, or Spanish. The tier sets the stake and how long and punctuated the paragraph gets.' },
  { title: 'Type blind', body: "You race a paragraph nobody's seen before — generated the moment you stake. Your time stays hidden, even from you, until the duel ends." },
  { title: 'Someone takes the bet', body: "Another player finds your stake on the open list — or, if you made it private, only whoever has the link can take it. They race the same paragraph you did." },
  { title: 'The server decides', body: 'Whoever typed it faster — timed server-side, not by either phone — takes the pot. A tie refunds both stakes in full.' },
]

const FEATURES = [
  { title: 'Public or private duels', body: 'Stake into the open list for anyone to challenge, or keep it private and hand the link to one person yourself.' },
  { title: 'Type in English, French, or Spanish', body: "Picked from your device's own language by default — switch it before you stake, any duel, any time." },
  { title: 'Practice mode, no stake', body: 'Warm up on the same paragraph generator with nothing on the line, whenever you want.' },
  { title: 'Full duel history', body: 'Every duel you have ever played, win or lose, with both times and the settlement date.' },
  { title: 'Weekly leaderboard', body: 'Ranked by NIM actually won. Starts fresh every Monday, so last week never sits at the top forever.' },
]

const FAIRNESS_POINTS = [
  'The client never reports a time. Every duration is recomputed from the raw keystrokes, server-side.',
  "A new paragraph every duel, generated at the moment you stake — nobody, not even the person who created it, can know the text in advance.",
  'Every paragraph mixes in Nimiq-themed words alongside everyday ones, picked at random — so no two duels, even at the same difficulty, read alike.',
  "Bot-typed runs get caught. Real typing has a rhythm — steady timers and flat randomness don't fake it.",
]

export function LandingPage({ errorMessage, isReady, onLaunch }: Props) {
  return (
    <div className="landing">
      <header className="landing-nav">
        <span className="landing-nav-mark">
          <img src="/nimblers-icon.png" alt="" width={26} height={26} />
          NIMblers
        </span>
        <span className="landing-nav-right">
          <span className="landing-nav-tag">Nimiq testnet</span>
          {isReady && (
            <button type="button" className="landing-launch-btn" onClick={onLaunch}>
              Launch App
            </button>
          )}
        </span>
      </header>

      <section className="landing-hero">
        <h1 className="landing-headline">Type faster than a stranger.<br />Keep their stake.</h1>
        <p className="landing-subhead">
          NIMblers is a 1-on-1 typing race with real NIM on the line, built into
          Nimiq Pay. Duel in public or private, practice for free, and climb a
          leaderboard that resets every week.
        </p>
        <RaceDemo />
      </section>

      <section className="landing-proof">
        <div className="landing-proof-strip">
          {SCREENSHOTS.map((shot) => (
            <figure key={shot.src} className="landing-proof-item">
              <img src={shot.src} alt={shot.alt} loading="lazy" />
              <figcaption>{shot.caption}</figcaption>
            </figure>
          ))}
        </div>
      </section>

      <section className="landing-section landing-features">
        <h2 className="landing-section-title">Features</h2>
        <ul className="landing-feature-list">
          {FEATURES.map((f) => (
            <li key={f.title} className="landing-feature">
              <p className="landing-feature-title">{f.title}</p>
              <p className="landing-feature-body">{f.body}</p>
            </li>
          ))}
        </ul>
      </section>

      <section className="landing-section">
        <h2 className="landing-section-title">How a duel works</h2>
        <ol className="landing-steps">
          {STEPS.map((step, i) => (
            <li key={step.title} className="landing-step">
              <span className="landing-step-number">{i + 1}</span>
              <div>
                <p className="landing-step-title">{step.title}</p>
                <p className="landing-step-body">{step.body}</p>
              </div>
            </li>
          ))}
        </ol>
      </section>

      <section className="landing-section landing-section-dark">
        <h2 className="landing-section-title">Real money means real rules</h2>
        <ul className="landing-fairness">
          {FAIRNESS_POINTS.map((point) => (
            <li key={point}>{point}</li>
          ))}
        </ul>
      </section>

      <section className="landing-section landing-leaderboard">
        <div>
          <h2 className="landing-section-title">The board resets every Monday</h2>
          <p className="landing-section-body">
            Every NIM won is public. Last week's winners don't just sit at the
            top forever — the leaderboard starts over at 00:00 UTC each Monday,
            ranked by NIM actually won, not activity.
          </p>
        </div>
        <img src="/screenshots/leaderboard.jpg" alt="Weekly leaderboard" className="landing-leaderboard-shot" loading="lazy" />
      </section>

      <section className="landing-cta">
        {isReady
          ? (
              <>
                <h2 className="landing-section-title">You're all set</h2>
                <p className="landing-section-body">
                  Nimiq Pay is connected. Jump in whenever you're ready.
                </p>
                <button type="button" className="btn btn-primary landing-launch-btn-cta" onClick={onLaunch}>
                  Launch App
                </button>
              </>
            )
          : (
              <>
                <h2 className="landing-section-title">Open it in Nimiq Pay</h2>
                <p className="landing-section-body">
                  NIMblers only runs inside Nimiq Pay — that's what lets a duel settle
                  on-chain without you ever leaving the app you already have open.
                </p>
                <ol className="landing-cta-steps">
                  <li>Open the Nimiq Pay app on your phone</li>
                  <li>Go to <strong>Mini Apps</strong></li>
                  <li>Paste in this page's link</li>
                </ol>
                {errorMessage && <p className="landing-cta-error">Connection error: {errorMessage}</p>}
              </>
            )}
        <p className="landing-testnet-note">
          Running on Nimiq testnet — every stake here is test NIM, not real funds.
        </p>
      </section>

      <footer className="landing-footer">
        <span>NIMblers · async 1v1 typing duels on Nimiq Pay</span>
      </footer>
    </div>
  )
}
