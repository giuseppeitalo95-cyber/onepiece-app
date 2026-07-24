import { createClient } from '@supabase/supabase-js'
import { ADMIN_ACCOUNT } from '@/lib/admin'
import { sendPushToUsers } from '@/lib/pushNotifications'

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://jxwgbzatdueefdiyxlns.supabase.co'
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
const ADMIN_CACHE_MS = 10 * 60 * 1000
let adminIdCache: { expiresAt: number; ids: string[] } | null = null
let serviceClient: ReturnType<typeof createClient> | null = null
export type AdminPushResult = {
  configured: boolean
  adminIds: string[]
  subscriptions: number
  sent: number
  failures: string[]
}

export const notifyAdmins = async (title: string, body: string, url = '/admin'): Promise<AdminPushResult> => {
  const empty = { configured: false, adminIds: [], subscriptions: 0, sent: 0, failures: [] }
  if (!SERVICE_ROLE_KEY) return empty

  const client = serviceClient || createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } })
  serviceClient = client

  let resolvedAdminIds = adminIdCache?.expiresAt && adminIdCache.expiresAt > Date.now()
    ? adminIdCache.ids
    : null
  if (!resolvedAdminIds) {
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
      ;((data || []) as Array<{ id: string }>).forEach(profile => {
        if (profile.id) adminIds.add(profile.id)
      })
    } catch {
      // Il fallback sull'account Admin e sufficiente.
    }
    resolvedAdminIds = [...adminIds]
    adminIdCache = { expiresAt: Date.now() + ADMIN_CACHE_MS, ids: resolvedAdminIds }
  }

  const delivery = await sendPushToUsers(client, resolvedAdminIds, { title, body, url, tag: 'admin-opv' })

  return {
    configured: delivery.configured,
    adminIds: resolvedAdminIds,
    subscriptions: delivery.subscriptions,
    sent: delivery.sent,
    failures: delivery.failures,
  }
}
