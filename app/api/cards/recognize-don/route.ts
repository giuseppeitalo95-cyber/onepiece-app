import type { RawCard } from '@/lib/cardData'
import {
  createDonImageFingerprint,
  decodeDonImageFingerprint,
  donFingerprintDistance,
  isPlausibleDonImage,
} from '@/lib/donImageFingerprint'
import { DON_IMAGE_SIGNATURES } from '@/lib/donImageSignatures.generated'
import { checkRateLimit, rateLimitResponse } from '@/lib/serverRateLimit'
import { requireServiceClient } from '@/lib/serverSupabase'

export const runtime = 'nodejs'

const MAX_IMAGE_LENGTH = 6_000_000
const RESULT_LIMIT = 24
const signatureCache = new Map<string, Buffer>(
  Object.entries(DON_IMAGE_SIGNATURES).map(([variantId, signature]) => [
    variantId.toUpperCase(),
    decodeDonImageFingerprint(signature),
  ]),
)
let missingSignatureRefresh: Promise<void> | null = null

const loadDonCatalog = async (): Promise<RawCard[]> => {
  const { data, error } = await requireServiceClient()
    .from('card_catalog')
    .select('variant_id,name,rarity,card_color,card_type,card_cost,card_power,set_name,market_price,inventory_price,r2_image_url,source_image_url')
    .or('card_type.eq.DON!!,rarity.eq.DON!!')
    .limit(500)
  if (error) throw new Error(`Catalogo DON non disponibile: ${error.message}`)

  return (data || []).map(row => ({
    ...row,
    id: row.variant_id,
    card_id: row.variant_id,
    card_name: row.name,
    card_image: row.r2_image_url || row.source_image_url,
    image_url: row.r2_image_url || row.source_image_url,
  }))
}

const cardImage = (card: RawCard) => String(card.card_image || card.image_url || '').trim()

const toResponseCard = (card: RawCard, visualScore: number) => ({
  id: String(card.id || card.card_id || ''),
  card_id: String(card.card_id || card.id || ''),
  name: card.card_name || card.name || 'DON!! Card',
  image_url: card.card_image || card.image_url || null,
  rarity: card.rarity || 'DON!!',
  card_color: card.card_color ?? null,
  card_type: card.card_type ?? 'DON!!',
  card_cost: card.card_cost == null ? null : Number(card.card_cost),
  card_power: card.card_power == null ? null : Number(card.card_power),
  set_name: card.set_name || null,
  market_price: card.market_price == null ? null : Number(card.market_price),
  inventory_price: card.inventory_price == null ? null : Number(card.inventory_price),
  visualScore: Number(visualScore.toFixed(4)),
})

const decodeImage = (value: string) => {
  if (!value || value.length > MAX_IMAGE_LENGTH) return null
  const match = value.match(/^data:image\/(?:jpeg|jpg|png|webp);base64,([a-z0-9+/=]+)$/i)
  if (!match) return null
  const buffer = Buffer.from(match[1], 'base64')
  return buffer.length > 0 && buffer.length <= 4_500_000 ? buffer : null
}

const mapLimit = async <T>(items: T[], limit: number, task: (item: T) => Promise<void>) => {
  let cursor = 0
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor++
      await task(items[index])
    }
  })
  await Promise.all(workers)
}

const refreshMissingSignatures = async (cards: RawCard[]) => {
  if (missingSignatureRefresh) return missingSignatureRefresh
  const missing = cards.filter(card => {
    const variantId = String(card.id || card.card_id || '').toUpperCase()
    return variantId && !signatureCache.has(variantId) && cardImage(card)
  })
  if (missing.length === 0) return

  missingSignatureRefresh = mapLimit(missing, 6, async card => {
    const variantId = String(card.id || card.card_id || '').toUpperCase()
    try {
      const response = await fetch(cardImage(card), { signal: AbortSignal.timeout(8_000) })
      if (!response.ok) return
      const image = Buffer.from(await response.arrayBuffer())
      if (!(await isPlausibleDonImage(image))) return
      const signature = await createDonImageFingerprint(image)
      signatureCache.set(variantId, signature)
    } catch {
      // A missing upstream image is skipped; existing DON signatures still work.
    }
  }).finally(() => {
    missingSignatureRefresh = null
  })

  return missingSignatureRefresh
}

export async function POST(req: Request) {
  try {
    const rateLimit = checkRateLimit(req, { scope: 'card-recognize-don', limit: 60, windowMs: 60_000 })
    if (!rateLimit.allowed) return rateLimitResponse(rateLimit.retryAfterSeconds)

    const body = await req.json()
    const image = decodeImage(String(body?.image || ''))
    if (!image) return Response.json({ candidates: [], error: 'Invalid DON image' }, { status: 400 })

    const [querySignature, donCards] = await Promise.all([
      createDonImageFingerprint(image),
      loadDonCatalog(),
    ])
    await refreshMissingSignatures(donCards)

    const ranked = donCards
      .map(card => {
        const variantId = String(card.id || card.card_id || '').toUpperCase()
        const signature = signatureCache.get(variantId)
        return signature
          ? { card, score: donFingerprintDistance(querySignature, signature) }
          : null
      })
      .filter((item): item is { card: RawCard; score: number } => Boolean(item && Number.isFinite(item.score)))
      .sort((left, right) => left.score - right.score)

    const best = ranked[0]
    const second = ranked[1]
    const gap = best ? (second?.score ?? best.score + 100) - best.score : 0
    const confidence = best && best.score <= 34 && gap >= 2.2
      ? 'high'
      : best && best.score <= 48 && gap >= 0.9
        ? 'medium'
        : 'low'

    return Response.json({
      candidates: ranked.slice(0, RESULT_LIMIT).map(item => toResponseCard(item.card, item.score)),
      confidence,
      bestScore: best ? Number(best.score.toFixed(4)) : null,
      scoreGap: Number(gap.toFixed(4)),
      indexedDon: signatureCache.size,
    })
  } catch (error) {
    console.error('DON recognition error:', error)
    return Response.json({ candidates: [], error: 'DON recognition failed' }, { status: 500 })
  }
}
