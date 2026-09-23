import type { Paragraph } from './service.ts'

// Seed content for the paragraph pool. Ids are stable so re-seeding is
// idempotent and daily-paragraph selection stays reproducible across
// environments once the pool stops changing.
const ENGLISH_PARAGRAPHS: Omit<Paragraph, 'language'>[] = [
  // easy
  { id: 'p-easy-01', difficulty: 'easy', body: 'The quick brown fox jumps over the lazy dog.' },
  { id: 'p-easy-02', difficulty: 'easy', body: 'She sells seashells down by the sunny shore.' },
  { id: 'p-easy-03', difficulty: 'easy', body: 'A small cat sat on the warm windowsill all day.' },
  { id: 'p-easy-04', difficulty: 'easy', body: 'We walked to the store and bought fresh bread.' },
  { id: 'p-easy-05', difficulty: 'easy', body: 'Rain fell softly on the quiet green hills tonight.' },
  { id: 'p-easy-06', difficulty: 'easy', body: 'He tied his shoes and ran out to catch the bus.' },
  { id: 'p-easy-07', difficulty: 'easy', body: 'The garden was full of bright red and yellow tulips.' },
  { id: 'p-easy-08', difficulty: 'easy', body: 'Every morning the baker opens the shop at six.' },
  { id: 'p-easy-09', difficulty: 'easy', body: 'Birds sang in the trees as the sun rose slowly.' },
  { id: 'p-easy-10', difficulty: 'easy', body: 'They played chess quietly by the fireplace all evening.' },

  // medium
  {
    id: 'p-med-01',
    difficulty: 'medium',
    body: 'Nimiq settles transactions in seconds, which makes it a natural fit for small, fast, everyday payments.',
  },
  {
    id: 'p-med-02',
    difficulty: 'medium',
    body: 'Typing quickly is a skill built through repetition: the fingers learn patterns long before the mind notices.',
  },
  {
    id: 'p-med-03',
    difficulty: 'medium',
    body: 'Before the market opened, traders reviewed overnight prices, checked their positions, and refilled their coffee.',
  },
  {
    id: 'p-med-04',
    difficulty: 'medium',
    body: "The library's third floor, rarely visited, held maps and journals nobody had opened in nearly forty years.",
  },
  {
    id: 'p-med-05',
    difficulty: 'medium',
    body: 'A well-tuned keyboard, a quiet room, and a steady breath: three small things that change how fast you type.',
  },
  {
    id: 'p-med-06',
    difficulty: 'medium',
    body: 'Escrow exists to remove trust from the equation; two strangers can transact without either one risking a scam.',
  },
  {
    id: 'p-med-07',
    difficulty: 'medium',
    body: 'The old lighthouse keeper climbed the spiral stairs twice a day, rain or shine, for thirty-one straight years.',
  },
  {
    id: 'p-med-08',
    difficulty: 'medium',
    body: 'Good server code assumes nothing from the client: every claim gets re-checked before it is ever trusted.',
  },
  {
    id: 'p-med-09',
    difficulty: 'medium',
    body: 'Between the two mountains ran a narrow river, cold even in August, fed by snow that never fully melted.',
  },
  {
    id: 'p-med-10',
    difficulty: 'medium',
    body: 'A duel is decided by milliseconds, so the clock has to start on the first keystroke, not on a button click.',
  },

  // hard
  {
    id: 'p-hard-01',
    difficulty: 'hard',
    body: 'Consensus, in a decentralized network, isn\'t agreement in the human sense: it\'s the emergent result of thousands of independent nodes each verifying the same rules, over and over, without ever needing to trust one another.',
  },
  {
    id: 'p-hard-02',
    difficulty: 'hard',
    body: 'By 11:47 PM, the storm (which the forecasters had, only six hours earlier, rated a 20% chance of arriving at all) had knocked out power to roughly 14,000 homes across three neighboring counties.',
  },
  {
    id: 'p-hard-03',
    difficulty: 'hard',
    body: 'The bigram "th" appears in nearly 4% of English text (think, that, this, other), which is exactly why a human\'s typing rhythm speeds up on it and a naive bot\'s, sampling each key from a fixed distribution, does not.',
  },
  {
    id: 'p-hard-04',
    difficulty: 'hard',
    body: 'Her thesis argued (convincingly, if a little combatively) that custodial escrow isn\'t a compromise forced on Nimiq by its lack of general smart contracts, but a deliberate, auditable trade-off any honest payments app eventually has to make.',
  },
  {
    id: 'p-hard-05',
    difficulty: 'hard',
    body: 'At dawn, the expedition\'s third and final attempt on the north ridge began: seven climbers, two guides, one radio with a battery that read 34%, and a weather window nobody expected to hold past noon.',
  },
  {
    id: 'p-hard-06',
    difficulty: 'hard',
    body: 'An idempotency key doesn\'t prevent a retry from happening; it prevents a retry from mattering: the second call to payout() with the same key returns the first result instead of moving money twice.',
  },
  {
    id: 'p-hard-07',
    difficulty: 'hard',
    body: 'The committee\'s report, released quietly on a Friday afternoon (a timing nobody believed was accidental), concluded that 62% of the delays traced back to a single, poorly-documented approval step.',
  },
  {
    id: 'p-hard-08',
    difficulty: 'hard',
    body: 'What separates a fast typist from a bot isn\'t top speed (a script can hit 300 WPM trivially); it\'s the jitter: the tiny, human, unrepeatable variance between one "e" and the next "e", forty milliseconds later.',
  },
  {
    id: 'p-hard-09',
    difficulty: 'hard',
    body: 'Three generations had run the shop at 14 Marchmont Street; the fourth, an economist by training, sold it in March, converted half the profit to NIM, and kept the receipt taped inside an old ledger.',
  },
  {
    id: 'p-hard-10',
    difficulty: 'hard',
    body: 'Every state machine has an implicit question baked into its transitions (not "what happens next" but "what happens if this exact event fires twice") and it\'s the second question that determines whether the system is actually safe.',
  },
]

// A smaller starter set for French and Spanish practice — real, correctly
// accented text, not machine-translated filler. Duels themselves draw from
// the generator (server/paragraphs/generator.ts); this fixed pool only
// backs practice mode's "today's paragraph" mechanic (server/paragraphs/service.ts),
// which needs at least two paragraphs per difficulty to have something left
// over once the day's one is excluded.
const FRENCH_PARAGRAPHS: Omit<Paragraph, 'language'>[] = [
  { id: 'p-fr-easy-01', difficulty: 'easy', body: 'Le chat dort sur le vieux canapé près de la fenêtre.' },
  { id: 'p-fr-easy-02', difficulty: 'easy', body: 'Elle marche vite pour attraper le dernier bus du soir.' },
  { id: 'p-fr-easy-03', difficulty: 'easy', body: 'Les enfants jouent dans le jardin après la pluie.' },
  {
    id: 'p-fr-med-01',
    difficulty: 'medium',
    body: 'Nimiq confirme les transactions en quelques secondes, ce qui convient parfaitement aux petits paiements rapides du quotidien.',
  },
  {
    id: 'p-fr-med-02',
    difficulty: 'medium',
    body: "Taper vite est une compétence qui vient de la répétition: les doigts apprennent les schémas bien avant que l'esprit ne les remarque.",
  },
  {
    id: 'p-fr-med-03',
    difficulty: 'medium',
    body: 'Un clavier bien réglé, une pièce silencieuse et une respiration stable: trois petites choses qui changent la vitesse de frappe.',
  },
  {
    id: 'p-fr-hard-01',
    difficulty: 'hard',
    body: "L'escrow existe pour retirer la confiance de l'équation: deux inconnus peuvent échanger sans que l'un ou l'autre ne risque une arnaque.",
  },
  {
    id: 'p-fr-hard-02',
    difficulty: 'hard',
    body: "Un duel se décide en millisecondes, si bien que l'horloge doit démarrer dès la première frappe, jamais au moment du clic sur un bouton.",
  },
]

const SPANISH_PARAGRAPHS: Omit<Paragraph, 'language'>[] = [
  { id: 'p-es-easy-01', difficulty: 'easy', body: 'El gato duerme sobre el viejo sofá junto a la ventana.' },
  { id: 'p-es-easy-02', difficulty: 'easy', body: 'Ella camina rápido para alcanzar el último autobús.' },
  { id: 'p-es-easy-03', difficulty: 'easy', body: 'Los niños juegan en el jardín después de la lluvia.' },
  {
    id: 'p-es-med-01',
    difficulty: 'medium',
    body: 'Nimiq confirma las transacciones en segundos, lo cual encaja perfectamente con los pagos pequeños y rápidos del día a día.',
  },
  {
    id: 'p-es-med-02',
    difficulty: 'medium',
    body: 'Escribir rápido es una habilidad que nace de la repetición: los dedos aprenden los patrones mucho antes que la mente los note.',
  },
  {
    id: 'p-es-med-03',
    difficulty: 'medium',
    body: 'Un teclado bien ajustado, una habitación silenciosa y una respiración estable: tres cosas pequeñas que cambian la velocidad al escribir.',
  },
  {
    id: 'p-es-hard-01',
    difficulty: 'hard',
    body: 'El depósito en garantía existe para quitar la confianza de la ecuación: dos desconocidos pueden intercambiar sin que ninguno arriesgue una estafa.',
  },
  {
    id: 'p-es-hard-02',
    difficulty: 'hard',
    body: 'Un duelo se decide en milisegundos, así que el reloj debe comenzar desde la primera pulsación, nunca en el momento de pulsar un botón.',
  },
]

function withLanguage(paragraphs: Omit<Paragraph, 'language'>[], language: Paragraph['language']): Paragraph[] {
  return paragraphs.map((p) => ({ ...p, language }))
}

export const PARAGRAPH_POOL: Paragraph[] = [
  ...withLanguage(ENGLISH_PARAGRAPHS, 'en'),
  ...withLanguage(FRENCH_PARAGRAPHS, 'fr'),
  ...withLanguage(SPANISH_PARAGRAPHS, 'es'),
]
