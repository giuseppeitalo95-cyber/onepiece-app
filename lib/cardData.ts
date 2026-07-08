type RawCard = Record<string, any>

const CACHE_DURATION_MS = 60 * 60 * 1000

let cardCache: {
  expiresAt: number
  cards: RawCard[]
} | null = null

const OPTCG_ENDPOINTS = [
  'https://www.optcgapi.com/api/allSetCards/',
  'https://www.optcgapi.com/api/allSTCards/',
  'https://www.optcgapi.com/api/allPromoCards/',
  'https://www.optcgapi.com/api/allDonCards/'
]

const OFFICIAL_RECENT_SERIES = [
  '569116', // OP16
  '569115', // OP15
  '569114', // OP14
  '569113', // OP13
  '569112', // OP12
  '569111', // OP11
  '569203', // EB03
  '569202', // EB02
  '569201', // EB01
  '569302', // PRB02
  '569301', // PRB01
  '569030',
  '569029',
  '569028',
  '569027',
  '569026',
  '569025',
  '569024',
  '569023',
  '569022',
  '569021',
  '569020',
  '569019',
  '569018',
  '569017',
  '569016',
  '569015',
  '569014',
  '569013',
  '569012',
  '569011',
  '569901',
  '569801'
]

const fetchOptions = {
  headers: { 'User-Agent': 'Mozilla/5.0' },
  next: { revalidate: 3600 }
} as RequestInit & { next: { revalidate: number } }

const htmlDecode = (value: string) =>
  value
    .replace(/&amp;/g, '&')
    .replace(/&#039;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

const textBetween = (html: string, pattern: RegExp) => {
  const match = html.match(pattern)
  return match ? htmlDecode(match[1]) : null
}

const numberOrNull = (value: string | null) => {
  if (!value || value === '-') return null
  const parsed = Number(value.replace(/[^0-9.-]/g, ''))
  return Number.isFinite(parsed) ? parsed : null
}

const fetchJsonArray = async (url: string) => {
  try {
    const res = await fetch(url, {
      headers: { Accept: 'application/json' },
      next: { revalidate: 3600 }
    } as RequestInit & { next: { revalidate: number } })
    if (!res.ok) return []

    const contentType = res.headers.get('content-type') || ''
    if (!contentType.includes('json')) return []

    const data = await res.json()
    return Array.isArray(data) ? data : [data]
  } catch {
    return []
  }
}

const parseOfficialCards = (html: string) => {
  const cards: RawCard[] = []
  const blocks = html.matchAll(/<dl class="modalCol" id="([^"]+)">([\s\S]*?)<\/dl>/g)

  for (const match of blocks) {
    const id = match[1]
    const block = match[2]
    const name = textBetween(block, /<div class="cardName">([\s\S]*?)<\/div>/)
    if (!id || !name) continue

    const info = textBetween(block, /<div class="infoCol">([\s\S]*?)<\/div>/)
    const infoParts = (info || '').split('|').map(part => part.trim())
    const rarity = infoParts[1] || null
    const cardType = infoParts[2] || null
    const imagePath = block.match(/data-src="\.\.\/images\/cardlist\/card\/([^"?]+)[^"]*"/)?.[1]

    cards.push({
      id,
      card_id: id,
      name,
      card_name: name,
      image_url: imagePath ? `https://en.onepiece-cardgame.com/images/cardlist/card/${imagePath}` : null,
      card_image: imagePath ? `https://en.onepiece-cardgame.com/images/cardlist/card/${imagePath}` : null,
      rarity,
      card_color: textBetween(block, /<div class="color"><h3>Color<\/h3>([\s\S]*?)<\/div>/),
      card_type: cardType,
      card_cost: numberOrNull(textBetween(block, /<div class="cost"><h3>Cost<\/h3>([\s\S]*?)<\/div>/)),
      card_power: numberOrNull(textBetween(block, /<div class="power"><h3>Power<\/h3>([\s\S]*?)<\/div>/)),
      card_text: textBetween(block, /<div class="text"><h3>Effect<\/h3>([\s\S]*?)<\/div>/) || '',
      set_name: textBetween(block, /<div class="getInfo"><h3>Card Set\(s\)<\/h3>([\s\S]*?)<\/div>/) || '',
      sub_types: textBetween(block, /<div class="feature"><h3>Type<\/h3>([\s\S]*?)<\/div>/) || '',
      market_price: null,
      inventory_price: null,
      source: 'official'
    })
  }

  return cards
}

const fetchOfficialSeriesIds = async () => {
  try {
    const res = await fetch('https://en.onepiece-cardgame.com/cardlist/', fetchOptions)
    if (!res.ok) return OFFICIAL_RECENT_SERIES

    const html = await res.text()
    const ids = [...html.matchAll(/<option value="([0-9]+)"/g)].map(match => match[1])
    const unique = [...new Set([...OFFICIAL_RECENT_SERIES, ...ids])]

    return unique.length > 0 ? unique : OFFICIAL_RECENT_SERIES
  } catch {
    return OFFICIAL_RECENT_SERIES
  }
}

const fetchOfficialCards = async () => {
  const seriesIds = await fetchOfficialSeriesIds()
  const results = await Promise.all(
    seriesIds.map(async series => {
      try {
        const res = await fetch(`https://en.onepiece-cardgame.com/cardlist/?series=${series}`, fetchOptions)
        if (!res.ok) return []
        return parseOfficialCards(await res.text())
      } catch {
        return []
      }
    })
  )

  return results.flat()
}

const getCardIdFromImage = (imageUrl?: string | null) => {
  const imageName = imageUrl?.split('/').pop()?.split('?')[0] || ''
  return imageName.match(/([A-Z]{1,4}\d{2}-\d{3}(?:_p\d+)?)/i)?.[1] || null
}

const normalizeOldCard = (card: RawCard) => {
  const rawId = String(card.card_set_id || card.card_id || card.id || '')
  const imageUrl = card.card_image || card.image_url || null
  const imageId = getCardIdFromImage(imageUrl)
  const id = imageId || rawId || `${card.card_name || card.name}`

  return {
    id,
    card_id: id,
    base_card_id: rawId || id,
    name: card.card_name || card.name || 'Carta',
    card_name: card.card_name || card.name || 'Carta',
    image_url: imageUrl,
    card_image: imageUrl,
    rarity: card.rarity || '-',
    market_price: null,
    inventory_price: null,
    card_color: card.card_color ?? null,
    card_type: card.card_type ?? null,
    card_cost: card.card_cost ? Number(card.card_cost) : null,
    card_power: card.card_power ? Number(card.card_power) : null,
    card_text: card.card_text || '',
    set_name: card.set_name || '',
    sub_types: card.sub_types || '',
    source: card.source || 'optcgapi'
  }
}

export const getAllCards = async () => {
  if (cardCache && cardCache.expiresAt > Date.now()) {
    return cardCache.cards
  }

  const [oldResults, officialCards] = await Promise.all([
    Promise.all(OPTCG_ENDPOINTS.map(fetchJsonArray)),
    fetchOfficialCards()
  ])

  const cards = [...officialCards.map(normalizeOldCard), ...oldResults.flat().map(normalizeOldCard)]
  const unique = new Map<string, RawCard>()

  for (const card of cards) {
    const key = `${card.card_id || card.id}-${card.name}`
    if (!unique.has(key) || unique.get(key)?.source !== 'official') {
      unique.set(key, card)
    }
  }

  const allCards = [...unique.values()]
  cardCache = {
    expiresAt: Date.now() + CACHE_DURATION_MS,
    cards: allCards
  }

  return allCards
}
