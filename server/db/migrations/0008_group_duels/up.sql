-- Group duels: a private N-player race for a friend group. One shared
-- paragraph fixed at creation (never regenerated, so everyone races the
-- same text), joined via a short shareable code rather than a link, and
-- resolved either once every joined participant has submitted or 72h
-- after creation, whichever comes first — the same "scheduled sweep
-- refunds what nobody finished" shape as entries' 24h window, just with
-- an N-way pot instead of a single opponent.
--
-- `settled_at IS NULL` (not `status`) is the resolution race guard,
-- mirroring duels.settled_at — resolveGroupDuel can be reached from two
-- places (an immediate "last submit completed the roster" check, and the
-- expiry sweep) and the conditional bookkeeping UPDATE at the end of
-- either path is what ensures only one of them actually records the
-- outcome.
CREATE TABLE group_duels (
  id TEXT PRIMARY KEY,
  -- Short, shareable in a group chat — unlike entries, which are reached
  -- via a link carrying their id directly.
  code TEXT NOT NULL UNIQUE,
  host_user_id TEXT NOT NULL REFERENCES users(id),
  -- Generated once at creation and never regenerated — every participant
  -- races the exact same text, revealed to each only after they stake.
  paragraph_id TEXT NOT NULL REFERENCES paragraphs(id),
  difficulty TEXT NOT NULL CHECK (difficulty IN ('easy', 'medium', 'hard')),
  language TEXT NOT NULL DEFAULT 'en' CHECK (language IN ('en', 'fr', 'es')),
  stake_luna INTEGER NOT NULL,
  -- Capped at 50 as a sane abuse guard, not a product requirement — raise
  -- it if a real friend group ever needs more.
  max_participants INTEGER NOT NULL CHECK (max_participants >= 2 AND max_participants <= 50),
  -- The atomic slot counter joinGroupDuel claims against (a single
  -- conditional UPDATE ... WHERE joined_count < max_participants), the
  -- same pattern challengeEntry uses to lock an entry without a mutex.
  joined_count INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN', 'SETTLED', 'EXPIRED')),
  created_at TEXT NOT NULL,
  -- 72h after creation; the sweep resolves anything still OPEN past this
  -- regardless of how many slots ever filled.
  expires_at TEXT NOT NULL,
  settled_at TEXT
);
CREATE INDEX group_duels_status_idx ON group_duels(status);

CREATE TABLE group_entries (
  id TEXT PRIMARY KEY,
  group_duel_id TEXT NOT NULL REFERENCES group_duels(id),
  user_id TEXT NOT NULL REFERENCES users(id),
  -- Present the moment a slot is claimed (join = stake), same as entries'
  -- stake_tx_hash. A row existing with no keystroke_run_id yet is exactly
  -- the "staked but hasn't typed" state the forfeiture rule is about.
  stake_tx_hash TEXT NOT NULL,
  joined_at TEXT NOT NULL,
  -- Set once this participant submits; still NULL at resolution means
  -- they forfeit into the pot rather than being refunded.
  keystroke_run_id TEXT REFERENCES keystroke_runs(id),
  -- Only ever set at resolution, for display — the race itself is decided
  -- by the server-recorded duration on keystroke_runs, not by this.
  rank INTEGER,
  payout_luna INTEGER,
  UNIQUE (group_duel_id, user_id)
);
CREATE UNIQUE INDEX group_entries_stake_tx_hash_idx ON group_entries(stake_tx_hash);
CREATE INDEX group_entries_group_duel_idx ON group_entries(group_duel_id);
