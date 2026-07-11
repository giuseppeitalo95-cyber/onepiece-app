import { createClient } from '@supabase/supabase-js'

const DEFAULT_SUPABASE_URL = 'https://jxwgbzatdueefdiyxlns.supabase.co'
const PRODUCT_CATALOG_URL = 'https://downloads.s3.cardmarket.com/productCatalog/productList/products_singles_18.json'
const PRICE_GUIDE_URL = 'https://downloads.s3.cardmarket.com/productCatalog/priceGuide/price_guide_18.json'

type ProductExport = {
  idProduct: number
  name: string
  idCategory: number
  categoryName: string
  idExpansion: number
  idMetacard: number
  dateAdded?: string | null
}

type PriceExport = {
  idProduct: number
  idCategory: number
  avg?: number | null
  low?: number | null
  trend?: number | null
  avg1?: number | null
  avg7?: number | null
  avg30?: number | null
  'low-foil'?: number | null
  'trend-foil'?: number | null
}

type PriceRow = {
  product_id: number
  card_id: string
  product_name: string
  clean_name: string | null
  category_id: number | null
  expansion_id: number | null
  metacard_id: number | null
  variant_rank: number
  price_low: number | null
  price_low_ex_plus: number | null
  price_trend: number | null
  price_avg: number | null
  price_avg_1: number | null
  price_avg_7: number | null
  price_avg_30: number | null
  currency: string
  product_date_added: string | null
  source_created_at: string | null
  synced_at: string
}

type LookupInput = {
  cardId?: string | null
  name?: string | null
  setName?: string | null
}

const getSupabaseUrl = () => {
  const value = process.env.NEXT_PUBLIC_SUPABASE_URL || DEFAULT_SUPABASE_URL
  try {
    const url = new URL(value)
    return url.protocol === 'http:' || url.protocol === 'https:' ? value : DEFAULT_SUPABASE_URL
  } catch {
    return DEFAULT_SUPABASE_URL
  }
}

const adminClient = () => {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!key) return null
  return createClient(getSupabaseUrl(), key, {
    auth: {
      persistSession: false,
      autoRefreshToken: false
    }
  })
}

const normalize = (value?: string | null) =>
  (value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

export const displayCardmarketPrice = (value?: number | null) =>
  value == null
    ? '-'
    : new Intl.NumberFormat('it-IT', { style: 'currency', currency: 'EUR' }).format(value)

const baseCardId = (value?: string | null) => {
  const raw = (value || '').trim().toUpperCase()
  const direct = raw.match(/((?:OP|ST|EB|PRB|SP|EX|CP)\d{2}-\d{3}|P-\d{3})/i)?.[1]
  return direct ? direct.toUpperCase() : ''
}

const variantRank = (value?: string | null) => {
  const match = (value || '').match(/(?:_p|p)(\d+)$/i)
  return match ? Number(match[1]) : 0
}

const parseProductCardId = (name?: string | null) =>
  (name || '').match(/\(((?:OP|ST|EB|PRB|SP|EX|CP)\d{2}-\d{3}|P-\d{3})\)/i)?.[1]?.toUpperCase() || ''

const cleanProductName = (name?: string | null) =>
  (name || '').replace(/\s*\(((?:OP|ST|EB|PRB|SP|EX|CP)\d{2}-\d{3}|P-\d{3})\)\s*$/i, '').trim()

const toNumber = (value?: number | string | null) => {
  if (value == null) return null
  const number = Number(value)
  return Number.isFinite(number) ? number : null
}

const fetchJson = async <T>(url: string): Promise<T> => {
  const res = await fetch(url, {
    headers: { Accept: 'application/json', 'User-Agent': 'OnePieceVault/1.0' },
    next: { revalidate: 60 * 60 * 8 }
  } as RequestInit & { next: { revalidate: number } })
  if (!res.ok) throw new Error(`Cardmarket export ${res.status}`)
  return res.json() as Promise<T>
}

const rowMarketPrice = (row: Pick<PriceRow, 'price_trend' | 'price_avg_7' | 'price_avg_30' | 'price_avg'>) =>
  row.price_trend ?? row.price_avg_7 ?? row.price_avg_30 ?? row.price_avg ?? null

const rowReferencePrice = (row: PriceRow) =>
  rowMarketPrice(row) ?? row.price_low ?? null

const priceDistance = (left: number | null, right: number | null) => {
  if (left == null || right == null || left <= 0 || right <= 0) return Number.POSITIVE_INFINITY
  return Math.abs(Math.log(left / right))
}

const inferVariantRanks = (rows: PriceRow[]) => {
  const byExpansion = new Map<string, PriceRow[]>()
  for (const row of rows) {
    const key = String(row.expansion_id ?? `product-${row.product_id}`)
    byExpansion.set(key, [...(byExpansion.get(key) || []), row])
  }

  const groups = [...byExpansion.values()].map(group => group.sort((a, b) => {
    const dateA = new Date(a.product_date_added || 0).getTime()
    const dateB = new Date(b.product_date_added || 0).getTime()
    return dateA - dateB || a.product_id - b.product_id
  }))
  const maxVariants = Math.max(1, ...groups.map(group => group.length))
  const anchor = groups
    .filter(group => group.length === maxVariants)
    .sort((a, b) => {
      const dateA = new Date(a[0]?.product_date_added || 0).getTime()
      const dateB = new Date(b[0]?.product_date_added || 0).getTime()
      return dateA - dateB
    })[0] || []

  const inferred = new Map<number, number>()
  for (const group of groups) {
    if (group.length === maxVariants) {
      group.forEach((row, index) => inferred.set(row.product_id, index))
      continue
    }

    const availableRanks = new Set(anchor.map((_, index) => index))
    for (const row of group) {
      const reference = rowReferencePrice(row)
      const closest = [...availableRanks]
        .map(rank => ({ rank, distance: priceDistance(reference, rowReferencePrice(anchor[rank])) }))
        .sort((a, b) => a.distance - b.distance || a.rank - b.rank)[0]
      const rank = closest?.rank ?? Math.min(row.variant_rank, maxVariants - 1)
      inferred.set(row.product_id, rank)
      availableRanks.delete(rank)
    }
  }

  return inferred
}

const scoreRow = (row: PriceRow, input: LookupInput) => {
  const wantedCardId = baseCardId(input.cardId)
  const wantedVariant = variantRank(input.cardId)
  const wantedName = normalize(input.name)
  const rowName = normalize(row.clean_name || row.product_name)
  let score = 0

  if (wantedCardId && row.card_id === wantedCardId) score += 120
  if (wantedName && rowName === wantedName) score += 40
  else if (wantedName && rowName.includes(wantedName)) score += 18

  if (row.variant_rank === wantedVariant) score += wantedVariant > 0 ? 70 : 55
  else if (wantedVariant > 0) score -= Math.abs(row.variant_rank - wantedVariant) * 28
  else if (row.variant_rank > 0) score -= 35 + row.variant_rank * 10

  const price = rowReferencePrice(row)
  if (price != null && price > 0) score += 12

  return score
}

export const getCardmarketExportPrice = async (input: LookupInput) => {
  const supabase = adminClient()
  if (!supabase) return null

  const wantedCardId = baseCardId(input.cardId)
  const wantedName = normalize(input.name)
  if (!wantedCardId && !wantedName) return null

  let rows: PriceRow[] = []
  if (wantedCardId) {
    const { data, error } = await supabase
      .from('cardmarket_prices')
      .select('*')
      .eq('card_id', wantedCardId)
      .order('product_date_added', { ascending: true, nullsFirst: false })
      .order('product_id', { ascending: true })
      .limit(80)

    if (!error && Array.isArray(data)) rows = data as PriceRow[]
  }

  if (rows.length === 0 && wantedName) {
    const { data, error } = await supabase
      .from('cardmarket_prices')
      .select('*')
      .ilike('clean_name', `%${wantedName}%`)
      .order('product_date_added', { ascending: true, nullsFirst: false })
      .order('product_id', { ascending: true })
      .limit(80)

    if (!error && Array.isArray(data)) rows = data as PriceRow[]
  }

  const wantedVariant = variantRank(input.cardId)
  const inferredRanks = inferVariantRanks(rows)

  const best = rows
    .map(row => {
      const inferredRank = inferredRanks.get(row.product_id) ?? row.variant_rank
      const rankedRow = inferredRank === row.variant_rank ? row : { ...row, variant_rank: inferredRank }
      return { row: rankedRow, score: scoreRow(rankedRow, input) }
    })
    .filter(item => item.score > 0)
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score
      if (a.row.variant_rank !== b.row.variant_rank) {
        return Math.abs(a.row.variant_rank - wantedVariant) - Math.abs(b.row.variant_rank - wantedVariant)
      }
      const aDate = new Date(a.row.product_date_added || 0).getTime()
      const bDate = new Date(b.row.product_date_added || 0).getTime()
      if (aDate !== bDate) return bDate - aDate
      return a.row.product_id - b.row.product_id
    })[0]

  if (!best) return null

  const marketPrice = rowMarketPrice(best.row) ?? best.row.price_low
  if (marketPrice == null) return null

  return {
    source: 'Cardmarket',
    provider: 'Cardmarket Data Export',
    currency: 'EUR',
    originalCurrency: 'EUR',
    exchangeRate: 1,
    productId: best.row.product_id,
    productUrl: `https://www.cardmarket.com/en/OnePiece/Products/Singles?idProduct=${best.row.product_id}`,
    productImageUrl: null,
    productName: best.row.product_name,
    groupName: best.row.expansion_id ? `Cardmarket expansion ${best.row.expansion_id}` : input.setName || null,
    marketPrice,
    lowPrice: best.row.price_low,
    midPrice: best.row.price_avg,
    highPrice: null,
    directLowPrice: best.row.price_low_ex_plus ?? best.row.price_low,
    originalMarketPrice: marketPrice,
    originalLowPrice: best.row.price_low,
    originalMidPrice: best.row.price_avg,
    originalHighPrice: null,
    originalDirectLowPrice: best.row.price_low_ex_plus ?? best.row.price_low,
    priceType: best.row.variant_rank > 0 ? `Variant ${best.row.variant_rank}` : 'Base',
    modifiedOn: best.row.source_created_at || best.row.synced_at
  }
}

export const syncCardmarketExports = async () => {
  const supabase = adminClient()
  if (!supabase) throw new Error('Missing SUPABASE_SERVICE_ROLE_KEY')

  const [catalog, guide] = await Promise.all([
    fetchJson<{ version: number; createdAt: string; products: ProductExport[] }>(PRODUCT_CATALOG_URL),
    fetchJson<{ version: number; createdAt: string; priceGuides: PriceExport[] }>(PRICE_GUIDE_URL)
  ])

  const priceByProduct = new Map<number, PriceExport>()
  for (const price of guide.priceGuides || []) {
    priceByProduct.set(Number(price.idProduct), price)
  }

  const products = (catalog.products || [])
    .map(product => ({
      product,
      cardId: parseProductCardId(product.name),
      cleanName: cleanProductName(product.name)
    }))
    .filter(item => item.cardId)

  const grouped = new Map<string, Array<{ product: ProductExport; cardId: string; cleanName: string }>>()
  for (const item of products) {
    const key = `${item.cardId}|${item.product.idExpansion}|${item.product.idMetacard}`
    grouped.set(key, [...(grouped.get(key) || []), item])
  }

  const syncedAt = new Date().toISOString()
  const rows: PriceRow[] = []

  grouped.forEach(group => {
    group
      .sort((a, b) => {
        const dateA = new Date(a.product.dateAdded || 0).getTime()
        const dateB = new Date(b.product.dateAdded || 0).getTime()
        if (dateA !== dateB) return dateA - dateB
        return Number(a.product.idProduct) - Number(b.product.idProduct)
      })
      .forEach((item, index) => {
        const price = priceByProduct.get(Number(item.product.idProduct))
        rows.push({
          product_id: Number(item.product.idProduct),
          card_id: item.cardId,
          product_name: item.product.name,
          clean_name: item.cleanName,
          category_id: Number(item.product.idCategory || 0) || null,
          expansion_id: Number(item.product.idExpansion || 0) || null,
          metacard_id: Number(item.product.idMetacard || 0) || null,
          variant_rank: index,
          price_low: toNumber(price?.low),
          price_low_ex_plus: null,
          price_trend: toNumber(price?.trend),
          price_avg: toNumber(price?.avg),
          price_avg_1: toNumber(price?.avg1),
          price_avg_7: toNumber(price?.avg7),
          price_avg_30: toNumber(price?.avg30),
          currency: 'EUR',
          product_date_added: item.product.dateAdded ? new Date(item.product.dateAdded).toISOString() : null,
          source_created_at: guide.createdAt ? new Date(guide.createdAt).toISOString() : null,
          synced_at: syncedAt
        })
      })
  })

  let saved = 0
  for (let index = 0; index < rows.length; index += 500) {
    const chunk = rows.slice(index, index + 500)
    const { error } = await supabase
      .from('cardmarket_prices')
      .upsert(chunk, { onConflict: 'product_id' })
    if (error) throw error
    saved += chunk.length
  }

  return {
    saved,
    productCount: products.length,
    priceCount: priceByProduct.size,
    sourceCreatedAt: guide.createdAt,
    syncedAt
  }
}
