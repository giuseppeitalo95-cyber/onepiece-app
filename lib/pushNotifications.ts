import type { SupabaseClient } from '@supabase/supabase-js'
import webPush from 'web-push'

const VAPID_PUBLIC_KEY = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY
const VAPID_SUBJECT = process.env.VAPID_SUBJECT || 'mailto:giuseppeitalo95@gmail.com'

type PushSubscriptionRow = {
  id: string
  subscription: webPush.PushSubscription
}

export type PushPayload = {
  title: string
  body: string
  url?: string
  tag?: string
}

export type PushDeliveryResult = {
  configured: boolean
  subscriptions: number
  sent: number
  removed: number
  failures: string[]
}

const staleSubscriptionStatus = new Set([400, 403, 404, 410])

export const sendPushToUsers = async (
  client: SupabaseClient,
  userIds: string[],
  payload: PushPayload
): Promise<PushDeliveryResult> => {
  const result: PushDeliveryResult = {
    configured: false,
    subscriptions: 0,
    sent: 0,
    removed: 0,
    failures: [],
  }
  const uniqueIds = [...new Set(userIds.filter(Boolean))]
  if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY || uniqueIds.length === 0) return result

  result.configured = true
  webPush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY)

  const { data, error } = await client
    .from('push_subscriptions')
    .select('id, subscription')
    .in('user_id', uniqueIds)

  if (error) {
    result.failures.push(error.message)
    return result
  }

  const subscriptions = (data || []) as PushSubscriptionRow[]
  result.subscriptions = subscriptions.length

  await Promise.all(subscriptions.map(async item => {
    try {
      await webPush.sendNotification(item.subscription, JSON.stringify({
        title: payload.title,
        body: payload.body,
        url: payload.url || '/',
        tag: payload.tag || undefined,
      }), { TTL: 24 * 60 * 60, urgency: 'high' })
      result.sent += 1
    } catch (error: unknown) {
      const pushError = error as { statusCode?: unknown; message?: unknown; body?: unknown }
      const statusCode = Number(pushError.statusCode || 0)
      const detail = String(statusCode || pushError.message || pushError.body || 'send_failed')
      result.failures.push(detail)
      console.warn('Push delivery failed', { statusCode, stale: staleSubscriptionStatus.has(statusCode) })

      if (staleSubscriptionStatus.has(statusCode)) {
        const { error: deleteError } = await client
          .from('push_subscriptions')
          .delete()
          .eq('id', item.id)
        if (!deleteError) result.removed += 1
      }
    }
  }))

  if (result.subscriptions === 0) {
    console.info('Push delivery skipped: no registered device for recipients')
  }

  return result
}
