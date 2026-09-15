-- Nullable JSON array of integrity flags (see server/runs/integrity.ts).
-- Null/absent means the run passed every check clean. A non-null value
-- means it was accepted but should go through the review queue rather
-- than auto-voided.
ALTER TABLE keystroke_runs ADD COLUMN flags TEXT;
