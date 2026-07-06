import { getAllCards } from '@/lib/cardData'

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url)
  const q = searchParams.get('q')

  if (!q) return Response.json([])

  try {
    const normalize = (str: string) => str.toLowerCase().replace(/[^a-z0-9]/g, '')
    const query = normalize(q)
    const cards = await getAllCards()

    const filteredCards = cards.filter((card: any) => {
      const searchable = [
        card.name,
        card.card_name,
        card.card_id,
        card.id,
        card.card_text,
        card.set_name,
        card.sub_types,
        card.card_type,
        card.card_color
      ].filter(Boolean).join(' ')

      return normalize(searchable).includes(query)
    })

    return Response.json(filteredCards.slice(0, 80))
  } catch (err) {
    console.error('Card search error:', err)
    return Response.json({ error: 'API error' }, { status: 500 })
  }
}
