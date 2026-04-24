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

    // 🔥 CERCA ANCHE NEL DATABASE SUPABASE
    const { createClient } = await import('@supabase/supabase-js')
    const supabase = createClient(
      'https://jxwgbzatdueefdiyxlns.supabase.co',
      'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imp4d2diemF0ZHVlZWZkaXl4bG5zIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzY3NzMwNjMsImV4cCI6MjA5MjM0OTA2M30.8HFzw4B9i2wB8cBuuG-gR9xEswt8kp-QyA8zqvd6YRQ'
    )

    console.log('🔍 [SEARCH] Searching for:', q)
    const { data: dbCards, error: dbError } = await supabase
      .from('cards')
      .select('card_id, name, image_url, rarity, card_color, card_type, card_cost, card_power')
      .or(`name.ilike.%${q}%,card_id.ilike.%${q}%`)

    if (dbError) {
      console.error('❌ [SEARCH] Database search error:', dbError)
    } else {
      console.log('✅ [SEARCH] Found', dbCards?.length || 0, 'cards in database:', dbCards)
    }

    // Converti le carte del database nel formato API
    const dbCardsFormatted = (dbCards || []).map((card: any) => ({
      id: card.card_id,
      name: card.name,
      image_url: card.image_url,
      rarity: card.rarity,
      card_color: card.card_color,
      card_type: card.card_type,
      card_cost: card.card_cost,
      card_power: card.card_power,
      // Aggiungi flag per identificare carte del database
      is_from_database: true
    }))

    console.log('🔄 [SEARCH] API cards:', uniqueCards.length, 'DB cards:', dbCardsFormatted.length)

    // Combina carte API esterne + carte database
    const allCardsCombined = [...uniqueCards, ...dbCardsFormatted]

    console.log('📊 [SEARCH] Total combined cards:', allCardsCombined.length)

    // Rimuovi duplicati finali basati su ID o nome
    const finalSeen = new Set<string>()
    const finalCards = allCardsCombined.filter((c: any) => {
      const identifier = c.card_set_id || c.id || c.name
      if (finalSeen.has(identifier)) return false
      finalSeen.add(identifier)
      return true
    })

    console.log('✅ [SEARCH] Final cards after deduplication:', finalCards.length)

    const cards = finalCards.slice(0, 50).map((c: any) => ({
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