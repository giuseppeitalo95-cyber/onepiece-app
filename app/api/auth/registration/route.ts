import { createClient } from '@supabase/supabase-js'
import webPush from 'web-push'
import { ADMIN_ACCOUNT } from '@/lib/admin'

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://jxwgbzatdueefdiyxlns.supabase.co'
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
const VAPID_PUBLIC_KEY = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY
const VAPID_SUBJECT = process.env.VAPID_SUBJECT || 'mailto:giuseppeitalo95@gmail.com'
const NOTIFIED_METADATA_KEY = 'opv_admin_registration_notified_at'

type PushSubscriptionRow = {
  id: string
  subscription: webPush.PushSubscription
}

export async function POST(request: Request) {
  if (!SERVICE_ROLE_KEY) {
    return Response.json({ ok: false, error: 'Missing service role' }, { status: 503 })
  }
  const token = (request.headers.get('authorization') || '').replace(/^Bearer\s+/i, '')
  if (!token) return Response.json({ ok: false, error: 'Missing auth token' }, { status: 401 })

  const client = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false }
  })
  const { data: { user }, error: userError } = await client.auth.getUser(token)
  if (userError || !user) {
    return Response.json({ ok: false, error: 'Invalid session' }, { status: 401 })
  }
  if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) {
    return Response.json({ ok: false, error: 'Missing VAPID keys' }, { status: 503 })
  }

  if (user.user_metadata?.[NOTIFIED_METADATA_KEY]) {
    return Response.json({ ok: true, alreadyNotified: true, sent: 0 })
  }

  const accountAge = Date.now() - new Date(user.created_at).getTime()
  if (!Number.isFinite(accountAge) || accountAge > 24 * 60 * 60 * 1000) {
    return Response.json({ ok: true, skipped: 'existing_account', sent: 0 })
  }

  const { data: profile } = await client
    .from('profiles')
    .select('username')
    .eq('id', user.id)
    .maybeSingle()

  const adminIds = new Set<string>([ADMIN_ACCOUNT.id])
  const { data: authUsers } = await client.auth.admin.listUsers()
  authUsers?.users?.forEach(authUser => {
    if ((authUser.email || '').toLowerCase() === ADMIN_ACCOUNT.email) adminIds.add(authUser.id)
  })

  const { data: subscriptions, error: subscriptionError } = await client
    .from('push_subscriptions')
    .select('id, subscription')
    .in('user_id', [...adminIds])
  if (subscriptionError) {
    return Response.json({ ok: false, error: subscriptionError.message }, { status: 500 })
  }

  const { error: markerError } = await client.auth.admin.updateUserById(user.id, {
    user_metadata: {
      ...(user.user_metadata || {}),
      [NOTIFIED_METADATA_KEY]: new Date().toISOString()
    }
  })
  if (markerError) {
    return Response.json({ ok: false, error: markerError.message }, { status: 500 })
  }

  webPush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY)
  const identity = profile?.username || user.email || 'Un nuovo utente'
  const payload = JSON.stringify({
    title: 'Nuovo utente registrato',
    body: `${identity} si è registrato su OPV.`,
    url: '/admin'
  })
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

  return Response.json({
    ok: true,
    subscriptions: subscriptions?.length || 0,
    sent,
    failures
  })
}
