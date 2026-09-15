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
   only after the stake is independently confirmed on-chain — never because a
   client claims it happened. There's no "changed my mind" undo: closing the
   tab before finishing forfeits the stake rather than refunding it, which is
   what keeps stake-then-abandon from being a free way to grief the house
   wallet. A fully submitted entry that nobody ever challenges *does* get
   refunded automatically after 24 hours.
2. **Type blind.** The client streams every keystroke to the server as it
   happens. The server — never the browser — computes the final time. A's time
   stays hidden from everyone, including A, until the duel resolves.
3. **Someone takes the bet.** Player B browses open stakes (opponent, amount,
   age — never a time) and matches one. That locks the entry — the lock is
   what stops two challengers racing for the same stake — and starts a
   timer for B's own run. If B never finishes, the lock expires and the
   entry reopens for someone else; A's stake is never at risk from a
   challenger who wanders off.
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
- **Duel lifecycle:** a pure state machine (`server/duels/stateMachine.ts`)
  with four states — `OPEN → LOCKED → SETTLED`, or `→ EXPIRED` — and no I/O
  at all, so it's property-tested directly: thousands of randomized event
  sequences, checked after every single step, confirm a duel can never
  settle twice, never owe more than the two stakes actually in its pot, and
  never end up in a terminal state with no one entitled to the money
- **No double-challenge race:** when two people try to challenge the same
  entry at once, the lock is a single conditional SQL `UPDATE ... WHERE
  status = 'OPEN'` with nothing async before it — SQLite is single-threaded,
  so the two requests literally cannot both see the entry as open. One
  locks it and gets the paragraph; the other gets a clean rejection,
  verified with real concurrent HTTP requests, not just sequential calls
- **Escrow:** custodial by necessity. Nimiq has no general smart contracts —
  only basic, vesting, and HTLC accounts, and an HTLC's recipient is fixed at
  creation — so a duel's stake can't sit in a trustless on-chain contract
  waiting for a winner to be decided. A house wallet, run by a real
  `@nimiq/core` light client, holds both stakes and releases them once the
  server has resolved the duel. That trade-off is deliberate and stated up
  front, not hidden in the fine print. Every movement — a stake received, a
  payout, a refund — is written to one ledger keyed by an idempotency key
  that's claimed atomically, so a retry (accidental or malicious) can never
  send twice. `services/escrow.ts` is the *only* module in the codebase
  allowed to touch that wallet.

## Try it

```bash
npm install
npm run db:migrate
npm run db:seed
npm run server        # API on :8787
npm run dev -- --host  # frontend on :5173, proxying /api to :8787
```

Vite prints a **Network URL** (not `localhost`) — open that inside Nimiq Pay
(Mini Apps → paste the URL). Your dev machine and phone need to be on the same
Wi-Fi network. Opened in a regular browser instead, the app shows a clear
"open me inside Nimiq Pay" screen rather than crashing. Staking requires the
API server to also have a funded house wallet — see below.

```bash
npm test    # run the test suite
npm run build  # typecheck everything + production build
```

## Project layout

```
src/                React app — UI, wallet connection, typing engine
shared/             Typing + timing replay logic used by both client and server
server/
  db/               Schema, migrations, seed data
  paragraphs/       Deterministic daily paragraph + practice-pool logic
  runs/             POST /api/runs — server-side keystroke replay and validation
  duels/            Pure state machine, plus Player B's flow — browse, challenge, submit
  entries/          Player A's flow — stake, reveal, submit, create the OPEN entry
services/
  escrow.ts         The one module allowed to move NIM — stake/payout/refund/balance
  nimiqWallet.ts    House wallet client (real @nimiq/core testnet light client)
scripts/            One-off scripts, e.g. a live testnet escrow demo
```

## House wallet setup (testnet)

`services/escrow.ts` needs a funded testnet house wallet:

```bash
node -e "import('@nimiq/core').then(N => console.log(N.PrivateKey.generate().toHex()))"
```

Put the result in `.env` as `ESCROW_PRIVATE_KEY` (never commit this — it's
gitignored, and it must never be a mainnet key). Then fund that address from
Nimiq Pay's testnet faucet: long-press the settings button for 10 seconds to
reveal the dev menu, switch to Testnet, and use "Get free NIM."

```bash
npm run escrow:demo
```

runs a full live-testnet round trip against the real network: connect,
receive a stake, refund it, and prove `payout()` sent only once when called
twice with the same idempotency key. A Nimiq light client needs a stable,
long-lived WebSocket connection to the network to establish consensus —
some restrictive environments (strict corporate proxies, some sandboxed CI
runners) can prevent that entirely; if the script times out waiting for
consensus, try it from a normal dev machine's network instead. The
idempotency guarantee itself doesn't depend on any of that — it's covered
by `services/escrow.test.ts` against a fake wallet, no network required.

## Everything currently testnet-only

No mainnet key ever touches this repo. Staking, escrow, and payouts run
exclusively against Nimiq testnet until the app is ready to ship for real.
