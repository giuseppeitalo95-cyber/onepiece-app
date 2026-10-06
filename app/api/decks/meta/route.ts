import { loadMetaDeckSnapshot } from '@/lib/metaDecks'
import { checkRateLimit, rateLimitResponse } from '@/lib/serverRateLimit'

export const dynamic = 'force-dynamic'
export const maxDuration = 120

export async function GET(req: Request) {
  const rateLimit = checkRateLimit(req, { scope: 'meta-decks', limit: 30, windowMs: 60_000 })
  if (!rateLimit.allowed) return rateLimitResponse(rateLimit.retryAfterSeconds)
  try {
    const snapshot = await loadMetaDeckSnapshot()
    return Response.json({ decks: snapshot.decks, updatedAt: snapshot.updatedAt })
  } catch (error) {
    console.error('Meta decks error:', error)
    return Response.json({ decks: [], error: 'Meta decks unavailable' }, { status: 500 })
  }
}
