import { NextRequest } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { isAdminAccount } from '@/lib/admin'

export const dynamic = 'force-dynamic'

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://jxwgbzatdueefdiyxlns.supabase.co'
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY

const db = () => SERVICE_ROLE_KEY
  ? createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } })
  : null

const isCronAuthorized = (req: NextRequest) => {
  const secret = process.env.MAINTENANCE_SECRET || process.env.CRON_SECRET
  if (!secret) return false

  const auth = req.headers.get('authorization') || ''
  const querySecret = req.nextUrl.searchParams.get('secret') || ''
  return auth === `Bearer ${secret}` || querySecret === secret
}

const isAdminRequest = async (req: NextRequest) => {
  const client = db()
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

export async function GET(req: NextRequest) {
  const client = db()
  if (!client) return Response.json({ ok: false, error: 'Missing SUPABASE_SERVICE_ROLE_KEY' }, { status: 500 })

  if (!isCronAuthorized(req) && !(await isAdminRequest(req))) {
    const status = process.env.MAINTENANCE_SECRET || process.env.CRON_SECRET ? 401 : 503
    return Response.json({
      ok: false,
      error: status === 503 ? 'Missing MAINTENANCE_SECRET or CRON_SECRET' : 'Unauthorized'
    }, { status })
  }

  const chatCutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
  const analyticsRetentionDays = Math.max(30, Number(process.env.ANALYTICS_RETENTION_DAYS || 180))
  const analyticsCutoff = new Date(Date.now() - analyticsRetentionDays * 24 * 60 * 60 * 1000).toISOString()

  const [chatCleanup, analyticsCleanup] = await Promise.all([
    client
      .from('chat_messages')
      .delete({ count: 'exact' })
      .lt('created_at', chatCutoff),
    client
      .from('analytics_events')
      .delete({ count: 'exact' })
      .lt('created_at', analyticsCutoff)
  ])

  if (chatCleanup.error) {
    return Response.json({ ok: false, error: chatCleanup.error.message }, { status: 500 })
  }

  return Response.json({
    ok: true,
    chatDeleted: chatCleanup.count || 0,
    analyticsDeleted: analyticsCleanup.error ? 0 : analyticsCleanup.count || 0,
    analyticsCleanupError: analyticsCleanup.error?.message || null,
    analyticsRetentionDays
  })
}

export async function POST(req: NextRequest) {
  return GET(req)
}
