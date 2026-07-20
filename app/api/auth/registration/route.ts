import { createClient } from '@supabase/supabase-js'
import { ADMIN_ACCOUNT } from '@/lib/admin'
import { sendPushToUsers } from '@/lib/pushNotifications'

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://jxwgbzatdueefdiyxlns.supabase.co'
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
const NOTIFIED_METADATA_KEY = 'opv_admin_registration_notified_at'

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

  const { error: markerError } = await client.auth.admin.updateUserById(user.id, {
    user_metadata: {
      ...(user.user_metadata || {}),
      [NOTIFIED_METADATA_KEY]: new Date().toISOString(),
    },
  })
  if (markerError) {
    return Response.json({ ok: false, error: markerError.message }, { status: 500 })
  }

  const identity = profile?.username || user.email || 'Un nuovo utente'
  const delivery = await sendPushToUsers(client, [...adminIds], {
    title: 'Nuovo utente registrato',
    body: `${identity} si è registrato su OPV.`,
    url: '/admin',
    tag: 'new-user-opv',
  })

  return Response.json({
    ok: true,
    subscriptions: delivery.subscriptions,
    sent: delivery.sent,
    failures: delivery.failures,
  })
}
