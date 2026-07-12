import { NextRequest } from 'next/server'
import { syncCardmarketExports } from '@/lib/cardmarketPrices'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const isAuthorized = (req: NextRequest) => {
  const secret = process.env.CARDMARKET_SYNC_SECRET || process.env.CRON_SECRET
  if (!secret) return true

  const auth = req.headers.get('authorization') || ''
  const querySecret = req.nextUrl.searchParams.get('secret') || ''
  return auth === `Bearer ${secret}` || querySecret === secret
}

export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) {
    return Response.json({ ok: false, error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const result = await syncCardmarketExports()
    return Response.json({ ok: true, ...result })
  } catch (error) {
    console.error('Cardmarket sync error:', error)
    return Response.json({
      ok: false,
      error: error instanceof Error ? error.message : 'Cardmarket sync failed'
    }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  return GET(req)
}
