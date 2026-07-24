import { createClient } from '@supabase/supabase-js'
import { checkRateLimit, rateLimitResponse } from '@/lib/serverRateLimit'

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://jxwgbzatdueefdiyxlns.supabase.co'
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY

const db = () => SERVICE_ROLE_KEY
  ? createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } })
  : null

const allowedTypes = new Set([
  'page_view',
  'manual_search',
  'scan_open',
  'scan_result',
  'deck_search',
  'board_post'
])

export async function POST(request: Request) {
  const rateLimit = checkRateLimit(request, { scope: 'analytics-track', limit: 120, windowMs: 60_000 })
  if (!rateLimit.allowed) return rateLimitResponse(rateLimit.retryAfterSeconds)

  const client = db()
  if (!client) return Response.json({ ok: false, error: 'Missing service role' }, { status: 503 })

  const authHeader = request.headers.get('authorization') || ''
  const token = authHeader.replace(/^Bearer\s+/i, '')
  if (!token) return Response.json({ ok: false, error: 'Missing auth token' }, { status: 401 })

  const { data: { user }, error: userError } = await client.auth.getUser(token)
  if (userError || !user) return Response.json({ ok: false, error: 'Invalid session' }, { status: 401 })

  const body = await request.json().catch(() => null)
  const eventType = String(body?.eventType || '').trim()
  if (!allowedTypes.has(eventType)) {
    return Response.json({ ok: false, error: 'Invalid event type' }, { status: 400 })
  }

  const pagePath = String(body?.pagePath || '').slice(0, 220)
  const metadata = body?.metadata && typeof body.metadata === 'object' ? body.metadata : {}

  const { error } = await client
    .from('analytics_events')
    .insert({
      user_id: user.id,
      event_type: eventType,
      page_path: pagePath,
      metadata
    })

  if (error) return Response.json({ ok: false, error: error.message }, { status: 500 })
  return Response.json({ ok: true })
}
