import { getLiveCardPrice } from '@/lib/cardPrices'
import { getCatalogCardsByVariantIds } from '@/lib/cardData'
import { checkRateLimit, rateLimitResponse } from '@/lib/serverRateLimit'

const CACHE_HEADERS = {
  'Cache-Control': 'private, no-store, max-age=0',
}

export async function GET(req: Request) {
  const rateLimit = checkRateLimit(req, { scope: 'card-price', limit: 240, windowMs: 60_000 })
  if (!rateLimit.allowed) return rateLimitResponse(rateLimit.retryAfterSeconds)

  const { searchParams } = new URL(req.url)
  const cardId = searchParams.get('cardId')
  const name = searchParams.get('name')
  const setName = searchParams.get('setName')

  if (!cardId && !name) {
    return Response.json({ price: null, error: 'Missing cardId or name' }, { status: 400 })
  }

  try {
    const catalogCard = cardId
      ? (await getCatalogCardsByVariantIds([cardId]).catch(() => []))[0]
      : null
    const price = await getLiveCardPrice({
      cardId,
      name: name || catalogCard?.name || catalogCard?.card_name,
      setName: setName || catalogCard?.set_name,
      referencePrice: catalogCard?.market_price ?? catalogCard?.inventory_price ?? null,
      catalogResolved: Boolean(catalogCard),
      cardmarketProductId: catalogCard?.cardmarket_product_id ?? null,
      manualPriceOverride: catalogCard?.manual_price_override ?? null,
      manualPriceUpdatedAt: catalogCard?.manual_price_updated_at ?? null,
    })
    return Response.json({ price }, { headers: CACHE_HEADERS })
  } catch (error) {
    console.error('Live card price error:', error)
    return Response.json({ price: null, error: 'Price lookup failed' }, { status: 500 })
  }
}
