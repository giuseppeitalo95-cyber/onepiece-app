import { createClient } from '@supabase/supabase-js'
import { ADMIN_ACCOUNT } from '@/lib/admin'
import { sendPushToUsers } from '@/lib/pushNotifications'

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://jxwgbzatdueefdiyxlns.supabase.co'
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
const PUSH_NOTIFIED_KEY = 'opv_admin_registration_notified_at'
const EMAIL_QUEUED_KEY = 'opv_registration_email_queued_at'

export async function POST(request: Request) {
  if (!SERVICE_ROLE_KEY) {
    return Response.json({ ok: false, error: 'Missing service role' }, { status: 503 })
  }
  const token = (request.headers.get('authorization') || '').replace(/^Bearer\s+/i, '')
  if (!token) return Response.json({ ok: false, error: 'Missing auth token' }, { status: 401 })

  const client = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const { data: { user }, error: userError } = await client.auth.getUser(token)
  if (userError || !user) {
    return Response.json({ ok: false, error: 'Invalid session' }, { status: 401 })
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

  let emailQueued = Boolean(user.app_metadata?.[EMAIL_QUEUED_KEY])
  let emailQueueError: string | null = null
  if (!emailQueued && user.email) {
    const { data: existingEmailEvent } = await client
      .from('analytics_events')
      .select('id')
      .eq('user_id', user.id)
      .eq('event_type', 'registration_email')
      .limit(1)
      .maybeSingle()

    if (existingEmailEvent?.id) {
      emailQueued = true
    } else {
      const fallbackName = String(
        profile?.username
        || user.user_metadata?.user_name
        || user.user_metadata?.full_name
        || user.email.split('@')[0]
        || 'nuovo giocatore'
      ).trim().slice(0, 80)
      const { error: queueError } = await client
        .from('analytics_events')
        .insert({
          user_id: user.id,
          event_type: 'registration_email',
          page_path: 'pending',
          metadata: {
            email: user.email.toLowerCase(),
            username: fallbackName,
            provider: user.app_metadata?.provider || 'email',
          },
        })
      emailQueueError = queueError?.message || null
      emailQueued = !queueError
    }
  }

  const pushAlreadySent = Boolean(user.user_metadata?.[PUSH_NOTIFIED_KEY])
  let delivery = { subscriptions: 0, sent: 0, failures: [] as string[] }
  if (!pushAlreadySent) {
    const adminIds = new Set<string>([ADMIN_ACCOUNT.id])
    const { data: authUsers } = await client.auth.admin.listUsers()
    authUsers?.users?.forEach(authUser => {
      if ((authUser.email || '').toLowerCase() === ADMIN_ACCOUNT.email) adminIds.add(authUser.id)
    })

    const identity = profile?.username || user.email || 'Un nuovo utente'
    delivery = await sendPushToUsers(client, [...adminIds], {
      title: 'Nuovo utente registrato',
      body: `${identity} si e registrato su OPV.`,
      url: '/admin',
      tag: 'new-user-opv',
    })
  }

  const { error: markerError } = await client.auth.admin.updateUserById(user.id, {
    user_metadata: {
      ...(user.user_metadata || {}),
      ...(pushAlreadySent ? {} : { [PUSH_NOTIFIED_KEY]: new Date().toISOString() }),
    },
    app_metadata: {
      ...(user.app_metadata || {}),
      ...(emailQueued ? { [EMAIL_QUEUED_KEY]: new Date().toISOString() } : {}),
    },
  })
  if (markerError) {
    return Response.json({ ok: false, error: markerError.message }, { status: 500 })
  }

  return Response.json({
    ok: true,
    alreadyNotified: pushAlreadySent,
    emailQueued,
    emailQueueError,
    subscriptions: delivery.subscriptions,
    sent: delivery.sent,
    failures: delivery.failures,
  })
}
