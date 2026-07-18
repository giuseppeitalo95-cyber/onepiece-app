import { getAllCards, getCatalogCardsByBaseIds, getCatalogCardsByVariantIds, type RawCard } from '@/lib/cardData'

const CACHE_HEADERS = {
  'Cache-Control': 'public, s-maxage=3600, stale-while-revalidate=86400',
}

const normalize = (value: string) => value
  .toLowerCase()
  .replace(/[^a-z0-9]/g, ' ')
  .replace(/\s+/g, ' ')
  .trim()

const compact = (value: string) => normalize(value).replace(/\s/g, '')

const baseCode = (value: string) => {
  const raw = (value || '').toLowerCase().replace(/[^a-z0-9_]/g, '')
  return raw
    .replace(/_p\d+$/i, '')
    .replace(/[^a-z0-9]/g, '')
    .replace(/^((?:op|st|eb|prb|sp|ex|cp)\d{5,6}|p\d{3}|don\d{3})p\d+$/i, '$1')
}

const canonicalBaseId = (value: string) => {
  const raw = (value || '').trim().toUpperCase().replace(/\s+/g, '')
  const manualMatch = raw.match(/^(CM-\d+)(?:_?P\d+)?$/i)
  if (manualMatch) return manualMatch[1].toUpperCase()
  const match = raw.match(/^((?:OP|ST|EB|PRB|SP|EX|CP)\d{2}|P|DON)-?(\d{3})(?:_?P\d+)?$/i)
  return match ? `${match[1].toUpperCase()}-${match[2]}` : null
}

const looksLikeCodePrefix = (value: string) =>
  /^(op|st|eb|prb|sp|don|ex|cp|p)\d{0,3}\d{0,4}(?:p\d*)?$/i.test(compact(value))

const cardId = (card: RawCard) => compact(card.card_id || card.id || '')

type SearchIndexRow = {
  card: RawCard
  index: number
  id: string
  name: string
  nameTokens: string[]
  searchable: string
  compactSearchable: string
}

let searchIndexCache: { source: RawCard[]; rows: SearchIndexRow[] } | null = null

const getSearchIndex = (cards: RawCard[]) => {
  if (searchIndexCache?.source === cards) return searchIndexCache.rows

  const rows = cards.map((card, index) => {
    const searchable = normalize([
      card.name,
      card.card_name,
      card.card_id,
      card.id,
      card.rarity,
      card.card_cost,
      card.card_power,
      card.card_text,
      card.set_name,
      card.sub_types,
      card.card_type,
      card.card_color,
    ].filter(Boolean).join(' '))
    const name = normalize(card.card_name || card.name || '')

    return {
      card,
      index,
      id: cardId(card),
      name,
      nameTokens: name.split(' ').filter(Boolean),
      searchable,
      compactSearchable: searchable.replace(/\s/g, ''),
    }
  })

  searchIndexCache = { source: cards, rows }
  return rows
}

const uniqueCards = (cards: RawCard[], limit = 80) => {
  const seen = new Set<string>()
  return cards.filter(card => {
    const id = cardId(card)
    if (!id || seen.has(id)) return false
    seen.add(id)
    return true
  }).slice(0, limit)
}

const loadCardsByBaseIds = async (baseIds: string[]) => {
  try {
    return await getCatalogCardsByBaseIds(baseIds)
  } catch {
    const wanted = new Set(baseIds.map(baseCode))
    return (await getAllCards()).filter(card => wanted.has(baseCode(card.card_id || card.id || '')))
  }
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url)
  const q = searchParams.get('q')?.trim() || ''

  if (!q) return Response.json([], { headers: CACHE_HEADERS })

  try {
    const query = normalize(q)
    const compactQuery = compact(q)
    const queryTokens = query.split(' ').filter(token => token.length >= 2)
    const exactBaseId = canonicalBaseId(q)
    const cards = exactBaseId
      ? await loadCardsByBaseIds([exactBaseId])
      : await getAllCards()

    if (looksLikeCodePrefix(q)) {
      const wanted = baseCode(q)
      const variants = cards
        .map((card, index) => {
          const id = cardId(card)
          const baseId = baseCode(card.card_id || card.id || '')
          let score = 0

          if (exactBaseId && baseId === wanted) score += 100
          if (id === compactQuery) score += 80
          if (id.startsWith(compactQuery)) score += 60
          if (baseId.startsWith(wanted)) score += 45

          return { card, id, score, index }
        })
        .filter(item => item.score > 0)
        .sort((left, right) => {
          const leftVariant = /p\d+$/i.test(left.id) ? 1 : 0
          const rightVariant = /p\d+$/i.test(right.id) ? 1 : 0
          return right.score - left.score
            || leftVariant - rightVariant
            || left.id.localeCompare(right.id)
            || left.index - right.index
        })

      return Response.json(uniqueCards(variants.map(item => item.card)), { headers: CACHE_HEADERS })
    }

    const scoredCards = getSearchIndex(cards)
      .map(item => {
        let score = 0

        if (compactQuery && item.id === compactQuery) score += 100
        if (compactQuery && item.id.includes(compactQuery)) score += 40
        if (compactQuery && item.compactSearchable.includes(compactQuery)) score += 20
        if (query && item.name === query) score += 25
        if (query && item.name.includes(query)) score += 14
        if (query && item.searchable.includes(query)) score += 10

        for (const token of queryTokens) {
          if (item.nameTokens.includes(token)) score += 8
          else if (item.name.includes(token)) score += 5
          else if (item.searchable.includes(token)) score += 2
        }

        return { card: item.card, score, index: item.index }
      })
      .filter(item => item.score > 0)
      .sort((left, right) => right.score - left.score || left.index - right.index)
      .map(item => item.card)

    return Response.json(uniqueCards(scoredCards), { headers: CACHE_HEADERS })
  } catch (error) {
    console.error('Card search error:', error)
    return Response.json({ error: 'API error' }, { status: 500 })
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json()
    const ids: string[] = Array.isArray(body?.ids)
      ? body.ids.slice(0, 160).map((value: unknown) => String(value || ''))
      : []
    const baseIds = ids.map(canonicalBaseId).filter((value: string | null): value is string => Boolean(value))

    if (ids.length === 0) return Response.json([])
    const [exactCards, familyCards] = await Promise.all([
      getCatalogCardsByVariantIds(ids),
      baseIds.length > 0 ? loadCardsByBaseIds(baseIds) : Promise.resolve([]),
    ])
    return Response.json(uniqueCards([...exactCards, ...familyCards], 400))
  } catch (error) {
    console.error('Batch card lookup error:', error)
    return Response.json({ error: 'API error' }, { status: 500 })
  }
}
