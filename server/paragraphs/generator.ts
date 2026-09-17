import { faker } from '@faker-js/faker'
import type { Difficulty } from '../db/types.ts'

/**
 * Freshly composes a typing paragraph instead of picking one from a fixed
 * pool. The old pool was keyed off the calendar date (see service.ts's
 * `getDailyParagraph`), which meant the *same* text backed every duel at a
 * given tier for an entire day — reveal one duel and you already know
 * every other duel's text until midnight. Building a new sentence from
 * word banks at reveal time (services/entries/service.ts) closes that
 * hole: nobody, including the creator, can know the text before staking.
 *
 * Difficulty is tuned by word length (longer, less common words for
 * harder tiers) and punctuation complexity, which is what actually makes
 * a line harder to *type* — not obscure vocabulary or literary quality.
 * Verbs stay in base/third-person-present form throughout (never past
 * tense) to sidestep irregular conjugation (`run` -> `ran`, not
 * `runned`) without needing a real grammar engine — a deliberate,
 * scoped-down tradeoff for a typing game, not an attempt at literary
 * coherence.
 */

type WordKind = 'adjective' | 'adverb' | 'conjunction' | 'noun' | 'preposition' | 'verb'

interface LengthRange {
  min: number
  max: number
}

/**
 * A pinch of Nimiq/typing-duel flavor mixed into otherwise-generic word
 * banks, so the content reads as *this app's* rather than interchangeable
 * lorem-ipsum-style filler. Only nouns/verbs/adjectives/adverbs get a
 * brand bank — prepositions and conjunctions are function words, and
 * branding those wouldn't read as anything.
 */
const BRANDED_WORDS: Partial<Record<WordKind, string[]>> = {
  noun: [
    'wallet', 'ledger', 'escrow', 'signer', 'keypair', 'address', 'duelist', 'stake', 'nimiq',
    'testnet', 'mainnet', 'keystroke', 'paragraph', 'opponent', 'rematch', 'custodian', 'validator',
    'consensus', 'mempool', 'signature', 'blockchain', 'transaction', 'leaderboard', 'challenger',
    'throughput', 'cryptography', 'interoperability', 'decentralization',
  ],
  verb: [
    'stake', 'settle', 'confirm', 'broadcast', 'verify', 'duel', 'race', 'reconcile', 'validate',
    'authenticate', 'rematch', 'typewrite',
  ],
  adjective: [
    'custodial', 'trustless', 'immutable', 'ephemeral', 'verifiable', 'unguessable', 'unstoppable',
    'cryptographic', 'deterministic', 'asynchronous', 'decentralized',
  ],
  adverb: [
    'instantly', 'securely', 'provably', 'verifiably', 'atomically', 'immutably', 'irrevocably',
    'anonymously', 'transparently', 'asynchronously',
  ],
}

/** How often a slot reaches for a branded word instead of a generic one, when a length-matching one exists. */
const BRAND_MIX_PROBABILITY = 0.35

function brandedWordInRange(kind: WordKind, length: LengthRange): string | undefined {
  const bank = BRANDED_WORDS[kind]
  if (!bank) return undefined
  const candidates = bank.filter((w) => w.length >= length.min && w.length <= length.max)
  return candidates.length > 0 ? faker.helpers.arrayElement(candidates) : undefined
}

function word(kind: WordKind, length: LengthRange): string {
  if (faker.datatype.boolean({ probability: BRAND_MIX_PROBABILITY })) {
    const branded = brandedWordInRange(kind, length)
    if (branded) return branded
  }
  const options = { length, strategy: 'closest' as const }
  switch (kind) {
    case 'adjective': return faker.word.adjective(options)
    case 'adverb': return faker.word.adverb(options)
    case 'conjunction': return faker.word.conjunction(options)
    case 'noun': return faker.word.noun(options)
    case 'preposition': return faker.word.preposition(options)
    case 'verb': return faker.word.verb(options)
  }
}

/**
 * Naive but real English pluralization/3rd-person-present suffix rule —
 * "verify" -> "verifies", not "verifys"; "rematch" -> "rematches", not
 * "rematchs". Matters more now that branded words (verify, rematch,
 * authenticate...) are common enough in the output that a broken suffix
 * on one of them reads as sloppy rather than just random-filler noise.
 */
function addS(base: string): string {
  if (/(?:[sxz]|ch|sh)$/.test(base)) return `${base}es`
  if (/[^aeiou]y$/.test(base)) return `${base.slice(0, -1)}ies`
  return `${base}s`
}

function capitalize(s: string): string {
  return s.length === 0 ? s : s.charAt(0).toUpperCase() + s.slice(1)
}

/** Naive but good-enough vowel-sound check for "a"/"an" agreement (spelling, not pronunciation — fine for filler text). */
function article(nextWord: string): string {
  return /^[aeiou]/i.test(nextWord) ? 'an' : 'a'
}

/** Trims/collapses whitespace, capitalizes the first letter, and ends with a period. */
function finish(raw: string): string {
  return `${capitalize(raw.trim().replace(/\s+/g, ' '))}.`
}

interface TemplateSlots {
  adj: () => string
  noun: () => string
  /** A fresh plural noun (own random draw, not a re-suffixed previous one). */
  nounPlural: () => string
  verb: () => string
  /** A fresh 3rd-person-singular-present verb, correctly suffixed. */
  verbS: () => string
  adv: () => string
  prep: () => string
  conj: () => string
  number: () => string
}

function slotsFor(length: LengthRange): TemplateSlots {
  return {
    adj: () => word('adjective', length),
    noun: () => word('noun', length),
    nounPlural: () => addS(word('noun', length)),
    verb: () => word('verb', length),
    verbS: () => addS(word('verb', length)),
    adv: () => word('adverb', length),
    prep: () => word('preposition', length),
    conj: () => word('conjunction', length),
    number: () => String(faker.number.int({ min: 2, max: 99 })),
  }
}

/** One clause, one comma at most — a two-part sentence, not a bare simple one. */
const TWO_CLAUSE_TEMPLATES: ((s: TemplateSlots) => string)[] = [
  (s) => { const adj = s.adj(); return `${article(adj)} ${adj} ${s.noun()} ${s.verbS()} ${s.adv()}, which ${s.verbS()} the ${s.adj()} ${s.noun()}` },
  (s) => `${s.adj()} ${s.nounPlural()} rarely ${s.verb()}, but ${s.adj()} ${s.nounPlural()} ${s.verb()} ${s.adv()}`,
  (s) => `if the ${s.noun()} ${s.verbS()} ${s.adv()}, the ${s.adj()} ${s.noun()} ${s.verbS()} ${s.prep()} the ${s.noun()}`,
  (s) => `the ${s.noun()}'s ${s.adj()} ${s.noun()} ${s.verbS()} ${s.adv()} ${s.prep()} the ${s.adj()} ${s.noun()}`,
]

/** Two clauses joined by a semicolon or "yet"/"although", a possessive, and a number. */
const SEMICOLON_TEMPLATES: ((s: TemplateSlots) => string)[] = [
  (s) => `the ${s.noun()}'s ${s.adj()} ${s.noun()} ${s.verbS()} ${s.adv()}; ${s.number()} ${s.nounPlural()} ${s.verb()} ${s.prep()} the ${s.adj()} ${s.noun()}`,
  (s) => `${s.adj()} ${s.nounPlural()} ${s.verb()} ${s.adv()}, yet the ${s.noun()}'s ${s.adj()} ${s.noun()} ${s.verbS()} the ${s.adj()} ${s.noun()} ${s.number()} times`,
  (s) => `although the ${s.adj()} ${s.noun()} ${s.verbS()} ${s.adv()}, the ${s.noun()}'s ${s.adj()} ${s.noun()} ${s.verbS()} ${s.prep()} ${s.number()} ${s.adj()} ${s.nounPlural()}`,
]

/** Three-plus clauses, multiple punctuation marks, two possessives, two numbers — the longest, most typo-prone shape. */
const MULTI_CLAUSE_TEMPLATES: ((s: TemplateSlots) => string)[] = [
  (s) => `${s.adj()} ${s.nounPlural()} ${s.verb()} ${s.adv()}: the ${s.noun()}'s ${s.adj()} ${s.noun()} ${s.verbS()} ${s.prep()} ${s.number()} ${s.adj()} ${s.nounPlural()}, yet the ${s.adj()} ${s.noun()} ${s.verbS()} ${s.adv()}`,
  (s) => `although the ${s.noun()}'s ${s.adj()} ${s.noun()} ${s.verbS()} ${s.adv()} ${s.prep()} ${s.number()} ${s.adj()} ${s.nounPlural()}; the ${s.adj()} ${s.noun()} ${s.verbS()} ${s.adv()}, and the ${s.noun()}'s ${s.adj()} ${s.noun()} ${s.verbS()} ${s.prep()} the ${s.adj()} ${s.noun()}`,
  (s) => `${s.number()} ${s.adj()} ${s.nounPlural()} ${s.verb()} ${s.adv()} ${s.prep()} the ${s.noun()}'s ${s.adj()} ${s.noun()}; ${s.number()} ${s.adj()} ${s.nounPlural()} ${s.verb()} ${s.adv()}, yet the ${s.adj()} ${s.noun()} ${s.verbS()} ${s.prep()} ${s.number()} ${s.adj()} ${s.nounPlural()}`,
]

const DIFFICULTY_CONFIG: Record<Difficulty, { length: LengthRange, templates: ((s: TemplateSlots) => string)[] }> = {
  easy: { length: { min: 5, max: 9 }, templates: TWO_CLAUSE_TEMPLATES },
  medium: { length: { min: 7, max: 12 }, templates: SEMICOLON_TEMPLATES },
  hard: { length: { min: 10, max: 18 }, templates: MULTI_CLAUSE_TEMPLATES },
}

/** A freshly composed paragraph for the given tier — a different one on every call. */
export function generateParagraph(difficulty: Difficulty): string {
  const { length, templates } = DIFFICULTY_CONFIG[difficulty]
  const template = faker.helpers.arrayElement(templates)
  return finish(template(slotsFor(length)))
}
