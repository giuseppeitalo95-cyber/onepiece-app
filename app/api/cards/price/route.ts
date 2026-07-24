import { getLiveCardPrice } from '@/lib/cardPrices'
import { checkRateLimit, rateLimitResponse } from '@/lib/serverRateLimit'

const CACHE_HEADERS = {
  'Cache-Control': 'public, max-age=60, s-maxage=300, stale-while-revalidate=1800',
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
    const price = await getLiveCardPrice({ cardId, name, setName })
    return Response.json({ price }, { headers: CACHE_HEADERS })
  } catch (error) {
    console.error('Live card price error:', error)
    return Response.json({ price: null, error: 'Price lookup failed' }, { status: 500 })
  }
}
