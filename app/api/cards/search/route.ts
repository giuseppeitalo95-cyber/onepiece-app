export async function GET(req: Request) {
  const { searchParams } = new URL(req.url)
  const q = searchParams.get('q')

  if (!q) return Response.json([])

  try {
    const res = await fetch(
      `https://www.optcgapi.com/api/sets/filtered/?card_name=${encodeURIComponent(q)}`
    )

    const data = await res.json()

    const cards = data.map((c: any) => ({
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