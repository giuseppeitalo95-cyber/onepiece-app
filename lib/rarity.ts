type RarityInput = {
  rarity?: string | null
  card_id?: string | null
  cardId?: string | null
  id?: string | null
  name?: string | null
}

const clean = (value?: string | null) =>
  String(value || '').trim()

const compact = (value?: string | null) =>
  clean(value).toLowerCase().replace(/[^a-z0-9]/g, '')

const baseRarityLabels: Array<[RegExp, string]> = [
  [/\bDON\b|^DON$/i, 'DON!!'],
  [/\bSEC\b|SECRET/i, 'Secret Rare'],
  [/\bSR\b|SUPER\s*RARE/i, 'Super Rare'],
  [/\bUC\b|UNCOMMON/i, 'Uncommon'],
  [/\bC\b|COMMON/i, 'Common'],
  [/\bL\b|LEADER/i, 'Leader'],
  [/\bR\b|RARE/i, 'Rare'],
  [/\bP\b|PROMO|PROMOTION/i, 'Promo'],
]

const variantLabels: Array<[RegExp, string]> = [
  [/manga|comic|super\s*parallel/i, 'Manga Rare'],
  [/\bSP\b|special/i, 'Special Rare'],
  [/\bTR\b|treasure/i, 'Treasure Rare'],
  [/winner/i, 'Winner'],
  [/judge/i, 'Judge'],
  [/anniversary|premium/i, 'Premium/Anniversary'],
  [/parallel|alternate|alternative|alt\s*art|_p\d+|p-\d+$/i, 'Alternative Art'],
]

export const getRarityLabel = (input?: RarityInput | string | null) => {
  const card = typeof input === 'string' ? { rarity: input } : input || {}
  const rarity = clean(card.rarity)
  const cardId = clean(card.card_id || card.cardId || card.id)
  const name = clean(card.name)
  const haystack = [rarity, cardId, name].filter(Boolean).join(' ')

  if (!haystack || /unknown/i.test(haystack)) return null

  const variants = variantLabels
    .filter(([pattern]) => pattern.test(haystack))
    .map(([, label]) => label)

  const base = baseRarityLabels.find(([pattern]) => pattern.test(rarity))?.[1]
    || baseRarityLabels.find(([pattern]) => pattern.test(haystack))?.[1]
    || rarity

  const uniqueVariants = [...new Set(variants)]
  if (uniqueVariants.length === 0) return base

  if (uniqueVariants.includes('Manga Rare')) return 'Manga Rare'
  if (uniqueVariants.includes('Special Rare')) return 'Special Rare'
  if (uniqueVariants.includes('Treasure Rare')) return 'Treasure Rare'
  if (uniqueVariants.includes('Winner')) return `${base} Winner`
  if (uniqueVariants.includes('Judge')) return `${base} Judge`
  if (uniqueVariants.includes('Premium/Anniversary')) return `${base} Premium/Anniversary`
  if (uniqueVariants.includes('Alternative Art')) return `${base} Alternative Art`

  return [base, ...uniqueVariants].join(' ')
}

export const rarityFilterValue = (input?: RarityInput | string | null) =>
  compact(getRarityLabel(input) || '')

