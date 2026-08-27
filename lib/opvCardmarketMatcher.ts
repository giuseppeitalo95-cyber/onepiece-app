export const OPV_CARDMARKET_MATCHER_VERSION = 'opv-cardmarket-matcher/1.0.0'

export type OpvCardmarketCandidate = {
  product_id: number
  card_id: string
  product_name: string
  clean_name?: string | null
  category_id?: number | null
  expansion_id?: number | null
  variant_rank: number
  product_date_added?: string | null
}

export type OpvCardmarketMatchInput = {
  cardId?: string | null
  name?: string | null
  setName?: string | null
  referencePrice?: number | null
}

export type OpvExpansionLesson = {
  expansionId: number
  language: 'en'
  evidence: string
}

// Cardmarket groups one card code by metacard, then separates actual printings
// by expansion. These verified lessons identify the English expansion before
// choosing V.1/V.2 inside it. Add lessons by set, never one-off price hacks.
export const OPV_CARDMARKET_EXPANSION_LESSONS: Record<string, OpvExpansionLesson> = {
  ST10: {
    expansionId: 5380,
    language: 'en',
    evidence: 'Ultra Deck: The Three Captains (English)',
  },
}

export const OPV_CARDMARKET_REGRESSION_CASES = [
  {
    id: 'st10-006-english-base',
    cardId: 'ST10-006',
    setName: '-The Three Captains-[ST-10]',
    expectedProductId: 744752,
    lesson: 'Select the English ST10 expansion before Cardmarket version order.',
  },
] as const

const normalize = (value?: string | null) =>
  (value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

const baseCardId = (value?: string | null) =>
  (value || '').match(/((?:OP|ST|EB|PRB|SP|EX|CP)\d{2}-\d{3}|P-\d{3}|CM-\d+)/i)?.[1]?.toUpperCase() || ''

const setCode = (value?: string | null) =>
  baseCardId(value).match(/^(?:OP|ST|EB|PRB|SP|EX|CP)\d{2}/)?.[0] || ''

const variantRank = (value?: string | null) => {
  const match = (value || '').match(/(?:_p|p)(\d+)$/i)
  return match ? Number(match[1]) : 0
}

const specialVariantKind = (input: OpvCardmarketMatchInput) => {
  const text = normalize([input.cardId, input.name, input.setName].filter(Boolean).join(' '))
  if (/\bwinner\b/.test(text)) return 'winner'
  if (/\bjudge\b/.test(text)) return 'judge'
  if (/\bdon\b/.test(text)) return 'don'
  return null
}

const isStandardSetPrinting = (input: OpvCardmarketMatchInput, code: string) => {
  const text = normalize(input.setName)
  if (!text) return false
  if (/\b(promo|regional|winner|judge|anniversary|tournament|premium bandai|one piece day)\b/.test(text)) return false
  const spacedCode = code.replace(/([a-z]+)(\d+)/i, '$1 $2').toLowerCase()
  return text.includes(code.toLowerCase()) || text.includes(spacedCode)
}

const EXPANSION_DISCOVERY_CACHE_MS = 6 * 60 * 60 * 1000
const expansionDiscoveryCache = new Map<string, {
  expiresAt: number
  promise: Promise<OpvExpansionLesson | null>
}>()

const cardmarketEnglishFolders = (code: string) => {
  const folders = [code]
  const starter = code.match(/^ST(\d{2})$/)
  if (starter) folders.unshift(`ST-${starter[1]}`)
  const compact = code.replace('-', '')
  if (!folders.includes(compact)) folders.push(compact)
  return folders
}

const hasCardmarketImage = async (candidate: OpvCardmarketCandidate, folder: string) => {
  if (!candidate.category_id || !folder) return false
  const url = `https://product-images.s3.cardmarket.com/${candidate.category_id}/${folder}/${candidate.product_id}/${candidate.product_id}.jpg`
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 1800)

  try {
    const response = await fetch(url, {
      headers: {
        Range: 'bytes=0-31',
        Referer: 'https://www.cardmarket.com/',
        'User-Agent': 'OnePieceVault/1.0',
      },
      signal: controller.signal,
      cache: 'no-store',
    })
    await response.body?.cancel().catch(() => undefined)
    return response.ok
  } catch {
    return false
  } finally {
    clearTimeout(timeout)
  }
}

// The public Cardmarket product JSON exposes idExpansion but not its name or
// language. Its image archive does retain the set folder (OP16 vs OP16-JP), so
// OPV can identify the English expansion without guessing from prices.
export const discoverOpvEnglishExpansion = async (
  input: OpvCardmarketMatchInput,
  candidates: OpvCardmarketCandidate[],
): Promise<OpvExpansionLesson | null> => {
  const code = setCode(input.cardId)
  if (!code || !isStandardSetPrinting(input, code)) return null

  const verified = OPV_CARDMARKET_EXPANSION_LESSONS[code]
  if (verified) return verified

  const expansionIds = [...new Set(candidates
    .map(candidate => candidate.expansion_id)
    .filter((value): value is number => value != null))]
  if (expansionIds.length <= 1) {
    return expansionIds[0] == null ? null : {
      expansionId: expansionIds[0],
      language: 'en',
      evidence: 'unica espansione Cardmarket disponibile',
    }
  }

  const cached = expansionDiscoveryCache.get(code)
  if (cached && cached.expiresAt > Date.now()) return cached.promise

  const promise = (async () => {
    const folders = cardmarketEnglishFolders(code)
    const expansionSamples = expansionIds.map(expansionId => ({
      expansionId,
      candidates: candidates
        .filter(candidate => candidate.expansion_id === expansionId)
        .sort((left, right) => left.product_id - right.product_id)
        .slice(0, 2),
    }))

    const discovered = await Promise.all(expansionSamples.map(async sample => {
      for (const candidate of sample.candidates) {
        for (const folder of folders) {
          if (await hasCardmarketImage(candidate, folder)) {
            return { expansionId: sample.expansionId, folder }
          }
        }
      }
      return null
    }))
    const matches = discovered.filter((value): value is { expansionId: number; folder: string } => Boolean(value))
    if (matches.length !== 1) return null

    return {
      expansionId: matches[0].expansionId,
      language: 'en' as const,
      evidence: `archivio immagini Cardmarket ${matches[0].folder}`,
    }
  })()

  expansionDiscoveryCache.set(code, {
    expiresAt: Date.now() + EXPANSION_DISCOVERY_CACHE_MS,
    promise,
  })
  return promise
}

const priceDistance = (left?: number | null, right?: number | null) => {
  if (left == null || right == null || left <= 0 || right <= 0) return Number.POSITIVE_INFINITY
  return Math.abs(Math.log(left / right))
}

const expansionVersions = (rows: OpvCardmarketCandidate[]) => {
  const versionByProduct = new Map<number, number>()
  const grouped = new Map<number, OpvCardmarketCandidate[]>()

  for (const row of rows) {
    if (row.expansion_id == null) continue
    grouped.set(row.expansion_id, [...(grouped.get(row.expansion_id) || []), row])
  }

  for (const expansionRows of grouped.values()) {
    expansionRows
      .sort((left, right) => {
        const leftDate = new Date(left.product_date_added || 0).getTime()
        const rightDate = new Date(right.product_date_added || 0).getTime()
        return leftDate - rightDate || left.product_id - right.product_id
      })
      .forEach((row, index) => versionByProduct.set(row.product_id, index + 1))
  }

  return versionByProduct
}

export type OpvCardmarketMatch = {
  candidate: OpvCardmarketCandidate
  score: number
  confidence: 'high' | 'medium' | 'low'
  reasons: string[]
  expansionVersion: number | null
}

export const selectOpvCardmarketCandidate = ({
  input,
  candidates,
  priceOf,
  expansionLesson,
}: {
  input: OpvCardmarketMatchInput
  candidates: OpvCardmarketCandidate[]
  priceOf: (candidate: OpvCardmarketCandidate) => number | null
  expansionLesson?: OpvExpansionLesson | null
}): OpvCardmarketMatch | null => {
  const wantedCardId = baseCardId(input.cardId)
  const wantedName = normalize(input.name)
  const wantedVariant = variantRank(input.cardId)
  const wantedSetCode = setCode(input.cardId)
  const specialKind = specialVariantKind(input)
  const lesson = expansionLesson || (isStandardSetPrinting(input, wantedSetCode)
    ? OPV_CARDMARKET_EXPANSION_LESSONS[wantedSetCode]
    : null)
  const versionByProduct = expansionVersions(candidates)

  const ranked = candidates
    .map(candidate => {
      const reasons: string[] = []
      const rowName = normalize(candidate.clean_name || candidate.product_name)
      const expansionVersion = versionByProduct.get(candidate.product_id) ?? null
      let score = 0

      if (wantedCardId && candidate.card_id === wantedCardId) {
        score += 120
        reasons.push('codice esatto')
      }
      if (wantedName && rowName === wantedName) {
        score += 40
        reasons.push('nome esatto')
      } else if (wantedName && rowName.includes(wantedName)) {
        score += 18
        reasons.push('nome compatibile')
      }

      if (lesson) {
        if (candidate.expansion_id === lesson.expansionId) {
          score += 240
          reasons.push(`espansione inglese verificata: ${lesson.evidence}`)
          const wantedVersion = wantedVariant + 1
          if (expansionVersion === wantedVersion) {
            score += 100
            reasons.push(`versione Cardmarket V.${wantedVersion} esatta nell'espansione`)
          } else if (expansionVersion != null) {
            score -= Math.abs(expansionVersion - wantedVersion) * 45
          }
        } else {
          score -= 90
          reasons.push('espansione o lingua differente')
        }
      } else if (candidate.variant_rank === wantedVariant) {
        score += wantedVariant > 0 ? 70 : 55
        reasons.push('variante catalogo compatibile')
      } else if (wantedVariant > 0) {
        score -= Math.abs(candidate.variant_rank - wantedVariant) * 28
      } else if (candidate.variant_rank > 0) {
        score -= specialKind ? 6 + candidate.variant_rank * 2 : 35 + candidate.variant_rank * 10
      }

      const price = priceOf(candidate)
      if (price != null && price > 0) score += 12
      if (specialKind && price != null && price > 0) score += Math.min(90, Math.log10(price + 1) * 58)
      if (specialKind && rowName.includes(specialKind)) score += 80

      return { candidate, score, reasons, expansionVersion, price }
    })
    .filter(item => item.score > 0)
    .sort((left, right) => {
      if (right.score !== left.score) return right.score - left.score
      const leftDistance = priceDistance(left.price, input.referencePrice)
      const rightDistance = priceDistance(right.price, input.referencePrice)
      if (leftDistance !== rightDistance) return leftDistance - rightDistance
      const leftDate = new Date(left.candidate.product_date_added || 0).getTime()
      const rightDate = new Date(right.candidate.product_date_added || 0).getTime()
      if (leftDate !== rightDate) return rightDate - leftDate
      return left.candidate.product_id - right.candidate.product_id
    })

  const best = ranked[0]
  if (!best) return null
  const gap = best.score - (ranked[1]?.score ?? 0)

  return {
    candidate: best.candidate,
    score: best.score,
    confidence: gap >= 100 ? 'high' : gap >= 35 ? 'medium' : 'low',
    reasons: best.reasons,
    expansionVersion: best.expansionVersion,
  }
}
