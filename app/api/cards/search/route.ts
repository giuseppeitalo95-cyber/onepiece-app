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

   const normalize = (str: string) =>
  str.toLowerCase().replace(/[^a-z0-9]/g, '')

const query = normalize(q)

  const filteredCards = allCards.filter((c: any) => {
  const name = normalize(c.card_name || '')
  const id = normalize(c.card_set_id || c.id || '')

  return name.includes(query) || id.includes(query)
})
  


    console.log('🔄 [SEARCH] API cards:', filteredCards.length)

    const cards = filteredCards.map((c: any) => ({
      id: c.card_set_id || c.id,
      name: c.card_name || c.name,
      image_url: c.card_image || c.image_url || null,
      rarity: c.rarity || '—',
      card_color: c.card_color ?? null,
      card_type: c.card_type ?? null,
      card_cost: c.card_cost ? Number(c.card_cost) : null,
      card_power: c.card_power ? Number(c.card_power) : null,
      market_price: c.market_price ? Number(c.market_price) : null,
      inventory_price: c.inventory_price ? Number(c.inventory_price) : null,
      is_from_database: c.is_from_database || false
    }))

    console.log('🚀 [SEARCH] Returning', cards.length, 'cards')
    return Response.json(cards)

  } catch (err) {
    console.error(err)
    return Response.json({ error: 'API error' }, { status: 500 })
  }
}

