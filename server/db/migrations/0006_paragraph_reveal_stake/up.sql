-- Duel paragraphs are now generated fresh per reveal (server/paragraphs/generator.ts)
-- instead of picked from a fixed pool keyed by calendar date — the old scheme let
-- anyone derive today's paragraph for a tier without ever staking, since it was the
-- same text for every duel at that tier all day. This column ties a generated
-- paragraph to the specific (chain-verified) stake that revealed it, so a retried
-- reveal call finds the same paragraph again instead of generating a second one that
-- would no longer match what the player was actually shown.
ALTER TABLE paragraphs ADD COLUMN reveal_stake_tx_hash TEXT;
CREATE UNIQUE INDEX paragraphs_reveal_stake_tx_hash_idx ON paragraphs(reveal_stake_tx_hash);
