import { getAllCards } from '@/lib/cardData'
import { checkRateLimit, rateLimitResponse } from '@/lib/serverRateLimit'

type MetaDeckCard = {
  card_id: string
  name: string
  quantity: number
  image_url: string | null
  rarity: string | null
  card_color: string | null
  card_type: string | null
  card_cost: number | null
  card_power: number | null
}

const LIMITLESS_BASE = 'https://onepiece.limitlesstcg.com'
const META_CACHE_MS = 15 * 60 * 1000
let metaCache: { expiresAt: number; decks: unknown[] } | null = null
let metaLoadPromise: Promise<unknown[]> | null = null

const decodeHtml = (value: string) =>
  value
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/&rsquo;/g, "'")
    .replace(/&lsquo;/g, "'")
    .replace(/&eacute;/g, 'é')
    .replace(/&uuml;/g, 'ü')
    .replace(/<[^>]+>/g, '')
    .trim()

const compactCardId = (value?: string | null) => (value || '').toLowerCase().replace(/[^a-z0-9]/g, '')

const findCatalogCard = (catalogById: Map<string, any>, cardId: string) =>
  catalogById.get(compactCardId(cardId)) || catalogById.get(compactCardId(cardId).replace(/p\d+$/i, ''))

const parseDeckSummary = (html: string) => {
  const decks: Array<{ id: string; title: string; player: string; placement: string; url: string }> = []
  const rowRegex = /<tr>\s*<td>([^<]+)<\/td>\s*<td><a href="\/decks\/list\/(\d+)">([\s\S]*?)<\/a><\/td>\s*<\/tr>/g
  let match: RegExpExecArray | null

  while ((match = rowRegex.exec(html)) && decks.length < 36) {
    const [, placement, id, rawTitle] = match
    const title = decodeHtml(rawTitle.replace(/<span class="annotation">[\s\S]*?<\/span>/, ''))
    const player = decodeHtml(rawTitle.match(/<span class="annotation">by ([\s\S]*?)<\/span>/)?.[1] || '')
    decks.push({
      id,
      title,
      player,
      placement: decodeHtml(placement),
      url: `${LIMITLESS_BASE}/decks/list/${id}`
    })
  }

  return decks
}

const parseDeckDetail = (
  html: string,
  summary: { id: string; title: string; player: string; placement: string; url: string },
  catalogById: Map<string, any>
) => {
  const cards: MetaDeckCard[] = []
  const cardRegex = /<div class="decklist-card" data-count="(\d+)" data-id="([^"]+)"[\s\S]*?<span class="card-name">([^<]+)<\/span>[\s\S]*?<\/div>/g
  let match: RegExpExecArray | null

  while ((match = cardRegex.exec(html))) {
    const [, countRaw, cardId, rawName] = match
    const quantity = Number(countRaw || 1)
    const name = decodeHtml(rawName.replace(/\s*\([^)]*\)\s*$/, ''))
    const isLeader = cards.length === 0
    const catalogCard = findCatalogCard(catalogById, cardId)

    cards.push({
      card_id: String(catalogCard?.card_id || catalogCard?.id || cardId),
      name: catalogCard?.card_name || catalogCard?.name || name,
      quantity,
      image_url: catalogCard?.card_image || catalogCard?.image_url || null,
      rarity: catalogCard?.rarity || null,
      card_color: catalogCard?.card_color ?? null,
      card_type: catalogCard?.card_type || (isLeader ? 'Leader' : null),
      card_cost: catalogCard?.card_cost == null ? null : Number(catalogCard.card_cost),
      card_power: catalogCard?.card_power == null ? null : Number(catalogCard.card_power)
    })
  }

  const leader = cards[0] || null
  const mainCards = cards.slice(1)
  return {
    id: `meta-${summary.id}`,
    name: summary.title,
    player: summary.player,
    placement: summary.placement,
    sourceUrl: summary.url,
    source: 'Limitless',
    leader,
    cards: mainCards,
    updatedAt: new Date().toISOString()
  }
}

const loadMetaDecks = async () => {
  if (metaCache && metaCache.expiresAt > Date.now()) return metaCache.decks
  if (metaLoadPromise) return metaLoadPromise

  metaLoadPromise = (async () => {
    const listRes = await fetch(`${LIMITLESS_BASE}/decks/lists`, {
      headers: { 'User-Agent': 'OnePieceVault/1.0' },
      next: { revalidate: 900 }
    } as RequestInit & { next: { revalidate: number } })
    const listHtml = await listRes.text()
    const summaries = parseDeckSummary(listHtml)
    const catalog = await getAllCards()
    const catalogById = new Map<string, any>()
    for (const card of catalog) {
      const id = compactCardId(card.card_id || card.id)
      if (id && !catalogById.has(id)) catalogById.set(id, card)
    }

    const decks = await Promise.all(
      summaries.slice(0, 28).map(async summary => {
        const detailRes = await fetch(summary.url, {
          headers: { 'User-Agent': 'OnePieceVault/1.0' },
          next: { revalidate: 900 }
        } as RequestInit & { next: { revalidate: number } })
        return parseDeckDetail(await detailRes.text(), summary, catalogById)
      })
    )
    metaCache = { expiresAt: Date.now() + META_CACHE_MS, decks }
    return decks
  })()

  try {
    return await metaLoadPromise
  } finally {
    metaLoadPromise = null
  }
}

export async function GET(req: Request) {
  const rateLimit = checkRateLimit(req, { scope: 'meta-decks', limit: 30, windowMs: 60_000 })
  if (!rateLimit.allowed) return rateLimitResponse(rateLimit.retryAfterSeconds)

  try {
    const decks = await loadMetaDecks()
    return Response.json({ decks })
  } catch (error) {
    console.error('Meta decks error:', error)
    return Response.json({ decks: [], error: 'Meta decks unavailable' }, { status: 500 })
  }
}
