import { NextRequest } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { syncCardmarketExports } from '@/lib/cardmarketPrices'
import { isAdminAccount } from '@/lib/admin'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://jxwgbzatdueefdiyxlns.supabase.co'
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY

const adminClient = () => SERVICE_ROLE_KEY
  ? createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } })
  : null

const isAdminRequest = async (req: NextRequest) => {
  const client = adminClient()
  if (!client) return false

  const auth = req.headers.get('authorization') || ''
  const token = auth.replace(/^Bearer\s+/i, '')
  if (!token) return false

  const { data: { user }, error } = await client.auth.getUser(token)
  if (error || !user) return false

  const { data: profile } = await client
    .from('profiles')
    .select('username')
    .eq('id', user.id)
    .maybeSingle()

  return isAdminAccount(user, profile)
}

const isCronAuthorized = (req: NextRequest) => {
  const secret = process.env.CARDMARKET_SYNC_SECRET || process.env.CRON_SECRET
  if (!secret) return false

  const auth = req.headers.get('authorization') || ''
  const querySecret = req.nextUrl.searchParams.get('secret') || ''
  return auth === `Bearer ${secret}` || querySecret === secret
}

export async function GET(req: NextRequest) {
  if (!isCronAuthorized(req) && !(await isAdminRequest(req))) {
    const status = process.env.CARDMARKET_SYNC_SECRET || process.env.CRON_SECRET ? 401 : 503
    return Response.json({
      ok: false,
      error: status === 503 ? 'Missing CARDMARKET_SYNC_SECRET or CRON_SECRET' : 'Unauthorized'
    }, { status })
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
