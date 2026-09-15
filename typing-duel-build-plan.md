# Typing Duel — Phased Build Plan

A Nimiq Pay Mini App. Async 1v1 speed-typing duels with NIM stakes, server-refereed
timing, custodial escrow, on-chain payout.

Written for agentic development: each phase is one session's work, ends in a
runnable state, and has acceptance criteria an agent can check without you.

---

## Ground rules for the agent

Put these in `CLAUDE.md` / `AGENTS.md` at the repo root before phase 1.

- **Testnet only until Phase 13.** No mainnet key ever enters the repo or `.env`.
- **The client never reports a time.** It streams keystroke events. The server
  computes duration. Any PR where the client sends a `durationMs` is wrong.
- **Money moves in exactly one module.** All NIM transfers go through
  `services/escrow.ts`. Nothing else imports the wallet.
- **Every phase ends green.** Tests pass, app boots, previous phase still works.
- **No new dependencies without saying why** in the commit message.
- Stop and ask when a phase's acceptance criteria are ambiguous. Do not invent
  product decisions.

---

## Phase 1 — Scaffold and mini app shell

Vite + TS + React (or your preference), deployed somewhere with a public URL.
Wire `@nimiq/mini-app-sdk`, call `init()`, wait for the provider, list accounts,
show the connected NIM address on screen.

**Done when:** opening `nimiqpay://miniapp?url=<your-url>` inside Nimiq Pay shows
your address. Falls back to a "open me inside Nimiq Pay" screen in a normal
browser instead of crashing.

---

## Phase 2 — Data model and migrations

Tables: `users`, `paragraphs`, `entries`, `duels`, `keystroke_runs`, `payouts`.
Model the duel lifecycle as an explicit enum: `OPEN → LOCKED → SETTLED` plus
`EXPIRED`. No booleans standing in for state.

**Done when:** migrations run clean up and down, and a seed script creates a
fake open entry.

---

## Phase 3 — Paragraph service

A pool of paragraphs with a difficulty tag. One deterministic daily paragraph
selected by date. A separate `getPracticeParagraph()` that will **never** return
today's live one.

**Done when:** a test asserts the practice pool and the daily paragraph are
disjoint for 365 consecutive simulated days.

---

## Phase 4 — Typing engine (no money, no network)

The core of the product. Renders the paragraph, captures keydown, marks each
character correct/incorrect live, tracks caret position. Paste blocked. Drag-drop
blocked. Autocomplete and spellcheck off.

Submit stays disabled until the typed string matches the target exactly.

**Done when:** you can type a paragraph, see live per-character feedback, and the
button enables only on an exact match. Pasting does nothing.

---

## Phase 5 — Timing engine

Start the clock on the **first keystroke**, not on render. Stop it on the
keystroke that completes the exact match, **not** on the Submit click. Emit a
`KeystrokeRun`: ordered events with `{ key, tRelativeMs, resultingLength }`.

**Done when:** a scripted run of known intervals produces the exact expected
duration, and clicking Submit three seconds late does not change the recorded
time.

---

## Phase 6 — Practice mode, end to end

The whole game, free. Paragraph, typing, timing, result screen, personal best in
local storage. No wallet, no stake, no server settlement.

**Done when:** the app is genuinely fun to use with zero NIM involved. Stop here
and actually play it for ten minutes before continuing — if it isn't fun free,
stakes won't fix it.

---

## Phase 7 — Server-side run validation

Client POSTs the keystroke run. Server replays it: reconstructs the final string,
confirms exact match, recomputes duration independently. Rejects any run where the
client's reconstruction disagrees.

**Done when:** a tampered payload (edited timestamps, forged final string) is
rejected by tests, and the server's duration is what gets persisted.

---

## Phase 8 — Integrity layer

Statistical checks on inter-keystroke intervals:

- Reject runs above a hard WPM ceiling (start ~180, tune later).
- Flag near-uniform interval distributions (bot with fixed delay).
- Flag naive jitter (uniform noise around a constant).
- Flag missing bigram structure — humans type `th` fast and `qp` slow.
- Rate limit per address per day.

Flagged runs go to a review queue, they don't auto-void. You will get false
positives and you'd rather refund than wrongly confiscate.

**Done when:** three synthetic bot profiles are caught and a recording of you
typing is not.

---

## Phase 9 — Escrow service (testnet)

`services/escrow.ts`: a house wallet on testnet. Functions: `receiveStake`,
`payout`, `refund`, `getBalance`. Every movement written to `payouts` with an
idempotency key so a retry can't double-pay.

Nimiq has no general smart contracts — only basic, vesting and HTLC accounts, and
an HTLC fixes its recipient at creation — so escrow is custodial by necessity.
Make that explicit in the code comments and in your README.

**Done when:** you can stake and refund on testnet from a script, and calling
`payout` twice with the same key pays once.

---

## Phase 10 — Duel state machine

Pure logic, no I/O, heavily tested. Transitions:

```
create entry   → OPEN      (A staked, run recorded, time hidden)
challenge      → LOCKED    (B reserved it, TTL starts)
TTL expiry     → OPEN      (B never finished; B forfeits)
B submits      → SETTLED   (compare times, winner decided)
24h no taker   → EXPIRED   (A refunded)
```

The lock is what stops two challengers racing for one stake. Reserve on open, TTL
short, release on abandon.

**Done when:** property tests confirm no sequence of events ever settles a duel
twice, pays more than 2 NIM, or leaves a stake stranded.

---

## Phase 11 — Player A flow

Stake first, **then** reveal the paragraph. Type, submit, entry goes OPEN with the
time stored server-side and never sent to any client. A sees "waiting for a
challenger."

**Done when:** inspecting every network response on A's client shows no trace of
A's duration, and closing the tab mid-run forfeits rather than refunds.

---

## Phase 12 — Player B flow

B browses open entries (opponent address, stake, age — no time). Challenging locks
the entry and takes B's stake **before** the paragraph renders. Then the race,
against an opponent whose time B can't see.

**Done when:** two simultaneous challenge requests on the same entry produce one
lock and one clean rejection.

---

## Phase 13 — Settlement and payout

On B's submit: fetch A's time, compare, apply the 10% rake, pay 1.8 NIM to the
winner. Define the tie rule explicitly — recommend refunding both, minus nothing.
Show the reveal: both times, the delta, the transaction hash.

**Done when:** a full duel settles on testnet and the payout is verifiable in a
block explorer.

---

## Phase 14 — Expiry and refund job

Scheduled sweep: entries past 24 hours with no challenger get refunded; locks past
TTL get released. Must be idempotent — it will run twice one day.

**Done when:** an entry created 25 hours ago in test data is refunded exactly once
across three consecutive job runs.

---

## Phase 15 — Reveal, history, and ship

Ghost replay of the opponent's run on the result screen (you have the keystroke
data — it costs almost nothing and it's the most shareable thing in the app).
Duel history, leaderboard, a share card.

Then: mainnet key handling, a cap on house wallet balance, structured logging on
every state transition, README with the custodial-escrow explanation, open-source
licence, demo video.

**Done when:** someone who has never seen the app can install from the deeplink,
play practice, run a real duel, and understand where their money went.

---

## Suggested cut line

If time runs short, ship Phases 1–8 plus 15 as a **free** typing game with a
leaderboard. It's a complete, honest product. Money bolted on badly is worse than
no money at all, and a half-finished escrow is the one bug class that costs users
real value.
