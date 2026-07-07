import { getLiveCardPrice } from '@/lib/cardPrices'

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url)
  const cardId = searchParams.get('cardId')
  const name = searchParams.get('name')
  const setName = searchParams.get('setName')

  if (!cardId && !name) {
    return Response.json({ price: null, error: 'Missing cardId or name' }, { status: 400 })
  }

  try {
    const price = await getLiveCardPrice({ cardId, name, setName })
    return Response.json({ price })
  } catch (error) {
    console.error('Live card price error:', error)
    return Response.json({ price: null, error: 'Price lookup failed' }, { status: 500 })
  }
}
