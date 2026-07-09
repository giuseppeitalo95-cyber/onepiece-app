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
const baseCardId = (value?: string | null) => compact(value).replace(/p\d+$/i, '')
const hasVariantSuffix = (value?: string | null) => /_?p\d+$/i.test(value || '')

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
  const optcgPrice = await getOptcgPrice(input)
  if (optcgPrice) return optcgPrice

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
  const usdToEur = await getUsdToEurRate()

  return {
    source: 'TCGplayer',
    provider: 'TCGCSV',
    currency: 'EUR',
    originalCurrency: 'USD',
    exchangeRate: usdToEur,
    productId: best.product.productId,
    productUrl: best.product.url || null,
    productImageUrl: best.product.imageUrl || null,
    productName: best.product.name,
    groupName: best.group.name,
    marketPrice: convertUsdToEur(price?.marketPrice, usdToEur),
    lowPrice: convertUsdToEur(price?.lowPrice, usdToEur),
    midPrice: convertUsdToEur(price?.midPrice, usdToEur),
    highPrice: convertUsdToEur(price?.highPrice, usdToEur),
    directLowPrice: convertUsdToEur(price?.directLowPrice, usdToEur),
    originalMarketPrice: price?.marketPrice ?? null,
    originalLowPrice: price?.lowPrice ?? null,
    originalMidPrice: price?.midPrice ?? null,
    originalHighPrice: price?.highPrice ?? null,
    originalDirectLowPrice: price?.directLowPrice ?? null,
    priceType: price?.subTypeName || null,
    modifiedOn: best.group.modifiedOn || null
  }
}
