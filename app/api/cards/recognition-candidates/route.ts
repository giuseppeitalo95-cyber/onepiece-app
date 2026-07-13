import { getAllCards } from '@/lib/cardData'

export async function GET() {
  try {
    const cards = await getAllCards()
    const candidates = cards.map((card: any) => ({
      id: String(card.card_id || card.id || ''),
      card_id: String(card.card_id || card.id || ''),
      name: card.card_name || card.name || 'Carta',
      image_url: card.card_image || card.image_url || null,
      card_image: card.card_image || card.image_url || null,
      rarity: card.rarity || '-',
      card_color: card.card_color ?? null,
      card_type: card.card_type ?? null,
      card_cost: card.card_cost ?? null,
      card_power: card.card_power ?? null,
      set_name: card.set_name || null,
      sub_types: card.sub_types || null
    }))

    return Response.json(candidates, {
      headers: {
        'Cache-Control': 'public, max-age=900, stale-while-revalidate=3600'
      }
    })
  } catch (err) {
    console.error('Recognition candidates error:', err)
    return Response.json([], { status: 500 })
  }
}
