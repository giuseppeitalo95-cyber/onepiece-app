export async function GET(req: Request) {
  const { searchParams } = new URL(req.url)
  const q = searchParams.get('q')

  if (!q) return Response.json([])

  try {
    // Fetch from multiple endpoints to expand the card database
    const endpoints = [
      `https://www.optcgapi.com/api/sets/filtered/?card_name=${encodeURIComponent(q)}`,
      `https://www.optcgapi.com/api/allSTCards/`,
      `https://www.optcgapi.com/api/allPromos/`,
      `https://www.optcgapi.com/api/allDonCards/`
    ]

    const fetchPromises = endpoints.map(async (url) => {
      try {
        const res = await fetch(url)
        if (!res.ok) return []
        const data = await res.json()
        return Array.isArray(data) ? data : [data]
      } catch (err) {
        console.error(`Error fetching ${url}:`, err)
        return []
      }
    })

    const results = await Promise.all(fetchPromises)
    const allCards = results.flat()

    // Filter cards by name containing the query (case-insensitive)
    const filteredCards = allCards.filter((c: any) =>
      c.card_name && c.card_name.toLowerCase().includes(q.toLowerCase())
    )

    // Remove duplicates based on card_set_id
    const seen = new Set<string>()
    const uniqueCards = filteredCards.filter((c: any) => {
      if (seen.has(c.card_set_id)) return false
      seen.add(c.card_set_id)
      return true
    })

    const cards = uniqueCards.slice(0, 50).map((c: any) => ({
      id: c.card_set_id,
      name: c.card_name,
      image_url: c.card_image,
      rarity: c.rarity,

      // 🔥 MATCH PERFETTO CON FRONTEND
      card_color: c.card_color ?? null,
      card_type: c.card_type ?? null,
      card_cost: c.card_cost ? Number(c.card_cost) : null,
      card_power: c.card_power ? Number(c.card_power) : null,
      market_price: c.market_price ? Number(c.market_price) : null,
      inventory_price: c.inventory_price ? Number(c.inventory_price) : null,
    }))

    return Response.json(cards)

  } catch (err) {
    console.error(err)
    return Response.json({ error: 'API error' }, { status: 500 })
  }
}