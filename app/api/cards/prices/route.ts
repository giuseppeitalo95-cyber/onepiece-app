import { getLiveCardPrice } from '@/lib/cardPrices'

type PriceRequestCard = {
  cardId?: string | null
  card_id?: string | null
  id?: string | null
  name?: string | null
  setName?: string | null
  set_name?: string | null
}

const priceValue = (price: Awaited<ReturnType<typeof getLiveCardPrice>>) =>
  price?.marketPrice ?? price?.midPrice ?? price?.lowPrice ?? null

export async function POST(req: Request) {
  try {
    const body = await req.json()
    const cards = Array.isArray(body?.cards) ? body.cards.slice(0, 160) as PriceRequestCard[] : []

    const prices: Record<string, Awaited<ReturnType<typeof getLiveCardPrice>> | null> = {}

    for (let index = 0; index < cards.length; index += 8) {
      const chunk = cards.slice(index, index + 8)
      const results = await Promise.all(chunk.map(async (card) => {
        const cardId = card.cardId || card.card_id || card.id || ''
        if (!cardId) return [cardId, null] as const

        const price = await getLiveCardPrice({
          cardId,
          name: card.name,
          setName: card.setName || card.set_name
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
      sourcePriority: ['Cardmarket Data Export', 'Cardmarket EU', 'OPTCGAPI daily EUR'],
      usFallbackEnabled: process.env.PRICE_ALLOW_US_FALLBACK === 'true'
    })
  } catch (error) {
    console.error('Batch price lookup error:', error)
    return Response.json({ prices: {}, error: 'Price lookup failed' }, { status: 500 })
  }
}
