export type EntryStatus = 'OPEN' | 'LOCKED' | 'SETTLED' | 'EXPIRED'

export type Difficulty = 'easy' | 'medium' | 'hard'

/** PUBLIC entries are listed for anyone to browse; PRIVATE ones are reachable only via their shareable link. */
export type EntryVisibility = 'PUBLIC' | 'PRIVATE'

export type PayoutType = 'STAKE_RECEIVED' | 'PAYOUT' | 'REFUND'

export interface UserRow {
  id: string
  nim_address: string
  created_at: string
}

export interface ParagraphRow {
  id: string
  body: string
  difficulty: Difficulty
  created_at: string
}

export interface KeystrokeRunRow {
  id: string
  user_id: string
  paragraph_id: string
  events: string
  duration_ms: number | null
  /** JSON-encoded array of integrity flags (see server/runs/integrity.ts), or null if clean. */
  flags: string | null
  created_at: string
}

export interface EntryRow {
  id: string
  creator_user_id: string
  paragraph_id: string
  keystroke_run_id: string
  stake_luna: number
  status: EntryStatus
  created_at: string
  expires_at: string
  /** The on-chain stake transaction that funded this entry. UNIQUE — one stake can only ever back one entry. */
  stake_tx_hash: string | null
  visibility: EntryVisibility
}

export interface DuelRow {
  id: string
  entry_id: string
  challenger_user_id: string
  challenger_keystroke_run_id: string | null
  locked_at: string
  lock_ttl_expires_at: string
  winner_user_id: string | null
  settled_at: string | null
}

export interface PayoutRow {
  id: string
  idempotency_key: string
  entry_id: string | null
  duel_id: string | null
  user_id: string
  type: PayoutType
  amount_luna: number
  tx_hash: string | null
  created_at: string
}
