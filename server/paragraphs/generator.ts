import { faker } from '@faker-js/faker'
import type { Difficulty, Language } from '../db/types.ts'

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

function generateEnglishParagraph(difficulty: Difficulty): string {
  const { length, templates } = DIFFICULTY_CONFIG[difficulty]
  const template = faker.helpers.arrayElement(templates)
  return finish(template(slotsFor(length)))
}

/**
 * A freshly composed paragraph for the given tier and language — a
 * different one on every call. French and Spanish (`generateFrenchParagraph`,
 * `generateSpanishParagraph` below) use their own hand-curated word banks
 * rather than `faker`'s English-only word module (Spanish locale data for
 * `word.*` doesn't exist in `@faker-js/faker` — it silently falls back to
 * English words — and French's, while real, doesn't carry the branded
 * vocabulary or the gender-agreement workarounds this needs).
 */
export function generateParagraph(difficulty: Difficulty, language: Language = 'en'): string {
  if (language === 'fr') return generateFrenchParagraph(difficulty)
  if (language === 'es') return generateSpanishParagraph(difficulty)
  return generateEnglishParagraph(difficulty)
}

// --- French ---
//
// French adjectives and articles inflect for grammatical gender, which a
// small hand-curated word bank has no reliable way to track per word. Two
// deliberate, documented simplifications sidestep that entirely, the same
// way the English generator above sidesteps verb tense:
//
// - Every sentence's subjects/objects are PLURAL, introduced by "les" (the
//   definite plural article) or "des" (the plural possessive/partitive,
//   from "de + les") — both are gender-invariant in French, unlike their
//   singular counterparts ("le/la", "du/de la").
// - Adjectives are drawn only from the subset that already end in an
//   unaccented "e" (rapide, stable, fiable...) — French adjectives ending
//   in "e" take the same form for masculine and feminine, so no agreement
//   step is needed at all.
// Verbs are stored pre-conjugated in third-person-plural present (to match
// the always-plural subject), not derived from an infinitive — sidestepping
// French's three conjugation groups and their irregulars entirely.

const FR_ADJECTIVES = [
  'rapide', 'facile', 'stable', 'calme', 'riche', 'capable', 'simple', 'utile', 'solide', 'fiable',
  'vérifiable', 'imprévisible', 'immuable', 'asynchrone', 'cryptographique', 'irrévocable', 'robuste',
  'flexible', 'durable', 'unique', 'moderne', 'efficace', 'invisible', 'responsable', 'comparable',
]

const FR_ADVERBS = [
  'rapidement', 'facilement', 'souvent', 'toujours', 'vite', 'bien', 'immédiatement', 'sûrement',
  'réellement', 'vraiment', 'simplement', 'clairement', 'régulièrement', 'exactement', 'précisément',
  'automatiquement', 'instantanément', 'efficacement', 'généralement', 'finalement',
]

const FR_PREPOSITIONS = ['dans', 'sur', 'avec', 'sans', 'pour', 'chez', 'vers', 'entre', 'sous', 'après', 'avant', 'malgré', 'selon', 'depuis']
const FR_CONJUNCTIONS = ['et', 'mais', 'donc', 'car', 'ou', 'quand', 'comme', 'si', 'alors', 'tandis que']

const FR_WORDS_BY_TIER: Record<Difficulty, { nouns: string[], verbs3p: string[] }> = {
  easy: {
    nouns: ['chats', 'chiens', 'jardins', 'matins', 'soirs', 'amis', 'jeux', 'mots', 'joueurs', 'villages'],
    verbs3p: ['mangent', 'jouent', 'dorment', 'courent', 'chantent', 'parlent', 'arrivent', 'restent', 'gagnent', 'perdent'],
  },
  medium: {
    nouns: [
      'portefeuilles', 'registres', 'signataires', 'adresses', 'duellistes', 'validateurs', 'consensus',
      'transactions', 'claviers', 'paragraphes', 'adversaires', 'revanches', 'réseaux', 'systèmes',
    ],
    verbs3p: [
      'confirment', 'valident', 'diffusent', 'vérifient', 'règlent', 'authentifient', 'affrontent',
      'transmettent', 'sécurisent', 'échangent',
    ],
  },
  hard: {
    nouns: [
      'décentralisations', 'interopérabilités', 'cryptographies', 'authentifications', 'infrastructures',
      'confidentialités', 'gouvernances', 'consortiums', 'protocoles', 'écosystèmes',
    ],
    verbs3p: [
      'décentralisent', 'authentifient', 'orchestrent', 'synchronisent', 'consolident', 'harmonisent',
      'reconstituent', 'redistribuent', 'interconnectent', 'supervisent',
    ],
  },
}

function frWord<T>(bank: T[]): T {
  return faker.helpers.arrayElement(bank)
}

/** Naive French plural-adjective/plural-preposition-agnostic suffix — regular enough for this curated bank. */
function frPlural(word: string): string {
  return /[sxz]$/.test(word) ? word : `${word}s`
}

function frSlots(difficulty: Difficulty) {
  const { nouns, verbs3p } = FR_WORDS_BY_TIER[difficulty]
  return {
    nounP: () => frWord(nouns),
    adjP: () => frPlural(frWord(FR_ADJECTIVES)),
    verbP: () => frWord(verbs3p),
    adv: () => frWord(FR_ADVERBS),
    prep: () => frWord(FR_PREPOSITIONS),
    conj: () => frWord(FR_CONJUNCTIONS),
    number: () => String(faker.number.int({ min: 2, max: 99 })),
  }
}

type FrSlots = ReturnType<typeof frSlots>

const FR_EASY_TEMPLATES: ((s: FrSlots) => string)[] = [
  (s) => `Les ${s.nounP()} ${s.adjP()} ${s.verbP()} ${s.adv()}, ${s.conj()} les ${s.nounP()} ${s.adjP()} ${s.verbP()} ${s.prep()} les ${s.nounP()}`,
  (s) => `Les ${s.nounP()} ${s.adjP()} ${s.verbP()} rarement, mais les ${s.nounP()} ${s.adjP()} ${s.verbP()} ${s.adv()}`,
]

const FR_MEDIUM_TEMPLATES: ((s: FrSlots) => string)[] = [
  (s) => `Les vitesses des ${s.nounP()} ${s.adjP()} ${s.verbP()} ${s.adv()}; ${s.number()} ${s.nounP()} ${s.verbP()} ${s.prep()} les ${s.nounP()} ${s.adjP()}`,
  (s) => `Les ${s.nounP()} ${s.adjP()} ${s.verbP()} ${s.adv()}, ${s.conj()} les forces des ${s.nounP()} ${s.adjP()} ${s.verbP()} les ${s.nounP()} ${s.number()} fois`,
]

const FR_HARD_TEMPLATES: ((s: FrSlots) => string)[] = [
  (s) => `Les ${s.nounP()} ${s.adjP()} ${s.verbP()} ${s.adv()} : les fiabilités des ${s.nounP()} ${s.verbP()} ${s.prep()} ${s.number()} ${s.nounP()} ${s.adjP()}, ${s.conj()} les ${s.nounP()} ${s.adjP()} ${s.verbP()} ${s.adv()}`,
  (s) => `Quand les ${s.nounP()} des ${s.nounP()} ${s.adjP()} ${s.verbP()} ${s.adv()} ${s.prep()} ${s.number()} ${s.nounP()} ${s.adjP()}, les ${s.nounP()} ${s.adjP()} ${s.verbP()} ${s.adv()}, ${s.conj()} les ${s.nounP()} ${s.verbP()} ${s.prep()} les ${s.nounP()} ${s.adjP()}`,
]

const FR_TEMPLATES_BY_TIER: Record<Difficulty, ((s: FrSlots) => string)[]> = {
  easy: FR_EASY_TEMPLATES,
  medium: FR_MEDIUM_TEMPLATES,
  hard: FR_HARD_TEMPLATES,
}

function generateFrenchParagraph(difficulty: Difficulty): string {
  const template = faker.helpers.arrayElement(FR_TEMPLATES_BY_TIER[difficulty])
  return finish(template(frSlots(difficulty)))
}

// --- Spanish ---
//
// Spanish's plural definite article DOES inflect for gender ("los"
// masculine, "las" feminine), so — unlike French — nouns are tagged with
// their gender here and the matching article is picked for each. Adjectives
// are still drawn only from Spanish's genuinely gender-invariant subset
// (ending in an unaccented consonant or in "-e": fácil, verde, fuerte...),
// so no adjective-agreement logic is needed, and verbs are stored
// pre-conjugated in third-person-plural present for the same reason as
// French: it sidesteps Spanish's three conjugation groups and their
// stem-changing irregulars rather than trying to derive them.

interface EsNoun { word: string, gender: 'm' | 'f' }

const ES_ADJECTIVES = [
  'fácil', 'difícil', 'feliz', 'capaz', 'veloz', 'eficaz', 'verde', 'grande', 'fuerte', 'inteligente',
  'importante', 'eficiente', 'resistente', 'flexible', 'estable', 'posible', 'visible', 'constante',
  'elegante', 'brillante', 'urgente', 'notable',
]

const ES_ADVERBS = [
  'rápidamente', 'fácilmente', 'siempre', 'a menudo', 'bien', 'inmediatamente', 'realmente', 'claramente',
  'exactamente', 'automáticamente', 'instantáneamente', 'eficazmente', 'generalmente', 'finalmente',
]

const ES_PREPOSITIONS = ['en', 'con', 'sin', 'para', 'por', 'hacia', 'entre', 'bajo', 'tras', 'desde', 'según']
const ES_CONJUNCTIONS = ['y', 'pero', 'entonces', 'porque', 'o', 'cuando', 'como', 'si', 'mientras', 'aunque']

const ES_WORDS_BY_TIER: Record<Difficulty, { nouns: EsNoun[], verbs3p: string[] }> = {
  easy: {
    nouns: [
      { word: 'gatos', gender: 'm' }, { word: 'perros', gender: 'm' }, { word: 'jardines', gender: 'm' },
      { word: 'amigos', gender: 'm' }, { word: 'juegos', gender: 'm' }, { word: 'palabras', gender: 'f' },
      { word: 'mañanas', gender: 'f' }, { word: 'tardes', gender: 'f' }, { word: 'casas', gender: 'f' },
      { word: 'calles', gender: 'f' },
    ],
    verbs3p: ['comen', 'juegan', 'duermen', 'corren', 'cantan', 'hablan', 'llegan', 'quedan', 'ganan', 'pierden'],
  },
  medium: {
    nouns: [
      { word: 'monederos', gender: 'm' }, { word: 'registros', gender: 'm' }, { word: 'validadores', gender: 'm' },
      { word: 'duelistas', gender: 'm' }, { word: 'adversarios', gender: 'm' }, { word: 'sistemas', gender: 'm' },
      { word: 'direcciones', gender: 'f' }, { word: 'transacciones', gender: 'f' }, { word: 'revanchas', gender: 'f' },
      { word: 'redes', gender: 'f' },
    ],
    verbs3p: ['confirman', 'validan', 'verifican', 'transmiten', 'autentican', 'aseguran', 'resuelven', 'intercambian'],
  },
  hard: {
    nouns: [
      { word: 'protocolos', gender: 'm' }, { word: 'ecosistemas', gender: 'm' }, { word: 'consorcios', gender: 'm' },
      { word: 'algoritmos', gender: 'm' }, { word: 'infraestructuras', gender: 'f' }, { word: 'gobernanzas', gender: 'f' },
      { word: 'interoperabilidades', gender: 'f' }, { word: 'autenticaciones', gender: 'f' },
    ],
    verbs3p: [
      'descentralizan', 'orquestan', 'sincronizan', 'consolidan', 'armonizan', 'reconstituyen',
      'redistribuyen', 'interconectan', 'supervisan',
    ],
  },
}

function esWord<T>(bank: T[]): T {
  return faker.helpers.arrayElement(bank)
}

/**
 * Naive Spanish plural-adjective suffix — regular enough for this curated
 * (already gender-invariant) bank, plus the one near-universal spelling
 * exception: a word-final "z" becomes "c" before "-es" (feliz -> felices,
 * capaz -> capaces), not "felizes"/"capazes".
 */
function esPluralAdjective(word: string): string {
  if (/z$/.test(word)) return `${word.slice(0, -1)}ces`
  return /[aeiouáéíóú]$/i.test(word) ? `${word}s` : `${word}es`
}

function esSlots(difficulty: Difficulty) {
  const { nouns, verbs3p } = ES_WORDS_BY_TIER[difficulty]
  return {
    noun: () => esWord(nouns),
    adjFor: () => esPluralAdjective(esWord(ES_ADJECTIVES)),
    article: (noun: EsNoun) => (noun.gender === 'm' ? 'los' : 'las'),
    verbP: () => esWord(verbs3p),
    adv: () => esWord(ES_ADVERBS),
    prep: () => esWord(ES_PREPOSITIONS),
    conj: () => esWord(ES_CONJUNCTIONS),
    number: () => String(faker.number.int({ min: 2, max: 99 })),
  }
}

type EsSlots = ReturnType<typeof esSlots>

/** `los`/`las X adjective` for a fresh random noun, agreement handled internally. */
function esNounPhrase(s: EsSlots): string {
  const noun = s.noun()
  return `${s.article(noun)} ${noun.word} ${s.adjFor()}`
}

/** No article — for right after a number, where Spanish (like English) drops it: "80 consorcios", not "80 los consorcios". */
function esBareNounPhrase(s: EsSlots): string {
  return `${s.noun().word} ${s.adjFor()}`
}

const ES_EASY_TEMPLATES: ((s: EsSlots) => string)[] = [
  (s) => `${esNounPhrase(s)} ${s.verbP()} ${s.adv()}, ${s.conj()} ${esNounPhrase(s)} ${s.verbP()} ${s.prep()} ${esNounPhrase(s)}`,
  (s) => `${esNounPhrase(s)} rara vez ${s.verbP()}, pero ${esNounPhrase(s)} ${s.verbP()} ${s.adv()}`,
]

const ES_MEDIUM_TEMPLATES: ((s: EsSlots) => string)[] = [
  (s) => `${esNounPhrase(s)} ${s.verbP()} ${s.adv()}; ${s.number()} ${esBareNounPhrase(s)} ${s.verbP()} ${s.prep()} ${esNounPhrase(s)}`,
  (s) => `${esNounPhrase(s)} ${s.verbP()} ${s.adv()}, ${s.conj()} ${esNounPhrase(s)} ${s.verbP()} ${esNounPhrase(s)} ${s.number()} veces`,
]

const ES_HARD_TEMPLATES: ((s: EsSlots) => string)[] = [
  (s) => `${esNounPhrase(s)} ${s.verbP()} ${s.adv()}: ${esNounPhrase(s)} ${s.verbP()} ${s.prep()} ${s.number()} ${esBareNounPhrase(s)}, ${s.conj()} ${esNounPhrase(s)} ${s.verbP()} ${s.adv()}`,
  (s) => `Cuando ${esNounPhrase(s)} ${s.verbP()} ${s.adv()} ${s.prep()} ${s.number()} ${esBareNounPhrase(s)}, ${esNounPhrase(s)} ${s.verbP()} ${s.adv()}, ${s.conj()} ${esNounPhrase(s)} ${s.verbP()} ${s.prep()} ${esNounPhrase(s)}`,
]

const ES_TEMPLATES_BY_TIER: Record<Difficulty, ((s: EsSlots) => string)[]> = {
  easy: ES_EASY_TEMPLATES,
  medium: ES_MEDIUM_TEMPLATES,
  hard: ES_HARD_TEMPLATES,
}

function generateSpanishParagraph(difficulty: Difficulty): string {
  const template = faker.helpers.arrayElement(ES_TEMPLATES_BY_TIER[difficulty])
  return finish(template(esSlots(difficulty)))
}
