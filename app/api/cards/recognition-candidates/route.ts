export async function GET() {
  try {
    const endpoints = [
      'https://www.optcgapi.com/api/allSTCards/',
      'https://www.optcgapi.com/api/allPromos/',
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
        name: card.card_name || card.name || 'Carta',
        image_url: card.card_image || card.image_url || null
      })
    }

    return Response.json(uniqueCards.slice(0, 120))
  } catch (err) {
    console.error('Recognition candidates error:', err)
    return Response.json([], { status: 500 })
  }
}
