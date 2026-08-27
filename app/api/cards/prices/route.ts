import { getLiveCardPrice } from '@/lib/cardPrices'
import { getCatalogCardsByVariantIds } from '@/lib/cardData'
import { checkRateLimit, rateLimitResponse } from '@/lib/serverRateLimit'

type PriceRequestCard = {
  cardId?: string | null
  card_id?: string | null
  id?: string | null
  name?: string | null
  setName?: string | null
  set_name?: string | null
}

const priceValue = (price: Awaited<ReturnType<typeof getLiveCardPrice>>) =>
  price?.marketPrice ?? price?.midPrice ?? price?.directLowPrice ?? price?.lowPrice ?? null

export async function POST(req: Request) {
  try {
    const rateLimit = checkRateLimit(req, { scope: 'card-prices', limit: 60, windowMs: 60_000 })
    if (!rateLimit.allowed) return rateLimitResponse(rateLimit.retryAfterSeconds)

    const body = await req.json()
    const cards = Array.isArray(body?.cards) ? body.cards.slice(0, 160) as PriceRequestCard[] : []

    const requestedIds = cards
      .map(card => String(card.cardId || card.card_id || card.id || '').trim())
      .filter(Boolean)
    const catalogCards = await getCatalogCardsByVariantIds(requestedIds).catch(() => [])
    const catalogById = new Map(catalogCards.map(card => [
      // card_id is the shared base code; id is the exact catalog variant_id.
      // Indexing variants by card_id made _p1/_p2/_p3 overwrite each other.
      String(card.id || card.card_id || '').toUpperCase(),
      card,
    ]))

    const prices: Record<string, Awaited<ReturnType<typeof getLiveCardPrice>> | null> = {}

    for (let index = 0; index < cards.length; index += 8) {
      const chunk = cards.slice(index, index + 8)
      const results = await Promise.all(chunk.map(async (card) => {
        const cardId = card.cardId || card.card_id || card.id || ''
        if (!cardId) return [cardId, null] as const
        const catalogCard = catalogById.get(String(cardId).toUpperCase())

        const price = await getLiveCardPrice({
          cardId,
          name: card.name || catalogCard?.name || catalogCard?.card_name,
          setName: card.setName || card.set_name || catalogCard?.set_name,
          referencePrice: catalogCard?.market_price ?? catalogCard?.inventory_price ?? null,
          catalogResolved: Boolean(catalogCard),
          cardmarketProductId: catalogCard?.cardmarket_product_id ?? null,
          manualPriceOverride: catalogCard?.manual_price_override ?? null,
          manualPriceUpdatedAt: catalogCard?.manual_price_updated_at ?? null,
        })

        return [cardId, priceValue(price) == null ? null : price] as const
      }))

      for (const [cardId, price] of results) {
        if (cardId) prices[cardId] = price
      }
    }

    return Response.json({
      prices,
      market: 'EU',
      sourcePriority: ['Cardmarket Data Export', 'Cardmarket EU'],
      usFallbackEnabled: process.env.PRICE_ALLOW_US_FALLBACK === 'true'
    })
  } catch (error) {
    console.error('Batch price lookup error:', error)
    return Response.json({ prices: {}, error: 'Price lookup failed' }, { status: 500 })
  }
}
