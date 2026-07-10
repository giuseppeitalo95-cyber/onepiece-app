import { getCardmarketExportPrice } from './cardmarketPrices'

type PriceLookupInput = {
  cardId?: string | null
  name?: string | null
  setName?: string | null
}

type TcgGroup = {
  groupId: number
  name: string
  abbreviation?: string
  modifiedOn?: string
}

type TcgProduct = {
  productId: number
  name: string
  cleanName?: string
  url?: string
  imageUrl?: string
  groupId: number
  extendedData?: Array<{ name: string; value: string }>
}

type TcgPrice = {
  productId: number
  lowPrice?: number | null
  midPrice?: number | null
  highPrice?: number | null
  marketPrice?: number | null
  directLowPrice?: number | null
  subTypeName?: string | null
}

type OptcgCardPrice = {
  inventory_price?: number | string | null
  market_price?: number | string | null
  card_name?: string | null
  set_name?: string | null
  rarity?: string | null
  card_set_id?: string | null
  card_image_id?: string | null
  card_image?: string | null
  date_scraped?: string | null
}

type CardmarketApiCard = {
  id?: number | string | null
  name?: string | null
  name_numbered?: string | null
  card_number?: string | null
  rarity?: string | null
  cardmarket_id?: number | string | null
  prices?: {
    cardmarket?: {
      currency?: string | null
      lowest_near_mint?: number | string | null
      lowest_near_mint_IT?: number | string | null
      lowest_near_mint_DE?: number | string | null
      lowest_near_mint_FR?: number | string | null
      lowest_near_mint_ES?: number | string | null
      '7d_average'?: number | string | null
      '30d_average'?: number | string | null
    }
  }
  episode?: {
    name?: string | null
    code?: string | null
  }
  image?: string | null
  tcggo_url?: string | null
}

const CATEGORY_ID = 68
const PRICE_CACHE_MS = 5 * 60 * 1000

let groupsCache: { expiresAt: number; groups: TcgGroup[] } | null = null
let usdEurCache: { expiresAt: number; rate: number } | null = null
const groupDataCache = new Map<number, { expiresAt: number; products: TcgProduct[]; prices: TcgPrice[] }>()

const normalize = (value?: string | null) =>
  (value || '')
    .toLowerCase()
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

const compact = (value?: string | null) => normalize(value).replace(/\s/g, '')
const baseCardId = (value?: string | null) => {
  const raw = (value || '').toLowerCase().replace(/[^a-z0-9_]/g, '')
  const withoutUnderscoreVariant = raw.replace(/_p\d+$/i, '')
  return withoutUnderscoreVariant
    .replace(/[^a-z0-9]/g, '')
    .replace(/^((?:op|st|eb|prb|sp|ex|cp)\d{5,6}|p\d{3}|don\d{3})p\d+$/i, '$1')
}
const hasVariantSuffix = (value?: string | null) => {
  const raw = (value || '').toLowerCase().replace(/[^a-z0-9_]/g, '')
  const compactRaw = raw.replace(/[^a-z0-9]/g, '')
  return /_p\d+$/i.test(raw) || /^((?:op|st|eb|prb|sp|ex|cp)\d{5,6}|p\d{3}|don\d{3})p\d+$/i.test(compactRaw)
}
const hasVariantText = (value?: string | null) =>
  /\b(parallel|alternate|alt|special|manga|treasure|winner|super\s*parallel)\b|_?p\d+$/i.test(value || '')

const fetchJson = async (url: string) => {
  const res = await fetch(url, {
    headers: {
      Accept: 'application/json',
      'User-Agent': 'OnePieceVault/1.0'
    },
    next: { revalidate: 300 }
  } as RequestInit & { next: { revalidate: number } })

  if (!res.ok) throw new Error(`TCGCSV ${res.status}`)
  return res.json()
}

const getGroups = async () => {
  if (groupsCache && groupsCache.expiresAt > Date.now()) return groupsCache.groups

  const data = await fetchJson(`https://tcgcsv.com/tcgplayer/${CATEGORY_ID}/groups`)
  const groups = Array.isArray(data?.results) ? data.results : []
  groupsCache = {
    expiresAt: Date.now() + PRICE_CACHE_MS,
    groups
  }

  return groups as TcgGroup[]
}

const getGroupData = async (groupId: number) => {
  const cached = groupDataCache.get(groupId)
  if (cached && cached.expiresAt > Date.now()) return cached

  const [productsData, pricesData] = await Promise.all([
    fetchJson(`https://tcgcsv.com/tcgplayer/${CATEGORY_ID}/${groupId}/products`),
    fetchJson(`https://tcgcsv.com/tcgplayer/${CATEGORY_ID}/${groupId}/prices`)
  ])

  const data = {
    expiresAt: Date.now() + PRICE_CACHE_MS,
    products: Array.isArray(productsData?.results) ? productsData.results : [],
    prices: Array.isArray(pricesData?.results) ? pricesData.results : []
  }

  groupDataCache.set(groupId, data)
  return data
}

const getExtendedValue = (product: TcgProduct, key: string) =>
  product.extendedData?.find(item => item.name.toLowerCase() === key.toLowerCase())?.value || ''

const getUsdToEurRate = async () => {
  if (usdEurCache && usdEurCache.expiresAt > Date.now()) return usdEurCache.rate

  try {
    const data = await fetchJson('https://api.frankfurter.app/latest?from=USD&to=EUR')
    const rate = Number(data?.rates?.EUR)
    if (Number.isFinite(rate) && rate > 0) {
      usdEurCache = {
        expiresAt: Date.now() + PRICE_CACHE_MS,
        rate
      }
      return rate
    }
  } catch {
  }

  return 0.87689
}

const convertUsdToEur = (value?: number | null, rate = 1) =>
  value == null ? null : Number((value * rate).toFixed(2))

const toNumberOrNull = (value?: number | string | null) => {
  const number = Number(value)
  return Number.isFinite(number) ? number : null
}

const getCardmarketApiKey = () =>
  process.env.CARDMARKET_RAPIDAPI_KEY ||
  process.env.TCGGO_RAPIDAPI_KEY ||
  process.env.RAPIDAPI_KEY ||
  ''

const getCardmarketApiHosts = () => {
  const customHost = process.env.CARDMARKET_RAPIDAPI_HOST || process.env.TCGGO_RAPIDAPI_HOST
  return [
    customHost,
    'cardmarket-api-tcg.p.rapidapi.com'
  ].filter(Boolean) as string[]
}

const getCardmarketApiUrls = (host: string, search: string) => {
  const customBase = process.env.CARDMARKET_API_BASE_URL || process.env.TCGGO_API_BASE_URL
  const encodedSearch = encodeURIComponent(search)
  const bases = customBase
    ? [customBase.replace(/\/$/, '')]
    : [
        `https://${host}/one-piece`,
        `https://${host}/onepiece`,
        `https://${host}`
      ]

  return bases.flatMap(base => [
    `${base}/cards?search=${encodedSearch}`,
    `${base}/cards?q=${encodedSearch}`
  ])
}

const fetchCardmarketApi = async (url: string, host: string, key: string) => {
  const res = await fetch(url, {
    headers: {
      Accept: 'application/json',
      'User-Agent': 'OnePieceVault/1.0',
      'X-RapidAPI-Key': key,
      'X-RapidAPI-Host': host,
      'rapidapi-key': key
    },
    next: { revalidate: 300 }
  } as RequestInit & { next: { revalidate: number } })

  if (!res.ok) throw new Error(`Cardmarket API ${res.status}`)
  return res.json()
}

const unpackCardmarketResults = (data: unknown): CardmarketApiCard[] => {
  if (Array.isArray(data)) return data as CardmarketApiCard[]
  if (data && typeof data === 'object') {
    const object = data as Record<string, unknown>
    for (const key of ['results', 'data', 'cards', 'items']) {
      if (Array.isArray(object[key])) return object[key] as CardmarketApiCard[]
    }
    if (object.card_number || object.prices) return [object as CardmarketApiCard]
  }
  return []
}

const selectCardmarketCard = (cards: CardmarketApiCard[], input: PriceLookupInput) => {
  const wantedId = baseCardId(input.cardId)
  const wantedName = normalize(input.name)
  const wantsVariant = hasVariantSuffix(input.cardId)

  return cards
    .map(card => {
      const number = baseCardId(card.card_number)
      const name = normalize([card.name_numbered, card.name].filter(Boolean).join(' '))
      const variantLike = hasVariantText([card.card_number, card.name_numbered, card.name, card.rarity].filter(Boolean).join(' '))
      let score = 0

      if (wantedId && number === wantedId) score += 100
      if (wantedId && name.includes(wantedId)) score += 35
      if (wantedName && name.includes(wantedName)) score += 20
      if (wantsVariant && variantLike) score += 25
      if (!wantsVariant && !variantLike) score += 18
      if (!wantsVariant && variantLike) score -= 35

      return { card, score }
    })
    .filter(item => item.score > 0)
    .sort((a, b) => b.score - a.score)[0]?.card || cards[0]
}

const getCardmarketApiPrice = async (input: PriceLookupInput) => {
  const key = getCardmarketApiKey()
  const search = input.cardId || input.name
  if (!key || !search) return null

  for (const host of getCardmarketApiHosts()) {
    for (const url of getCardmarketApiUrls(host, search)) {
      try {
        const data = await fetchCardmarketApi(url, host, key)
        const card = selectCardmarketCard(unpackCardmarketResults(data), input)
        const cardmarket = card?.prices?.cardmarket
        if (!card || !cardmarket || cardmarket.currency !== 'EUR') continue

        const italyPrice = toNumberOrNull(cardmarket.lowest_near_mint_IT)
        const euLowPrice = toNumberOrNull(cardmarket.lowest_near_mint)
        const sevenDayAverage = toNumberOrNull(cardmarket['7d_average'])
        const thirtyDayAverage = toNumberOrNull(cardmarket['30d_average'])
        const marketPrice = italyPrice ?? euLowPrice ?? sevenDayAverage ?? thirtyDayAverage
        if (marketPrice == null) continue

        return {
          source: 'Cardmarket EU',
          provider: 'TCGGO/Cardmarket API',
          currency: 'EUR',
          originalCurrency: 'EUR',
          exchangeRate: 1,
          productId: card.cardmarket_id || card.id || card.card_number || input.cardId || null,
          productUrl: card.tcggo_url || url,
          productImageUrl: card.image || null,
          productName: card.name_numbered || card.name || input.name || null,
          groupName: card.episode?.name || input.setName || null,
          marketPrice,
          lowPrice: euLowPrice ?? marketPrice,
          midPrice: sevenDayAverage ?? marketPrice,
          highPrice: null,
          directLowPrice: italyPrice ?? euLowPrice ?? marketPrice,
          originalMarketPrice: marketPrice,
          originalLowPrice: euLowPrice ?? marketPrice,
          originalMidPrice: sevenDayAverage ?? marketPrice,
          originalHighPrice: null,
          originalDirectLowPrice: italyPrice ?? euLowPrice ?? marketPrice,
          priceType: card.rarity || null,
          modifiedOn: new Date().toISOString().slice(0, 10)
        }
      } catch {
        continue
      }
    }
  }

  return null
}

const getOptcgEndpoint = (cardId?: string | null) => {
  const raw = (cardId || '').toUpperCase().replace(/_P\d+$/i, '')
  if (/^ST\d{2}-\d{3}/.test(raw)) return `https://optcgapi.com/api/decks/card/${raw}/`
  if (/^P-\d{3}/.test(raw) || /^P\d{2}-\d{3}/.test(raw)) return `https://optcgapi.com/api/promos/card/${raw}/`
  if (/^(OP|EB|PRB)\d{2}-\d{3}/.test(raw)) return `https://optcgapi.com/api/sets/card/${raw}/`
  return null
}

const selectOptcgCard = (cards: OptcgCardPrice[], input: PriceLookupInput) => {
  const wantedId = compact(input.cardId)
  const wantedBase = baseCardId(input.cardId)
  const wantsVariant = hasVariantSuffix(input.cardId)

  return cards
    .map(card => {
      const setId = compact(card.card_set_id)
      const imageId = compact(card.card_image_id)
      const name = normalize(card.card_name)
      const wantedName = normalize(input.name)
      let score = 0

      if (wantedId && imageId === wantedId) score += 100
      if (wantedBase && baseCardId(card.card_set_id) === wantedBase) score += 60
      if (wantedBase && baseCardId(card.card_image_id) === wantedBase) score += 50
      if (!wantsVariant && imageId && !hasVariantSuffix(card.card_image_id)) score += 20
      if (wantsVariant && hasVariantSuffix(card.card_image_id)) score += 20
      if (wantedName && name.includes(wantedName)) score += 10
      if (setId === wantedId) score += 8

      return { card, score }
    })
    .filter(item => item.score > 0)
    .sort((a, b) => b.score - a.score)[0]?.card || cards[0]
}

const getOptcgPrice = async (input: PriceLookupInput) => {
  const endpoint = getOptcgEndpoint(input.cardId)
  if (!endpoint) return null

  try {
    const data = await fetchJson(endpoint)
    const cards = Array.isArray(data) ? data : [data]
    const card = selectOptcgCard(cards as OptcgCardPrice[], input)
    if (!card) return null

    const marketPrice = toNumberOrNull(card.market_price)
    const lowPrice = toNumberOrNull(card.inventory_price)
    if (marketPrice == null && lowPrice == null) return null

    return {
      source: 'OPTCGAPI',
      provider: 'OPTCGAPI',
      currency: 'EUR',
      originalCurrency: 'EUR',
      exchangeRate: 1,
      productId: card.card_image_id || card.card_set_id || input.cardId || null,
      productUrl: endpoint,
      productImageUrl: card.card_image || null,
      productName: card.card_name || input.name || null,
      groupName: card.set_name || input.setName || null,
      marketPrice,
      lowPrice,
      midPrice: marketPrice,
      highPrice: null,
      directLowPrice: lowPrice,
      originalMarketPrice: marketPrice,
      originalLowPrice: lowPrice,
      originalMidPrice: marketPrice,
      originalHighPrice: null,
      originalDirectLowPrice: lowPrice,
      priceType: card.rarity || null,
      modifiedOn: card.date_scraped || null
    }
  } catch {
    return null
  }
}

const getSetHint = (input: PriceLookupInput) => {
  const setName = normalize(input.setName)
  const cardId = normalize(input.cardId).replace(/\s/g, '')
  const prefix = cardId.match(/^(op|st|eb|prb|p)\d{2}/)?.[0] || ''
  return { setName, prefix }
}

const selectGroups = async (input: PriceLookupInput) => {
  const groups = await getGroups()
  const { setName, prefix } = getSetHint(input)
  const scored = groups
    .map(group => {
      const groupName = normalize(group.name)
      const abbreviation = normalize(group.abbreviation)
      let score = 0

      if (setName && (setName.includes(groupName) || groupName.includes(setName))) score += 12
      if (setName && abbreviation && setName.includes(abbreviation)) score += 10
      if (prefix && abbreviation.replace(/\s|-/g, '').includes(prefix)) score += 9
      if (prefix && groupName.replace(/\s|-/g, '').includes(prefix)) score += 6

      return { group, score }
    })
    .filter(item => item.score > 0)
    .sort((a, b) => b.score - a.score)
    .map(item => item.group)

  return scored.length > 0 ? scored.slice(0, 8) : groups.slice(0, 20)
}

const scoreProduct = (product: TcgProduct, input: PriceLookupInput) => {
  const wantedId = compact(input.cardId)
  const productNumber = compact(getExtendedValue(product, 'Number'))
  const wantedName = normalize(input.name)
  const productName = normalize(product.name)
  let score = 0

  if (wantedId && productNumber === wantedId) score += 100
  else if (wantedId && productNumber.includes(wantedId)) score += 60

  if (wantedName && productName === wantedName) score += 30
  else if (wantedName && productName.includes(wantedName)) score += 15

  return score
}

export const getLiveCardPrice = async (input: PriceLookupInput) => {
  const cardmarketExportPrice = await getCardmarketExportPrice(input)
  if (cardmarketExportPrice) return cardmarketExportPrice

  const useEuPrices = process.env.PRICE_MARKET !== 'US'
  const allowUsFallback = process.env.PRICE_ALLOW_US_FALLBACK === 'true'

  if (useEuPrices) {
    const cardmarketPrice = await getCardmarketApiPrice(input)
    if (cardmarketPrice) return cardmarketPrice

    const optcgPrice = await getOptcgPrice(input)
    if (optcgPrice) return optcgPrice

    if (!allowUsFallback) return null
  }

  const groups = await selectGroups(input)
  let best: { product: TcgProduct; price: TcgPrice | null; score: number; group: TcgGroup } | null = null

  for (const group of groups) {
    try {
      const data = await getGroupData(group.groupId)
      const pricesByProduct = new Map<number, TcgPrice>(
        data.prices.map((price: TcgPrice) => [price.productId, price])
      )

      for (const product of data.products) {
        const score = scoreProduct(product, input)
        if (score <= 0) continue

        if (!best || score > best.score) {
          best = {
            product,
            price: pricesByProduct.get(product.productId) || null,
            score,
            group
          }
        }
      }
    } catch {
      continue
    }
  }

  if (!best) return null

  const price = best.price

  return {
    source: 'TCGplayer',
    provider: 'TCGCSV',
    currency: 'USD',
    originalCurrency: 'USD',
    exchangeRate: 1,
    productId: best.product.productId,
    productUrl: best.product.url || null,
    productImageUrl: best.product.imageUrl || null,
    productName: best.product.name,
    groupName: best.group.name,
    marketPrice: price?.marketPrice ?? null,
    lowPrice: price?.lowPrice ?? null,
    midPrice: price?.midPrice ?? null,
    highPrice: price?.highPrice ?? null,
    directLowPrice: price?.directLowPrice ?? null,
    originalMarketPrice: price?.marketPrice ?? null,
    originalLowPrice: price?.lowPrice ?? null,
    originalMidPrice: price?.midPrice ?? null,
    originalHighPrice: price?.highPrice ?? null,
    originalDirectLowPrice: price?.directLowPrice ?? null,
    priceType: price?.subTypeName || null,
    modifiedOn: best.group.modifiedOn || null
  }
}
