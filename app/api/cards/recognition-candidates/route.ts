export async function GET() {
  try {
    // FIX: aggiunto allSetCards (mancavano le carte dei set principali, quelle dei booster pack!)
    // FIX: allPromos -> allPromoCards (endpoint sbagliato, dava sempre vuoto)
    const endpoints = [
      'https://www.optcgapi.com/api/allSetCards/',
      'https://www.optcgapi.com/api/allSTCards/',
      'https://www.optcgapi.com/api/allPromoCards/',
      'https://www.optcgapi.com/api/allDonCards/'
    ]

    const results = await Promise.all(
      endpoints.map(async (url) => {
        try {
          const res = await fetch(url)
          if (!res.ok) return []
          const data = await res.json()
          return Array.isArray(data) ? data : [data]
        } catch {
          return []
        }
      })
    )

    const allCards = results.flat().filter((card: any) => card?.card_image || card?.image_url || card?.card_name)

    const uniqueCards = [] as any[]
    const seen = new Set<string>()

    for (const card of allCards) {
      const key = `${card.card_name || card.name || ''}-${card.card_set_id || card.id || ''}`
      if (seen.has(key)) continue
      seen.add(key)
      uniqueCards.push({
        id: String(card.card_set_id || card.id || key),
        card_id: String(card.card_set_id || card.id || key),
        name: card.card_name || card.name || 'Carta',
        image_url: card.card_image || card.image_url || null,
        rarity: card.rarity || '—',
        market_price: card.market_price ? Number(card.market_price) : null,
        inventory_price: card.inventory_price ? Number(card.inventory_price) : null,
        card_color: card.card_color ?? null,
        card_type: card.card_type ?? null,
        card_cost: card.card_cost ? Number(card.card_cost) : null,
        card_power: card.card_power ? Number(card.card_power) : null,
        card_text: card.card_text || '',
        set_name: card.set_name || '',
        sub_types: card.sub_types || ''
      })
    }

    return Response.json(uniqueCards)
  } catch (err) {
    console.error('Recognition candidates error:', err)
    return Response.json([], { status: 500 })
  }
}
