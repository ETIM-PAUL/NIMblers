export type EntryStatus = 'OPEN' | 'LOCKED' | 'SETTLED' | 'EXPIRED'

export type Difficulty = 'easy' | 'medium' | 'hard'

export type Language = 'en' | 'fr' | 'es'

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
  language: Language
  created_at: string
  /** Set only for a paragraph generated fresh at reveal time — ties it to the stake that revealed it, so a retried reveal finds it again instead of generating a new one. Null for the old fixed pool (still used by practice mode). */
  reveal_stake_tx_hash: string | null
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
  /** Double trial: whoever loses a first attempt against this entry gets offered a retry at double the stake. */
  allow_rematch: 0 | 1
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
  /** Set the moment a losing first attempt is offered a retry; a sweep settles as a loss if this passes unused. */
  retry_offer_expires_at: string | null
  /** The challenger's second attempt, if they took it. */
  retry_keystroke_run_id: string | null
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
