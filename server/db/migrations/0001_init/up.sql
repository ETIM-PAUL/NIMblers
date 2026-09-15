CREATE TABLE users (
  id TEXT PRIMARY KEY,
  nim_address TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL
);

CREATE TABLE paragraphs (
  id TEXT PRIMARY KEY,
  body TEXT NOT NULL,
  difficulty TEXT NOT NULL CHECK (difficulty IN ('easy', 'medium', 'hard')),
  created_at TEXT NOT NULL
);

CREATE TABLE keystroke_runs (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  paragraph_id TEXT NOT NULL REFERENCES paragraphs(id),
  -- Ordered JSON array of { key, tRelativeMs, resultingLength } (see Phase 5).
  events TEXT NOT NULL,
  -- Null until the server independently recomputes it (Phase 7); the client
  -- never reports a duration.
  duration_ms INTEGER,
  created_at TEXT NOT NULL
);

-- One entry per staked, submitted run. This is what a challenger browses
-- and locks. Its `status` is the duel lifecycle from the build plan:
-- OPEN -> LOCKED -> SETTLED, or OPEN -> EXPIRED (24h, no taker) and
-- LOCKED -> OPEN (challenger's TTL lapsed, see the `duels` table).
CREATE TABLE entries (
  id TEXT PRIMARY KEY,
  creator_user_id TEXT NOT NULL REFERENCES users(id),
  paragraph_id TEXT NOT NULL REFERENCES paragraphs(id),
  keystroke_run_id TEXT NOT NULL REFERENCES keystroke_runs(id),
  stake_luna INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN', 'LOCKED', 'SETTLED', 'EXPIRED')),
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);

CREATE INDEX entries_status_idx ON entries(status);

-- Created the moment a challenger locks an OPEN entry. Absence of a duel
-- row means the entry has never been challenged.
CREATE TABLE duels (
  id TEXT PRIMARY KEY,
  entry_id TEXT NOT NULL UNIQUE REFERENCES entries(id),
  challenger_user_id TEXT NOT NULL REFERENCES users(id),
  -- Null until the challenger submits their run.
  challenger_keystroke_run_id TEXT REFERENCES keystroke_runs(id),
  locked_at TEXT NOT NULL,
  lock_ttl_expires_at TEXT NOT NULL,
  -- Null until settled; stays null on a tie (both refunded, Phase 13).
  winner_user_id TEXT REFERENCES users(id),
  settled_at TEXT
);

-- Every NIM movement the escrow service makes (Phase 9), keyed so a retry
-- can't double-pay.
CREATE TABLE payouts (
  id TEXT PRIMARY KEY,
  idempotency_key TEXT NOT NULL UNIQUE,
  entry_id TEXT REFERENCES entries(id),
  duel_id TEXT REFERENCES duels(id),
  user_id TEXT NOT NULL REFERENCES users(id),
  type TEXT NOT NULL CHECK (type IN ('STAKE_RECEIVED', 'PAYOUT', 'REFUND')),
  amount_luna INTEGER NOT NULL,
  tx_hash TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX payouts_user_idx ON payouts(user_id);
