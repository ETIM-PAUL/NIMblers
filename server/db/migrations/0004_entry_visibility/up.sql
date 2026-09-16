-- Public entries show up in the open-duels dashboard for anyone to browse
-- and challenge. Private entries don't — the only way to reach one is the
-- shareable link its creator gets back, which carries the entry id
-- directly (a random UUID, unguessable). Challenging goes through the
-- exact same flow either way; visibility only controls whether
-- GET /api/entries lists it.
ALTER TABLE entries ADD COLUMN visibility TEXT NOT NULL DEFAULT 'PUBLIC' CHECK (visibility IN ('PUBLIC', 'PRIVATE'));
CREATE INDEX entries_visibility_idx ON entries(visibility);
