import { createClient } from '@supabase/supabase-js'
import webPush from 'web-push'

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://jxwgbzatdueefdiyxlns.supabase.co'
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJIUzI6Imp4d2diemF0ZHVlZWZkaXl4bG5zIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzY3NzMwNjMsImV4cCI6MjA5MjM0OTA2M30.8HFzw4B9i2wB8cBuuG-gR9xEswt8kp-QyA8zqvd6YRQ'
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
const VAPID_PUBLIC_KEY = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY
const VAPID_SUBJECT = process.env.VAPID_SUBJECT || 'mailto:giuseppeitalo95@gmail.com'

type PushSubscriptionRow = {
  id: string
  subscription: webPush.PushSubscription
}

const configureWebPush = () => {
  if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) return false
  webPush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY)
  return true
}

export async function POST(request: Request) {
  if (!SERVICE_ROLE_KEY) {
    return Response.json({ ok: false, error: 'Missing SUPABASE_SERVICE_ROLE_KEY' }, { status: 500 })
  }
  if (!configureWebPush()) {
    return Response.json({ ok: false, error: 'Missing VAPID keys' }, { status: 500 })
  }

  const authHeader = request.headers.get('authorization') || ''
  const token = authHeader.replace(/^Bearer\s+/i, '')
  if (!token) {
    return Response.json({ ok: false, error: 'Missing auth token' }, { status: 401 })
  }

  const authClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false }
  })
  const { data: { user }, error: authError } = await authClient.auth.getUser(token)
  if (authError || !user) {
    return Response.json({ ok: false, error: 'Invalid session' }, { status: 401 })
  }

  const db = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false }
  })

  const { data: subscriptions, error } = await db
    .from('push_subscriptions')
    .select('id, subscription')
    .eq('user_id', user.id)

  if (error) {
    return Response.json({ ok: false, error: error.message }, { status: 500 })
  }

  const payload = JSON.stringify({
    title: 'Test notifiche OPV',
    body: 'Se vedi questa notifica, il dispositivo e collegato correttamente.',
    url: '/profile'
  })

  let sent = 0
  const failures: string[] = []

  await Promise.all(((subscriptions || []) as PushSubscriptionRow[]).map(async item => {
    try {
      await webPush.sendNotification(item.subscription, payload)
      sent += 1
    } catch (sendError: any) {
      const statusCode = Number(sendError?.statusCode || 0)
      failures.push(String(statusCode || sendError?.message || 'send_failed'))
      if (statusCode === 404 || statusCode === 410) {
        await db.from('push_subscriptions').delete().eq('id', item.id)
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
