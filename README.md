# Typing Duel

A Nimiq Pay Mini App. Async 1v1 speed-typing duels with NIM stakes, server-refereed
timing, and custodial escrow.

See [typing-duel-build-plan.md](typing-duel-build-plan.md) for the full phased build
plan and [CLAUDE.md](CLAUDE.md) for the ground rules agents building this repo must
follow.

## Status

**Phase 1 — Scaffold and mini app shell.** Vite + TS + React, wired to
`@nimiq/mini-app-sdk`. Opening the app inside Nimiq Pay connects to the provider and
lets you reveal your NIM address; opened in a normal browser it shows a fallback
"open me inside Nimiq Pay" screen instead of crashing.

No typing engine, staking, or escrow yet — that's later phases.

## Development

```bash
npm install
npm run dev -- --host
```

Note the **Network URL** Vite prints (not `localhost`), then inside Nimiq Pay go to
**Mini Apps** and enter that URL. The dev machine and phone must be on the same
Wi-Fi network.

## Custodial escrow

Nimiq has no general smart contracts — only basic, vesting, and HTLC accounts, and
an HTLC fixes its recipient at creation — so once staking lands (Phase 9), escrow is
custodial by necessity: a house wallet holds staked NIM until a duel settles. This
will be documented in code and expanded on here when that phase ships.
