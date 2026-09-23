-- A duel's language is a property of its paragraph, exactly like difficulty
-- already is — a creator picks one when staking, the challenger just gets
-- whatever the entry's paragraph is written in. Defaults to 'en' so every
-- paragraph generated before this migration (and any caller that doesn't
-- pass one yet) is treated as English, unchanged.
ALTER TABLE paragraphs ADD COLUMN language TEXT NOT NULL DEFAULT 'en' CHECK (language IN ('en', 'fr', 'es'));
