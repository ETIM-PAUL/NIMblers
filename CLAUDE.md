# NIMble — Agent Ground Rules

A Nimiq Pay Mini App. Async 1v1 speed-NIMbles with NIM stakes, server-refereed
timing, custodial escrow, on-chain payout.

Full phased build plan: [typing-duel-build-plan.md](typing-duel-build-plan.md). Build
one phase at a time, in order, unless told otherwise.

## Rules

- **Testnet only until Phase 13.** No mainnet key ever enters the repo or `.env`.
- **The client never reports a time.** It streams keystroke events. The server
  computes duration. Any PR where the client sends a `durationMs` is wrong.
- **Money moves in exactly one module.** All NIM transfers go through
  `services/escrow.ts`. Nothing else imports the wallet.
- **Every phase ends green.** Tests pass, app boots, previous phase still works.
- **No new dependencies without saying why** in the commit message.
- **No approval-dialog provider calls fire on page load without user interaction**
  (see `.agents/skills/mini-apps/references/checklist.md`). `init()` and
  `isConsensusEstablished()` are fine on mount; `listAccounts()` and anything that
  moves funds needs a tap first.
- Stop and ask when a phase's acceptance criteria are ambiguous. Do not invent
  product decisions.

## Stack

Vite + TypeScript + React, `@nimiq/mini-app-sdk` for the Nimiq provider. See the
bundled `mini-apps` skill (`.agents/skills/mini-apps/`) for the provider API and
pre-ship checklist.
