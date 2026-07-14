export type VisibleTextCard = {
  id?: string | null
  card_id?: string | null
  name?: string | null
  card_text?: string | null
  card_cost?: number | string | null
  card_power?: number | string | null
}

export type VisibleTextMatch<T extends VisibleTextCard> = {
  card: T
  score: number
  confident: boolean
  exactName: boolean
  nameCoverage: number
  nameMatches: number
  effectMatches: number
  effectCoverage: number
  effectBigrams: number
  costMatch: boolean
  powerMatch: boolean
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
      const name = String(card.name || '')
      const normalizedName = normalize(name)
      const compactName = compact(name)
      const nameWords = words(name)
      const exactName = compactName.length >= 4 && (
        normalizedOcr.includes(normalizedName) || compactOcr.includes(compactName)
      )

      let nameMatchedWeight = 0
      let nameTotalWeight = 0
      let nameMatches = 0
      for (const token of nameWords) {
        const weight = Math.max(2, token.length)
        nameTotalWeight += weight
        if (nameTokenMatches(token, ocrWords, ocrWordSet)) {
          nameMatchedWeight += weight
          nameMatches += 1
        }
      }
      const nameCoverage = nameTotalWeight > 0 ? nameMatchedWeight / nameTotalWeight : 0

      const effectTokens = significantWords(String(card.card_text || ''))
      const uniqueEffectTokens = [...new Set(effectTokens)]
      const effectMatches = uniqueEffectTokens.filter(token => ocrSignificantSet.has(token)).length
      const effectCoverage = uniqueEffectTokens.length > 0
        ? effectMatches / uniqueEffectTokens.length
        : 0
      const effectBigrams = [...bigramSet(effectTokens)].filter(value => ocrBigrams.has(value)).length

      const cost = card.card_cost == null ? '' : String(Number(card.card_cost))
      const power = card.card_power == null ? '' : String(Number(card.card_power))
      const costMatch = Boolean(cost && cost !== 'NaN' && ocrNumbers.has(cost))
      const powerMatch = Boolean(power && power !== 'NaN' && ocrNumbers.has(power))

      const score =
        (exactName ? 120 : nameCoverage * 78) +
        nameMatches * 7 +
        effectMatches * 3.5 +
        effectCoverage * 42 +
        Math.min(effectBigrams, 8) * 3 +
        (costMatch ? 5 : 0) +
        (powerMatch ? 13 : 0)

      const strongName = exactName || (nameCoverage >= 0.72 && nameMatches > 0)
      const strongEffect = effectMatches >= 6 && effectCoverage >= 0.24
      const veryStrongEffect = effectMatches >= 9 && effectCoverage >= 0.34
      const confident =
        strongName ||
        veryStrongEffect ||
        (nameCoverage >= 0.45 && effectMatches >= 3) ||
        (strongEffect && (costMatch || powerMatch))

      return {
        card,
        score,
        confident,
        exactName,
        nameCoverage,
        nameMatches,
        effectMatches,
        effectCoverage,
        effectBigrams,
        costMatch,
        powerMatch,
        index
      }
    })
    .filter(item => item.score > 0)
    .sort((left, right) => right.score - left.score || left.index - right.index)
}

const baseCardKey = (value: string) => {
  const raw = value.toLowerCase().replace(/[^a-z0-9_]/g, '')
  const withoutUnderscoreVariant = raw.replace(/_p\d+$/i, '')
  return withoutUnderscoreVariant
    .replace(/[^a-z0-9]/g, '')
    .replace(/^((?:op|st|eb|prb|sp|ex|cp)\d{5,6}|p\d{3}|don\d{3})p\d+$/i, '$1')
}

export const selectCardsByVisibleText = <T extends VisibleTextCard>(ocrText: string, cards: T[]) => {
  const ranked = rankCardsByVisibleText(ocrText, cards)
  const best = ranked.find(item => item.confident)
  if (!best) return []

  const weakEffectWithExactName = best.exactName && best.effectMatches < 3
  const maximumFamilies = weakEffectWithExactName ? 32 : 14
  const selectedFamilyKeys: string[] = []

  for (const match of ranked) {
    const eligible = weakEffectWithExactName
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
