import { getAllCards, type RawCard } from '@/lib/cardData'
import { readR2Json, writeR2Json } from '@/lib/r2Storage'

export type MetaDeckCard = {
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

export type MetaDeck = {
  id: string
  name: string
  player: string
  placement: string
  sourceUrl: string
  source: string
  leader: MetaDeckCard | null
  cards: MetaDeckCard[]
  updatedAt: string
}

type Summary = { id: string; title: string; player: string; placement: string; url: string }
type MetaSnapshot = { updatedAt: string; decks: MetaDeck[] }

const LIMITLESS_BASE = 'https://onepiece.limitlesstcg.com'
const META_DECK_LIMIT = 72
const SNAPSHOT_KEY = 'data/meta-decks.json'
const SNAPSHOT_MAX_AGE_MS = 26 * 60 * 60 * 1000
const MEMORY_CACHE_MS = 60 * 60 * 1000

let memoryCache: { expiresAt: number; snapshot: MetaSnapshot } | null = null
let loadPromise: Promise<MetaSnapshot> | null = null

const decodeHtml = (value: string) => value
  .replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#039;/g, "'")
  .replace(/&rsquo;|&lsquo;/g, "'").replace(/&eacute;/g, 'é').replace(/&uuml;/g, 'ü')
  .replace(/<[^>]+>/g, '').trim()

const compactCardId = (value?: string | null) => (value || '').toLowerCase().replace(/[^a-z0-9]/g, '')
const findCatalogCard = (catalogById: Map<string, RawCard>, cardId: string) =>
  catalogById.get(compactCardId(cardId)) || catalogById.get(compactCardId(cardId).replace(/p\d+$/i, ''))

const parseDeckSummary = (html: string) => {
  const decks: Summary[] = []
  const rowRegex = /<tr>\s*<td>([^<]+)<\/td>\s*<td><a href="\/decks\/list\/(\d+)">([\s\S]*?)<\/a><\/td>\s*<\/tr>/g
  let match: RegExpExecArray | null
  while ((match = rowRegex.exec(html)) && decks.length < 100) {
    const [, placement, id, rawTitle] = match
    decks.push({
      id,
      title: decodeHtml(rawTitle.replace(/<span class="annotation">[\s\S]*?<\/span>/, '')),
      player: decodeHtml(rawTitle.match(/<span class="annotation">by ([\s\S]*?)<\/span>/)?.[1] || ''),
      placement: decodeHtml(placement),
      url: `${LIMITLESS_BASE}/decks/list/${id}`,
    })
  }
  return decks
}

const parseDeckDetail = (html: string, summary: Summary, catalogById: Map<string, RawCard>): MetaDeck => {
  const cards: MetaDeckCard[] = []
  const cardRegex = /<div class="decklist-card" data-count="(\d+)" data-id="([^"]+)"[\s\S]*?<span class="card-name">([^<]+)<\/span>[\s\S]*?<\/div>/g
  let match: RegExpExecArray | null
  while ((match = cardRegex.exec(html))) {
    const [, countRaw, cardId, rawName] = match
    const catalogCard = findCatalogCard(catalogById, cardId)
    cards.push({
      card_id: String(catalogCard?.card_id || catalogCard?.id || cardId),
      name: catalogCard?.card_name || catalogCard?.name || decodeHtml(rawName.replace(/\s*\([^)]*\)\s*$/, '')),
      quantity: Number(countRaw || 1),
      image_url: catalogCard?.card_image || catalogCard?.image_url || null,
      rarity: catalogCard?.rarity || null,
      card_color: catalogCard?.card_color ?? null,
      card_type: catalogCard?.card_type || (cards.length === 0 ? 'Leader' : null),
      card_cost: catalogCard?.card_cost == null ? null : Number(catalogCard.card_cost),
      card_power: catalogCard?.card_power == null ? null : Number(catalogCard.card_power),
    })
  }
  return { id: `meta-${summary.id}`, name: summary.title, player: summary.player, placement: summary.placement, sourceUrl: summary.url, source: 'Limitless', leader: cards[0] || null, cards: cards.slice(1), updatedAt: new Date().toISOString() }
}

const mapWithConcurrency = async <T, R>(items: T[], concurrency: number, task: (item: T) => Promise<R | null>) => {
  const results: Array<R | null> = new Array(items.length).fill(null)
  let cursor = 0
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor++
      results[index] = await task(items[index])
    }
  })
  await Promise.all(workers)
  return results.filter((result): result is R => result !== null)
}

const fetchFreshMetaDecks = async (): Promise<MetaSnapshot> => {
  const listUrls = [`${LIMITLESS_BASE}/decks/lists?show=100`, `${LIMITLESS_BASE}/decks/lists?show=100&sort=last`]
  const pages = await Promise.all(listUrls.map(url => fetch(url, { headers: { 'User-Agent': 'OnePieceVault/1.0' }, cache: 'no-store' }).then(response => {
    if (!response.ok) throw new Error(`Limitless decklists ${response.status}`)
    return response.text()
  })))
  const byId = new Map<string, Summary>()
  const lists = pages.map(parseDeckSummary)
  for (let index = 0; index < 100 && byId.size < META_DECK_LIMIT; index += 1) {
    for (const list of lists) {
      const summary = list[index]
      if (summary && !byId.has(summary.id)) byId.set(summary.id, summary)
    }
  }

  const catalog = await getAllCards()
  const catalogById = new Map<string, RawCard>()
  for (const card of catalog) {
    const id = compactCardId(card.card_id || card.id)
    if (id && !catalogById.has(id)) catalogById.set(id, card)
  }
  const decks = await mapWithConcurrency([...byId.values()], 10, async summary => {
    try {
      const response = await fetch(summary.url, { headers: { 'User-Agent': 'OnePieceVault/1.0' }, cache: 'no-store' })
      if (!response.ok) return null
      const deck = parseDeckDetail(await response.text(), summary, catalogById)
      return deck.cards.length ? deck : null
    } catch {
      return null
    }
  })
  if (decks.length === 0) throw new Error('Limitless non ha restituito deck utilizzabili')
  return { updatedAt: new Date().toISOString(), decks }
}

export const loadMetaDeckSnapshot = async ({ force = false }: { force?: boolean } = {}): Promise<MetaSnapshot> => {
  if (!force && memoryCache && memoryCache.expiresAt > Date.now()) return memoryCache.snapshot
  if (loadPromise) return loadPromise
  loadPromise = (async () => {
    let stored: MetaSnapshot | null = null
    try { stored = await readR2Json<MetaSnapshot>(SNAPSHOT_KEY) } catch { stored = null }
    const storedAt = stored?.updatedAt ? new Date(stored.updatedAt).getTime() : 0
    if (!force && stored && Number.isFinite(storedAt) && Date.now() - storedAt < SNAPSHOT_MAX_AGE_MS) {
      memoryCache = { expiresAt: Date.now() + MEMORY_CACHE_MS, snapshot: stored }
      return stored
    }
    try {
      const fresh = await fetchFreshMetaDecks()
      await writeR2Json(SNAPSHOT_KEY, fresh)
      memoryCache = { expiresAt: Date.now() + MEMORY_CACHE_MS, snapshot: fresh }
      return fresh
    } catch (error) {
      if (stored?.decks?.length) return stored
      throw error
    }
  })()
  try { return await loadPromise } finally { loadPromise = null }
}

export const refreshMetaDeckSnapshot = () => loadMetaDeckSnapshot({ force: true })
