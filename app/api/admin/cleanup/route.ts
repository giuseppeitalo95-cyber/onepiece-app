import { createClient } from '@supabase/supabase-js'
import { isAdminAccount } from '@/lib/admin'

export const dynamic = 'force-dynamic'

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://jxwgbzatdueefdiyxlns.supabase.co'
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY

const getClient = () => SERVICE_ROLE_KEY
  ? createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } })
  : null

const getAdmin = async (request: Request, client: NonNullable<ReturnType<typeof getClient>>) => {
  const token = (request.headers.get('authorization') || '').replace(/^Bearer\s+/i, '')
  if (!token) return null

  const { data: { user }, error } = await client.auth.getUser(token)
  if (error || !user) return null

  const { data: profile } = await client
    .from('profiles')
    .select('username')
    .eq('id', user.id)
    .maybeSingle()

  return isAdminAccount(user, profile) ? user : null
}

const deleteAll = async (client: NonNullable<ReturnType<typeof getClient>>, table: string) =>
  client.from(table).delete({ count: 'exact' }).not('id', 'is', null)

export async function POST(request: Request) {
  const client = getClient()
  if (!client) return Response.json({ ok: false, error: 'Service role non configurata.' }, { status: 500 })

  const admin = await getAdmin(request, client)
  if (!admin) return Response.json({ ok: false, error: 'Accesso admin richiesto.' }, { status: 403 })

  const body = await request.json().catch(() => null)
  const action = typeof body?.action === 'string' ? body.action : ''
  const userId = typeof body?.userId === 'string' ? body.userId.trim() : ''
  if (body?.confirmation !== 'SVUOTA') {
    return Response.json({ ok: false, error: 'Conferma non valida.' }, { status: 400 })
  }

  let result: { error: { message: string } | null; count: number | null }

  if (action === 'board_all') {
    result = await deleteAll(client, 'board_posts')
  } else if (action === 'chats_all') {
    result = await deleteAll(client, 'chat_messages')
  } else if (action === 'chats_user') {
    if (!userId) return Response.json({ ok: false, error: 'Seleziona un utente.' }, { status: 400 })
    result = await client
      .from('chat_messages')
      .delete({ count: 'exact' })
      .or(`sender_id.eq.${userId},receiver_id.eq.${userId}`)
  } else if (action === 'analytics_all') {
    result = await deleteAll(client, 'analytics_events')
  } else if (action === 'bug_reports') {
    result = await deleteAll(client, 'bug_reports')
  } else if (action === 'resolved_card_reports') {
    result = await client
      .from('missing_card_reports')
      .delete({ count: 'exact' })
      .eq('status', 'resolved')
  } else if (action === 'daily_scans_user') {
    if (!userId) return Response.json({ ok: false, error: 'Seleziona un utente.' }, { status: 400 })
    result = await client
      .from('user_scan_usage_daily')
      .delete({ count: 'exact' })
      .eq('user_id', userId)
  } else if (action === 'expired_data') {
    const chatCutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
    const retentionDays = Math.max(30, Number(process.env.ANALYTICS_RETENTION_DAYS || 180))
    const analyticsCutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000).toISOString()
    const [chats, analytics] = await Promise.all([
      client.from('chat_messages').delete({ count: 'exact' }).lt('created_at', chatCutoff),
      client.from('analytics_events').delete({ count: 'exact' }).lt('created_at', analyticsCutoff)
    ])
    if (chats.error || analytics.error) {
      return Response.json({ ok: false, error: chats.error?.message || analytics.error?.message }, { status: 500 })
    }
    return Response.json({ ok: true, deleted: (chats.count || 0) + (analytics.count || 0), details: { chats: chats.count || 0, analytics: analytics.count || 0 } })
  } else {
    return Response.json({ ok: false, error: 'Operazione non supportata.' }, { status: 400 })
  }

  if (result.error) return Response.json({ ok: false, error: result.error.message }, { status: 500 })
  return Response.json({ ok: true, deleted: result.count || 0 })
}
