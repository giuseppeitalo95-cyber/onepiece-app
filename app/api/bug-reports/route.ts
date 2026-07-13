import { createClient } from '@supabase/supabase-js'
import webPush from 'web-push'
import { ADMIN_ACCOUNT, isAdminAccount } from '@/lib/admin'

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://jxwgbzatdueefdiyxlns.supabase.co'
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
const VAPID_PUBLIC_KEY = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY
const VAPID_SUBJECT = process.env.VAPID_SUBJECT || 'mailto:giuseppeitalo95@gmail.com'

type PushSubscriptionRow = {
  id: string
  subscription: webPush.PushSubscription
}

type PushNotifyResult = {
  configured: boolean
  adminIds: string[]
  subscriptions: number
  sent: number
  failures: string[]
}

const db = () => {
  if (!SERVICE_ROLE_KEY) return null
  return createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } })
}

const getUser = async (request: Request) => {
  const authHeader = request.headers.get('authorization') || ''
  const token = authHeader.replace(/^Bearer\s+/i, '')
  if (!token || !SERVICE_ROLE_KEY) return { user: null, profile: null, error: 'Missing auth token' }

  const authClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false }
  })
  const { data: { user }, error } = await authClient.auth.getUser(token)
  if (error || !user) return { user: null, profile: null, error: 'Invalid session' }

  const client = db()
  const { data: profile } = client
    ? await client.from('profiles').select('username').eq('id', user.id).maybeSingle()
    : { data: null }

  return { user, profile, error: null }
}

const configureWebPush = () => {
  if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) return false
  webPush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY)
  return true
}

const notifyAdmins = async (title: string, body: string): Promise<PushNotifyResult> => {
  const client = db()
  const empty = { configured: false, adminIds: [], subscriptions: 0, sent: 0, failures: [] }
  if (!client || !configureWebPush()) return empty

  const adminIds = new Set<string>([ADMIN_ACCOUNT.id])

  try {
    const { data: usersData } = await client.auth.admin.listUsers()
    usersData?.users?.forEach(user => {
      if ((user.email || '').toLowerCase() === ADMIN_ACCOUNT.email) adminIds.add(user.id)
    })
  } catch {
    // Keep bug reports working even if auth admin lookup is temporarily unavailable.
  }

  try {
    const { data: profileAdmins } = await client
      .from('profiles')
      .select('id, username')
      .or(`id.eq.${ADMIN_ACCOUNT.id},username.ilike.${ADMIN_ACCOUNT.username}`)
    ;(profileAdmins || []).forEach(profile => {
      if (profile.id) adminIds.add(profile.id)
    })
  } catch {
    // The fixed admin id above is still enough when profiles cannot be read.
  }

  const { data: subscriptions } = await client
    .from('push_subscriptions')
    .select('id, subscription')
    .in('user_id', [...adminIds])

  const payload = JSON.stringify({ title, body, url: '/admin' })
  let sent = 0
  const failures: string[] = []
  await Promise.all(((subscriptions || []) as PushSubscriptionRow[]).map(async item => {
    try {
      await webPush.sendNotification(item.subscription, payload)
      sent += 1
    } catch (error: any) {
      const statusCode = Number(error?.statusCode || 0)
      failures.push(String(statusCode || error?.message || 'send_failed'))
      if (statusCode === 404 || statusCode === 410) {
        await client.from('push_subscriptions').delete().eq('id', item.id)
      }
    }
  }))

  return {
    configured: true,
    adminIds: [...adminIds],
    subscriptions: subscriptions?.length || 0,
    sent,
    failures
  }
}

export async function GET(request: Request) {
  const client = db()
  if (!client) return Response.json({ ok: false, error: 'Missing SUPABASE_SERVICE_ROLE_KEY' }, { status: 500 })

  const { user, profile, error } = await getUser(request)
  if (error || !user) return Response.json({ ok: false, error }, { status: 401 })
  if (!isAdminAccount(user, profile)) return Response.json({ ok: false, error: 'Forbidden' }, { status: 403 })

  const { data, error: listError } = await client
    .from('bug_reports')
    .select('id, reporter_id, reporter_email, reporter_username, page_path, title, message, user_agent, status, resolved_at, created_at, updated_at')
    .order('created_at', { ascending: false })

  if (listError) return Response.json({ ok: false, error: listError.message }, { status: 500 })
  return Response.json({ ok: true, reports: data || [] })
}

export async function POST(request: Request) {
  const client = db()
  if (!client) return Response.json({ ok: false, error: 'Missing SUPABASE_SERVICE_ROLE_KEY' }, { status: 500 })

  const { user, profile, error } = await getUser(request)
  if (error || !user) return Response.json({ ok: false, error }, { status: 401 })

  const body = await request.json().catch(() => null)
  const message = String(body?.message || '').trim().slice(0, 1600)
  const title = String(body?.title || '').trim().slice(0, 120)
  const pagePath = String(body?.pagePath || '').trim().slice(0, 300)

  if (message.length < 5) {
    return Response.json({ ok: false, error: 'Descrizione troppo breve.' }, { status: 400 })
  }

  const { data, error: insertError } = await client
    .from('bug_reports')
    .insert({
      reporter_id: user.id,
      reporter_email: user.email || null,
      reporter_username: profile?.username || null,
      page_path: pagePath || null,
      title: title || null,
      message,
      user_agent: request.headers.get('user-agent'),
      status: 'new'
    })
    .select('id')
    .single()

  if (insertError) return Response.json({ ok: false, error: insertError.message }, { status: 500 })

  const push = await notifyAdmins(
    'Nuova segnalazione bug',
    `${profile?.username || user.email || 'Utente'}: ${title || message.slice(0, 80)}`
  )

  return Response.json({ ok: true, id: data?.id, push })
}

export async function PATCH(request: Request) {
  const client = db()
  if (!client) return Response.json({ ok: false, error: 'Missing SUPABASE_SERVICE_ROLE_KEY' }, { status: 500 })

  const { user, profile, error } = await getUser(request)
  if (error || !user) return Response.json({ ok: false, error }, { status: 401 })
  if (!isAdminAccount(user, profile)) return Response.json({ ok: false, error: 'Forbidden' }, { status: 403 })

  const body = await request.json().catch(() => null)
  const id = String(body?.id || '')
  const status = String(body?.status || 'resolved')
  if (!id) return Response.json({ ok: false, error: 'Missing id' }, { status: 400 })

  const { error: updateError } = await client
    .from('bug_reports')
    .update({
      status,
      resolved_at: status === 'resolved' ? new Date().toISOString() : null,
      resolved_by: status === 'resolved' ? user.id : null,
      updated_at: new Date().toISOString()
    })
    .eq('id', id)

  if (updateError) return Response.json({ ok: false, error: updateError.message }, { status: 500 })
  return Response.json({ ok: true })
}

export async function DELETE(request: Request) {
  const client = db()
  if (!client) return Response.json({ ok: false, error: 'Missing SUPABASE_SERVICE_ROLE_KEY' }, { status: 500 })

  const { user, profile, error } = await getUser(request)
  if (error || !user) return Response.json({ ok: false, error }, { status: 401 })
  if (!isAdminAccount(user, profile)) return Response.json({ ok: false, error: 'Forbidden' }, { status: 403 })

  const { searchParams } = new URL(request.url)
  const id = searchParams.get('id')
  if (!id) return Response.json({ ok: false, error: 'Missing id' }, { status: 400 })

  const { error: deleteError } = await client.from('bug_reports').delete().eq('id', id)
  if (deleteError) return Response.json({ ok: false, error: deleteError.message }, { status: 500 })
  return Response.json({ ok: true })
}
