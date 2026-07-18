import { requireServiceClient } from '@/lib/serverSupabase'

// The upstream APIs expose extra fields over time; raw_data preserves them verbatim.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type RawCard = Record<string, any>

const CACHE_DURATION_MS = 15 * 60 * 1000
const PAGE_SIZE = 1000
const CATALOG_SELECT = 'variant_id,card_id,base_card_id,name,rarity,card_color,card_type,card_cost,card_power,card_counter,life,attribute,card_text,set_name,sub_types,market_price,inventory_price,source,source_image_url,r2_image_url,image_status,cardmarket_product_id,cardmarket_url,is_manual'

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
  '569116', '569115', '569114', '569113', '569112', '569111',
  '569203', '569202', '569201', '569302', '569301',
  '569030', '569029', '569028', '569027', '569026', '569025',
  '569024', '569023', '569022', '569021', '569020', '569019',
  '569018', '569017', '569016', '569015', '569014', '569013',
  '569012', '569011', '569901', '569801'
]

const htmlDecode = (value: string) => value
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

const numberOrNull = (value: unknown) => {
  if (value == null || value === '' || value === '-') return null
  const parsed = Number(String(value).replace(/[^0-9.-]/g, ''))
  return Number.isFinite(parsed) ? parsed : null
}

const withSourceMetadata = (card: RawCard, source: string, endpoint: string, index: number): RawCard => ({
  ...card,
  _opv_source: source,
  _opv_source_endpoint: endpoint,
  _opv_source_index: index,
})

const fetchJsonArray = async (url: string): Promise<RawCard[]> => {
  try {
    const response = await fetch(url, {
      headers: { Accept: 'application/json', 'User-Agent': 'OnePieceVault/1.0' },
      cache: 'no-store',
    })
    if (!response.ok) return []

    const contentType = response.headers.get('content-type') || ''
    if (!contentType.includes('json')) return []

    const data = await response.json() as RawCard | RawCard[]
    const rows: RawCard[] = Array.isArray(data) ? data : [data]
    return rows.map((card, index) => withSourceMetadata(card, 'optcgapi', url, index))
  } catch {
    return []
  }
}

const parseOfficialCards = (html: string, endpoint: string): RawCard[] => {
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
    const imageUrl = imagePath ? `https://en.onepiece-cardgame.com/images/cardlist/card/${imagePath}` : null

    cards.push(withSourceMetadata({
      id,
      card_id: id,
      card_set_id: id.replace(/_p\d+$/i, ''),
      name,
      card_name: name,
      image_url: imageUrl,
      card_image: imageUrl,
      rarity,
      card_color: textBetween(block, /<div class="color"><h3>Color<\/h3>([\s\S]*?)<\/div>/),
      card_type: cardType,
      card_cost: numberOrNull(textBetween(block, /<div class="cost"><h3>Cost<\/h3>([\s\S]*?)<\/div>/)),
      card_power: numberOrNull(textBetween(block, /<div class="power"><h3>Power<\/h3>([\s\S]*?)<\/div>/)),
      card_counter: numberOrNull(textBetween(block, /<div class="counter"><h3>Counter<\/h3>([\s\S]*?)<\/div>/)),
      card_text: textBetween(block, /<div class="text"><h3>Effect<\/h3>([\s\S]*?)<\/div>/) || '',
      set_name: textBetween(block, /<div class="getInfo"><h3>Card Set\(s\)<\/h3>([\s\S]*?)<\/div>/) || '',
      sub_types: textBetween(block, /<div class="feature"><h3>Type<\/h3>([\s\S]*?)<\/div>/) || '',
      market_price: null,
      inventory_price: null,
      source: 'official'
    }, 'official', endpoint, cards.length))
  }

  return cards
}

const fetchOfficialSeriesIds = async () => {
  try {
    const response = await fetch('https://en.onepiece-cardgame.com/cardlist/', {
      headers: { 'User-Agent': 'OnePieceVault/1.0' },
      cache: 'no-store',
    })
    if (!response.ok) return OFFICIAL_RECENT_SERIES

    const html = await response.text()
    const ids = [...html.matchAll(/<option value="([0-9]+)"/g)].map(match => match[1])
    const unique = [...new Set([...OFFICIAL_RECENT_SERIES, ...ids])]
    return unique.length > 0 ? unique : OFFICIAL_RECENT_SERIES
  } catch {
    return OFFICIAL_RECENT_SERIES
  }
}

const fetchOfficialCards = async (): Promise<RawCard[]> => {
  const seriesIds = await fetchOfficialSeriesIds()
  const results = await Promise.all(seriesIds.map(async series => {
    const endpoint = `https://en.onepiece-cardgame.com/cardlist/?series=${series}`
    try {
      const response = await fetch(endpoint, {
        headers: { 'User-Agent': 'OnePieceVault/1.0' },
        cache: 'no-store',
      })
      if (!response.ok) return []
      return parseOfficialCards(await response.text(), endpoint)
    } catch {
      return []
    }
  }))

  return results.flat()
}

const getCardIdFromImage = (imageUrl?: string | null) => {
  const imageName = imageUrl?.split('/').pop()?.split('?')[0] || ''
  return imageName.match(/((?:[A-Z]{1,4}\d{2}|P|DON)-\d{3}(?:_p\d+)?)/i)?.[1] || null
}

export const normalizeSourceCard = (card: RawCard) => {
  const rawId = String(card.card_set_id || card.base_card_id || card.card_id || card.id || '')
  const imageUrl = card.card_image || card.image_url || null
  const imageId = String(card.card_image_id || getCardIdFromImage(imageUrl) || '')
  const id = imageId || String(card.card_id || card.id || rawId || card.card_name || card.name || 'card')
  const baseCardId = rawId || id.replace(/_p\d+$/i, '')
  const source = String(card._opv_source || card.source || 'optcgapi')

  return {
    id,
    card_id: id,
    base_card_id: baseCardId,
    name: card.card_name || card.name || 'Carta',
    card_name: card.card_name || card.name || 'Carta',
    image_url: imageUrl,
    card_image: imageUrl,
    rarity: card.rarity || '-',
    market_price: numberOrNull(card.market_price),
    inventory_price: numberOrNull(card.inventory_price),
    card_color: card.card_color ?? null,
    card_type: card.card_type ?? null,
    card_cost: numberOrNull(card.card_cost),
    card_power: numberOrNull(card.card_power),
    card_counter: numberOrNull(card.card_counter ?? card.counter_amount),
    counter_amount: numberOrNull(card.counter_amount ?? card.card_counter),
    life: numberOrNull(card.life),
    attribute: card.attribute || '',
    card_text: card.card_text || '',
    set_name: card.set_name || '',
    sub_types: card.sub_types || '',
    source,
    source_endpoint: card._opv_source_endpoint || null,
    source_index: Number(card._opv_source_index || 0),
    source_updated_at: card.date_scraped || null,
  }
}

export const fetchSourceCards = async (): Promise<RawCard[]> => {
  const [oldResults, officialCards] = await Promise.all([
    Promise.all(OPTCG_ENDPOINTS.map(fetchJsonArray)),
    fetchOfficialCards(),
  ])
  return [...officialCards, ...oldResults.flat()]
}

const fromCatalogRow = (row: RawCard) => {
  const imageUrl = row.r2_image_url || row.source_image_url || null
  return {
    id: row.variant_id,
    card_id: row.card_id,
    base_card_id: row.base_card_id,
    name: row.name,
    card_name: row.name,
    image_url: imageUrl,
    card_image: imageUrl,
    source_image_url: row.source_image_url || null,
    r2_image_url: row.r2_image_url || null,
    rarity: row.rarity || '-',
    market_price: numberOrNull(row.market_price),
    inventory_price: numberOrNull(row.inventory_price),
    card_color: row.card_color ?? null,
    card_type: row.card_type ?? null,
    card_cost: numberOrNull(row.card_cost),
    card_power: numberOrNull(row.card_power),
    card_counter: numberOrNull(row.card_counter),
    counter_amount: numberOrNull(row.card_counter),
    life: numberOrNull(row.life),
    attribute: row.attribute || '',
    card_text: row.card_text || '',
    set_name: row.set_name || '',
    sub_types: row.sub_types || '',
    source: row.source || 'catalog',
    image_status: row.image_status || 'pending',
    cardmarket_product_id: row.cardmarket_product_id == null ? null : Number(row.cardmarket_product_id),
    cardmarket_url: row.cardmarket_url || null,
    is_manual: Boolean(row.is_manual),
  }
}

const loadCatalogCards = async () => {
  const client = requireServiceClient()
  const rows: RawCard[] = []

  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await client
      .from('card_catalog')
      .select(CATALOG_SELECT)
      .order('variant_id', { ascending: true })
      .range(from, from + PAGE_SIZE - 1)

    if (error) throw new Error(`Catalogo Supabase non disponibile: ${error.message}`)
    const page = data || []
    rows.push(...page)
    if (page.length < PAGE_SIZE) break
  }

  if (rows.length === 0) throw new Error('Catalogo Supabase vuoto: esegui la prima sincronizzazione')
  return rows.map(fromCatalogRow)
}

export const getCatalogCardsByBaseIds = async (values: string[]) => {
  const client = requireServiceClient()
  const baseIds = [...new Set(values
    .map(value => String(value || '').trim().toUpperCase().replace(/_P\d+$/i, ''))
    .filter(Boolean))]
  const rows: RawCard[] = []

  for (let index = 0; index < baseIds.length; index += 80) {
    const { data, error } = await client
      .from('card_catalog')
      .select(CATALOG_SELECT)
      .in('base_card_id', baseIds.slice(index, index + 80))
      .order('variant_id', { ascending: true })

    if (error) throw new Error(`Catalogo Supabase non disponibile: ${error.message}`)
    rows.push(...(data || []))
  }

  return rows.map(fromCatalogRow)
}

export const clearCardCache = () => {
  cardCache = null
}

export const getAllCards = async () => {
  if (cardCache && cardCache.expiresAt > Date.now()) return cardCache.cards

  try {
    const cards = await loadCatalogCards()
    cardCache = { expiresAt: Date.now() + CACHE_DURATION_MS, cards }
    return cards
  } catch (error) {
    if (cardCache?.cards.length) return cardCache.cards

    if (process.env.CARD_CATALOG_SOURCE_FALLBACK !== 'false') {
      const sourceCards = await fetchSourceCards()
      const unique = new Map<string, RawCard>()
      for (const raw of sourceCards) {
        const card = normalizeSourceCard(raw)
        const existing = unique.get(card.card_id)
        if (!existing || (card.source === 'official' && existing.source !== 'official')) {
          unique.set(card.card_id, card)
        }
      }
      const cards = [...unique.values()]
      cardCache = { expiresAt: Date.now() + CACHE_DURATION_MS, cards }
      return cards
    }

    throw error
  }
}
