-- Double trial: A opts a fresh entry into it when creating it, then never
-- needs to come back online. If the challenger loses their first attempt,
-- they get one no-questions-asked retry at double the stake, resolved
-- automatically either way — see server/duels/service.ts.
ALTER TABLE entries ADD COLUMN allow_rematch INTEGER NOT NULL DEFAULT 0 CHECK (allow_rematch IN (0, 1));

-- Set the moment a losing first attempt is offered a retry; a scheduled
-- sweep auto-settles the duel as a loss if this passes with no retry taken
-- (server/duels/expiryJob.ts). Stays NULL for a duel that never triggers
-- the double-trial path at all.
ALTER TABLE duels ADD COLUMN retry_offer_expires_at TEXT;

-- The challenger's second attempt, if they took it. NULL until they do.
ALTER TABLE duels ADD COLUMN retry_keystroke_run_id TEXT REFERENCES keystroke_runs(id);
