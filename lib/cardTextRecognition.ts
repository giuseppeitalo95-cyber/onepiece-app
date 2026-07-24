export type VisibleTextCard = {
  id?: string | null
  card_id?: string | null
  name?: string | null
  card_text?: string | null
  card_cost?: number | string | null
  card_power?: number | string | null
  card_counter?: number | string | null
  counter_amount?: number | string | null
  card_color?: string | null
  card_type?: string | null
  sub_types?: string | null
  attribute?: string | null
}

export type VisibleTextMatch<T extends VisibleTextCard> = {
  card: T
  score: number
  confident: boolean
  exactName: boolean
  nameCoverage: number
  nameMatches: number
  hasEffect: boolean
  effectMatches: number
  effectCoverage: number
  effectBigrams: number
  metadataMatches: number
  costMatch: boolean
  powerMatch: boolean
  counterMatch: boolean
}

const stopWords = new Set([
  'the', 'and', 'for', 'with', 'this', 'that', 'your', 'you', 'may', 'card', 'cards',
  'turn', 'play', 'from', 'when', 'then', 'cost', 'power', 'character', 'characters',
  'one', 'piece', 'activate', 'main', 'opponent', 'opponents', 'effect', 'can', 'cannot',
  'until', 'after', 'before', 'have', 'has', 'all', 'any', 'each', 'other',
  'are', 'was', 'were', 'been', 'being', 'its', 'his', 'her', 'their', 'our', 'not',
  'per', 'up', 'of', 'to', 'a', 'an', 'in', 'is', 'it', 'be', 'as', 'at', 'by', 'or', 'on'
])

const normalize = (value: string) =>
  value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

const compact = (value: string) => normalize(value).replace(/\s/g, '')
const words = (value: string) => normalize(value).split(' ').filter(Boolean)
const significantWords = (value: string) => words(value)
  .filter(token => token.length >= 3 && !stopWords.has(token))

const boundedEditDistance = (left: string, right: string, maximum: number) => {
  if (Math.abs(left.length - right.length) > maximum) return maximum + 1
  let previous = Array.from({ length: right.length + 1 }, (_, index) => index)

  for (let row = 1; row <= left.length; row += 1) {
    const current = [row]
    let rowMinimum = row
    for (let column = 1; column <= right.length; column += 1) {
      const substitution = previous[column - 1] + (left[row - 1] === right[column - 1] ? 0 : 1)
      const value = Math.min(previous[column] + 1, current[column - 1] + 1, substitution)
      current.push(value)
      rowMinimum = Math.min(rowMinimum, value)
    }
    if (rowMinimum > maximum) return maximum + 1
    previous = current
  }

  return previous[right.length]
}

const nameTokenMatches = (nameToken: string, ocrTokens: string[], ocrTokenSet: Set<string>) => {
  if (ocrTokenSet.has(nameToken)) return true
  if (nameToken.length < 4) return false

  const maximumDistance = nameToken.length >= 8 ? 2 : 1
  return ocrTokens.some(token =>
    token.length >= 4 &&
    Math.abs(token.length - nameToken.length) <= maximumDistance &&
    boundedEditDistance(nameToken, token, maximumDistance) <= maximumDistance
  )
}

const numericTokens = (value: string) => {
  const result = new Set<string>()
  const rawTokens = value.toUpperCase().split(/[^A-Z0-9]+/).filter(Boolean)

  for (const token of rawTokens) {
    if (!/^[0-9OILSB]{1,5}$/.test(token)) continue
    const normalized = token
      .replace(/O/g, '0')
      .replace(/[IL]/g, '1')
      .replace(/S/g, '5')
      .replace(/B/g, '8')
    if (/^\d{1,5}$/.test(normalized)) result.add(String(Number(normalized)))
  }

  return result
}

const bigramSet = (tokens: string[]) => {
  const result = new Set<string>()
  for (let index = 0; index < tokens.length - 1; index += 1) {
    result.add(`${tokens[index]} ${tokens[index + 1]}`)
  }
  return result
}

type CardTextFeatures = {
  normalizedName: string
  compactName: string
  nameWords: string[]
  effectTokens: string[]
  uniqueEffectTokens: string[]
  effectBigrams: Set<string>
  metadataTokens: string[]
  cost: string
  power: string
  counter: string
}

const cardTextFeatureCache = new WeakMap<object, CardTextFeatures>()

const getCardTextFeatures = <T extends VisibleTextCard>(card: T): CardTextFeatures => {
  const cached = cardTextFeatureCache.get(card)
  if (cached) return cached

  const name = String(card.name || '')
  const effectTokens = significantWords(String(card.card_text || ''))
  const rawCounter = card.card_counter ?? card.counter_amount
  const features: CardTextFeatures = {
    normalizedName: normalize(name),
    compactName: compact(name),
    nameWords: words(name),
    effectTokens,
    uniqueEffectTokens: [...new Set(effectTokens)],
    effectBigrams: bigramSet(effectTokens),
    metadataTokens: [...new Set(significantWords([
      card.card_color,
      card.card_type,
      card.sub_types,
      card.attribute
    ].filter(Boolean).join(' ')))],
    cost: card.card_cost == null ? '' : String(Number(card.card_cost)),
    power: card.card_power == null ? '' : String(Number(card.card_power)),
    counter: rawCounter == null ? '' : String(Number(rawCounter)),
  }
  cardTextFeatureCache.set(card, features)
  return features
}

export const rankCardsByVisibleText = <T extends VisibleTextCard>(ocrText: string, cards: T[]) => {
  const normalizedOcr = normalize(ocrText)
  const compactOcr = compact(ocrText)
  const ocrWords = words(ocrText)
  const ocrWordSet = new Set(ocrWords)
  const ocrSignificant = significantWords(ocrText)
  const ocrSignificantSet = new Set(ocrSignificant)
  const ocrBigrams = bigramSet(ocrSignificant)
  const ocrNumbers = numericTokens(ocrText)

  return cards
    .map((card, index): VisibleTextMatch<T> & { index: number } => {
      const features = getCardTextFeatures(card)
      const exactName = features.compactName.length >= 4 && (
        normalizedOcr.includes(features.normalizedName) || compactOcr.includes(features.compactName)
      )

      let nameMatchedWeight = 0
      let nameTotalWeight = 0
      let nameMatches = 0
      for (const token of features.nameWords) {
        const weight = Math.max(2, token.length)
        nameTotalWeight += weight
        if (nameTokenMatches(token, ocrWords, ocrWordSet)) {
          nameMatchedWeight += weight
          nameMatches += 1
        }
      }
      const nameCoverage = nameTotalWeight > 0 ? nameMatchedWeight / nameTotalWeight : 0

      const hasEffect = features.uniqueEffectTokens.length > 0
      const effectMatches = features.uniqueEffectTokens.filter(token => ocrSignificantSet.has(token)).length
      const effectCoverage = features.uniqueEffectTokens.length > 0
        ? effectMatches / features.uniqueEffectTokens.length
        : 0
      const effectBigrams = [...features.effectBigrams].filter(value => ocrBigrams.has(value)).length
      const metadataMatches = features.metadataTokens.filter(token => ocrSignificantSet.has(token)).length

      const costMatch = Boolean(features.cost && features.cost !== 'NaN' && ocrNumbers.has(features.cost))
      const powerMatch = Boolean(features.power && features.power !== 'NaN' && ocrNumbers.has(features.power))
      const counterMatch = Boolean(features.counter && features.counter !== 'NaN' && ocrNumbers.has(features.counter))
      const printedValueMatches = Number(costMatch) + Number(powerMatch) + Number(counterMatch)
      const strongNameIdentity = exactName || (nameCoverage >= 0.72 && nameMatches > 0)
      const noEffectIdentityBonus = !hasEffect && strongNameIdentity
        ? printedValueMatches * 17 + Math.min(metadataMatches, 3) * 3
        : 0

      const score =
        (exactName ? 120 : nameCoverage * 78) +
        nameMatches * 7 +
        effectMatches * 3.5 +
        effectCoverage * 42 +
        Math.min(effectBigrams, 8) * 3 +
        Math.min(metadataMatches, 6) * 2.5 +
        (costMatch ? 5 : 0) +
        (powerMatch ? 13 : 0) +
        (counterMatch ? 6 : 0) +
        noEffectIdentityBonus

      const strongName = strongNameIdentity
      const strongEffect = effectMatches >= 6 && effectCoverage >= 0.24
      const veryStrongEffect = effectMatches >= 9 && effectCoverage >= 0.34
      const confident =
        strongName ||
        veryStrongEffect ||
        (nameCoverage >= 0.45 && effectMatches >= 3) ||
        (strongEffect && (costMatch || powerMatch || counterMatch))

      return {
        card,
        score,
        confident,
        exactName,
        nameCoverage,
        nameMatches,
        hasEffect,
        effectMatches,
        effectCoverage,
        effectBigrams,
        metadataMatches,
        costMatch,
        powerMatch,
        counterMatch,
        index
      }
    })
    .filter(item => item.score > 0)
    .sort((left, right) => right.score - left.score || left.index - right.index)
}

const baseCardKey = (value: string) => {
  const raw = value.toLowerCase().replace(/[^a-z0-9_]/g, '')
  const withoutUnderscoreVariant = raw.replace(/_[pr]\d+$/i, '')
  return withoutUnderscoreVariant
    .replace(/[^a-z0-9]/g, '')
    .replace(/^((?:op|st|eb|prb|sp|ex|cp)\d{5,6}|p\d{3}|don\d{3})p\d+$/i, '$1')
}

export const selectCardsFromVisibleTextRanking = <T extends VisibleTextCard>(
  ranked: Array<VisibleTextMatch<T> & { index: number }>,
  cards: T[]
) => {
  const best = ranked.find(item => item.confident)
  if (!best) return []

  const weakEffectWithExactName = best.exactName && best.effectMatches < 3
  const noEffectWithStrongName =
    !best.hasEffect &&
    (best.exactName || (best.nameCoverage >= 0.72 && best.nameMatches > 0))
  const maximumFamilies = noEffectWithStrongName ? 20 : weakEffectWithExactName ? 32 : 14
  const selectedFamilyKeys: string[] = []

  for (const match of ranked) {
    const eligible = noEffectWithStrongName
      ? (
          (match.exactName || (match.nameCoverage >= 0.72 && match.nameMatches > 0)) &&
          match.score >= best.score - 22
        )
      : weakEffectWithExactName
        ? match.exactName
      : match.confident && match.score >= best.score - 42
    if (!eligible) continue

    const key = baseCardKey(String(match.card.card_id || match.card.id || ''))
    if (!key || selectedFamilyKeys.includes(key)) continue
    selectedFamilyKeys.push(key)
    if (selectedFamilyKeys.length >= maximumFamilies) break
  }

  const familyOrder = new Map(selectedFamilyKeys.map((key, index) => [key, index]))
  return cards
    .filter(card => familyOrder.has(baseCardKey(String(card.card_id || card.id || ''))))
    .sort((left, right) =>
      (familyOrder.get(baseCardKey(String(left.card_id || left.id || ''))) ?? 0) -
      (familyOrder.get(baseCardKey(String(right.card_id || right.id || ''))) ?? 0))
}

export const selectCardsByVisibleText = <T extends VisibleTextCard>(ocrText: string, cards: T[]) =>
  selectCardsFromVisibleTextRanking(rankCardsByVisibleText(ocrText, cards), cards)
