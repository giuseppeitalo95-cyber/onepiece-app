import { createClient } from '@supabase/supabase-js'
import webPush from 'web-push'
import { ADMIN_ACCOUNT } from '@/lib/admin'

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://jxwgbzatdueefdiyxlns.supabase.co'
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
const VAPID_PUBLIC_KEY = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY
const VAPID_SUBJECT = process.env.VAPID_SUBJECT || 'mailto:giuseppeitalo95@gmail.com'

type PushSubscriptionRow = {
  id: string
  subscription: webPush.PushSubscription
}

export type AdminPushResult = {
  configured: boolean
  adminIds: string[]
  subscriptions: number
  sent: number
  failures: string[]
}

export const notifyAdmins = async (title: string, body: string, url = '/admin'): Promise<AdminPushResult> => {
  const empty = { configured: false, adminIds: [], subscriptions: 0, sent: 0, failures: [] }
  if (!SERVICE_ROLE_KEY || !VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) return empty

  const client = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } })
  webPush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY)

  const adminIds = new Set<string>([ADMIN_ACCOUNT.id])
  try {
    const { data } = await client.auth.admin.listUsers()
    data?.users?.forEach(user => {
      if ((user.email || '').toLowerCase() === ADMIN_ACCOUNT.email) adminIds.add(user.id)
    })
  } catch {
    // L'ID Admin fisso mantiene disponibile la notifica anche se Auth e temporaneamente lento.
  }

  try {
    const { data } = await client
      .from('profiles')
      .select('id, username')
      .or(`id.eq.${ADMIN_ACCOUNT.id},username.ilike.${ADMIN_ACCOUNT.username}`)
    ;(data || []).forEach(profile => {
      if (profile.id) adminIds.add(profile.id)
    })
  } catch {
    // Il fallback sull'account Admin e sufficiente.
  }

  const { data: subscriptions } = await client
    .from('push_subscriptions')
    .select('id, subscription')
    .in('user_id', [...adminIds])

  const payload = JSON.stringify({ title, body, url })
  let sent = 0
  const failures: string[] = []

  await Promise.all(((subscriptions || []) as PushSubscriptionRow[]).map(async item => {
    try {
      await webPush.sendNotification(item.subscription, payload)
      sent += 1
    } catch (error: unknown) {
      const pushError = error as { statusCode?: unknown; message?: unknown }
      const statusCode = Number(pushError.statusCode || 0)
      failures.push(String(statusCode || pushError.message || 'send_failed'))
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
    failures,
  }
}
