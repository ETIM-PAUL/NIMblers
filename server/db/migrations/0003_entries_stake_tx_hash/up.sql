-- Links an entry to the exact on-chain stake transaction that funded it.
-- UNIQUE (not just indexed) so one stake transaction can never back more
-- than one entry — a retried "create entry" call after a timeout can't
-- accidentally spend the same stake twice, at the database level, not just
-- in application logic.
ALTER TABLE entries ADD COLUMN stake_tx_hash TEXT;
CREATE UNIQUE INDEX entries_stake_tx_hash_idx ON entries(stake_tx_hash);
