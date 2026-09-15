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

**Phase 2 — Data model and migrations.** `server/db/` holds the schema: `users`,
`paragraphs`, `keystroke_runs`, `entries`, `duels`, `payouts`. An entry's `status`
(`OPEN → LOCKED → SETTLED`, or `OPEN/LOCKED → EXPIRED`) is the duel lifecycle from
the build plan — an explicit enum, not booleans. See
`server/db/migrations/0001_init/up.sql` for the full schema and
`server/db/types.ts` for the matching TS row types.

**Phase 3 — Paragraph service.** `server/paragraphs/` picks the daily paragraph
deterministically from a 30-paragraph pool (`pool-data.ts`, tagged easy/medium/hard)
by hashing the UTC calendar date, and `getPracticeParagraph()` always excludes
whatever is live as today's daily paragraph. `service.ts` is pure (pool in,
paragraph out) so it's tested directly — `npm test` checks 365 simulated days —
while `repository.ts` is the thin layer that fetches the pool from SQLite.

No typing engine, staking, or escrow yet — that's later phases. The server itself
(an API, as opposed to these service modules) doesn't exist yet either.

## Development

```bash
npm install
npm run dev -- --host
```

Note the **Network URL** Vite prints (not `localhost`), then inside Nimiq Pay go to
**Mini Apps** and enter that URL. The dev machine and phone must be on the same
Wi-Fi network.

## Database

SQLite via Node's built-in `node:sqlite` (experimental as of Node 22, but avoids
adding a dependency for the whole data layer). The file lives at
`server/db/data.sqlite` by default (gitignored); override with `DB_PATH`.

```bash
npm run db:migrate         # apply pending migrations
npm run db:migrate:down    # revert the most recent migration
npm run db:migrate:status  # list migrations and whether they're applied
npm run db:seed            # seed a fake OPEN entry for local testing
```

Migrations live in `server/db/migrations/<name>/{up,down}.sql`. Add a new
numbered directory per schema change; never edit an already-applied migration.

## Tests

```bash
npm test
```

Node's built-in test runner (`node --test`), no extra framework dependency.

## Custodial escrow

Nimiq has no general smart contracts — only basic, vesting, and HTLC accounts, and
an HTLC fixes its recipient at creation — so once staking lands (Phase 9), escrow is
custodial by necessity: a house wallet holds staked NIM until a duel settles. This
will be documented in code and expanded on here when that phase ships.
