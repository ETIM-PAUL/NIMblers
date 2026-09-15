<div align="center">

# ⌨️ Typing Duel

**Stake NIM. Type fast. Winner takes the pot.**

An async 1v1 speed-typing wager, built as a Nimiq Pay Mini App.

</div>

---

## What it is

Typing Duel is a head-to-head typing game with real stakes. You stake NIM, type
a paragraph as fast and accurately as you can, and get matched against someone
else's hidden time. Whoever's faster — measured by the server, not the client —
wins the pot.

No lobby to sit in, no opponent to wait for. Player A stakes and types whenever
they want; Player B finds the open stake later and takes the bet. The duel is
async by design — it fits inside the thirty seconds someone has between two
other things.

There's also a free practice mode with three difficulty tiers — Easy, Medium,
Hard — for warming up before you put NIM on the line, with your personal best
per tier tracked locally so there's something to chase even solo.

## Why Nimiq

Nimiq settles in seconds and its Mini Apps run *inside* the wallet — no install,
no separate account, no bridging funds around. For a game that's decided in
under a minute, that's the whole pitch: connect, stake, type, know if you won,
all without leaving the app you already have open.

## How a duel works

1. **Stake.** Player A commits NIM and starts typing. The paragraph is revealed
   only after the stake is locked in.
2. **Type blind.** The client streams every keystroke to the server as it
   happens. The server — never the browser — computes the final time. A's time
   stays hidden from everyone, including A, until the duel resolves.
3. **Someone takes the bet.** Player B browses open stakes (opponent, amount,
   age — never a time) and matches one. That locks the entry and starts B's
   own run against the same paragraph.
4. **Winner takes the pot.** The server compares both independently-verified
   times, takes a small rake, and pays the winner on-chain. Ties refund both
   sides in full.

The one rule this whole project won't bend on: **the client never reports a
time.** Every duration is recomputed server-side from the raw keystroke stream,
so there's nothing to fake.

## What makes it hard to cheat

- Every keystroke is a timestamped event, not a final number the client hands
  over — the server replays and re-times every run itself.
- The clock starts on the first keystroke and freezes on the exact keystroke
  that completes the paragraph — never on the Submit click. You can stare at
  a finished duel for ten minutes before hitting Submit and the recorded time
  won't move.
- A hard WPM ceiling rejects outright — nobody legitimately types at 2000+
  WPM. Below that, statistical checks watch for the tells of scripted input:
  keystrokes on a suspiciously fixed timer, "randomness" that's actually
  flat uniform noise instead of the peaked shape real typing rhythm has, and
  missing the natural speed-up/slow-down on common letter pairs (`th` is
  fast, `qp` is slow — a bot that ignores content doesn't know that).
- Those statistical checks flag runs for review instead of auto-voiding them
  — they're still accepted and scored. False positives get refunded; nobody
  gets silently robbed by a heuristic that guessed wrong.
- Submissions are rate-limited per address per day, independent of any of
  the above.

## Under the hood

- **Frontend:** Vite + React + TypeScript, talking to Nimiq Pay through
  `@nimiq/mini-app-sdk`
- **API:** Node's built-in `http` module — no routing framework dependency for
  the handful of routes there are so far
- **Data:** SQLite via Node's built-in `node:sqlite` — the entire data layer
  ships with zero extra dependencies
- **Tests:** Node's built-in test runner — no test framework dependency either
- **Shared core:** the exact same replay logic the typing UI uses to build a
  keystroke stream is what the server uses to independently re-verify it — one
  implementation in `shared/`, imported by both sides, so there's no separate
  "server's opinion of how typing works" to drift out of sync
- **Escrow:** custodial by necessity. Nimiq has no general smart contracts —
  only basic, vesting, and HTLC accounts, and an HTLC's recipient is fixed at
  creation — so a duel's stake can't sit in a trustless on-chain contract
  waiting for a winner to be decided. A house wallet holds both stakes and
  releases them once the server has resolved the duel. That trade-off is
  deliberate and stated up front, not hidden in the fine print.

## Try it

```bash
npm install
npm run dev -- --host
```

Vite prints a **Network URL** (not `localhost`) — open that inside Nimiq Pay
(Mini Apps → paste the URL). Your dev machine and phone need to be on the same
Wi-Fi network. Opened in a regular browser instead, the app shows a clear
"open me inside Nimiq Pay" screen rather than crashing.

```bash
npm run db:migrate   # set up the local schema
npm run db:seed      # seed the paragraph pool + a sample open entry
npm run server        # start the API on :8787
npm test               # run the test suite
npm run build           # typecheck everything + production build
```

## Project layout

```
src/                React app — UI, wallet connection, typing engine
shared/             Typing + timing replay logic used by both client and server
server/
  db/               Schema, migrations, seed data
  paragraphs/       Deterministic daily paragraph + practice-pool logic
  runs/             POST /api/runs — server-side keystroke replay and validation
```

## Everything currently testnet-only

No mainnet key ever touches this repo. Staking, escrow, and payouts run
exclusively against Nimiq testnet until the app is ready to ship for real.
