import { getAllCards, type RawCard } from '@/lib/cardData'
import { checkRateLimit, rateLimitResponse } from '@/lib/serverRateLimit'

let candidatesCache: { expiresAt: number; rows: unknown[] } | null = null

export async function GET(req: Request) {
  const rateLimit = checkRateLimit(req, { scope: 'recognition-candidates', limit: 30, windowMs: 60_000 })
  if (!rateLimit.allowed) return rateLimitResponse(rateLimit.retryAfterSeconds)

  try {
    let candidates = candidatesCache?.expiresAt && candidatesCache.expiresAt > Date.now()
      ? candidatesCache.rows
      : null
    if (!candidates) {
      const cards = await getAllCards()
      candidates = cards.map((card: RawCard) => ({
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
      candidatesCache = { expiresAt: Date.now() + 60 * 60 * 1000, rows: candidates }
    }

    return Response.json(candidates, {
      headers: {
        'Cache-Control': 'public, max-age=3600, stale-while-revalidate=86400'
      }
    })
  } catch (err) {
    console.error('Recognition candidates error:', err)
    return Response.json([], { status: 500 })
  }
}
