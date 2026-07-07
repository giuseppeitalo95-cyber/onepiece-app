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

const CATEGORY_ID = 68
const PRICE_CACHE_MS = 5 * 60 * 1000

let groupsCache: { expiresAt: number; groups: TcgGroup[] } | null = null
const groupDataCache = new Map<number, { expiresAt: number; products: TcgProduct[]; prices: TcgPrice[] }>()

const normalize = (value?: string | null) =>
  (value || '')
    .toLowerCase()
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

const compact = (value?: string | null) => normalize(value).replace(/\s/g, '')

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
    productId: best.product.productId,
    productUrl: best.product.url || null,
    productName: best.product.name,
    groupName: best.group.name,
    marketPrice: price?.marketPrice ?? null,
    lowPrice: price?.lowPrice ?? null,
    midPrice: price?.midPrice ?? null,
    highPrice: price?.highPrice ?? null,
    directLowPrice: price?.directLowPrice ?? null,
    priceType: price?.subTypeName || null,
    modifiedOn: best.group.modifiedOn || null
  }
}
