DROP INDEX IF EXISTS entries_stake_tx_hash_idx;
ALTER TABLE entries DROP COLUMN stake_tx_hash;
