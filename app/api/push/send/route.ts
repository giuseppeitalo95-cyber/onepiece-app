import { createClient } from '@supabase/supabase-js'
import { sendPushToUsers } from '@/lib/pushNotifications'

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://jxwgbzatdueefdiyxlns.supabase.co'
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY

export async function POST(request: Request) {
  if (!SERVICE_ROLE_KEY) {
    return Response.json({ ok: false, error: 'Missing SUPABASE_SERVICE_ROLE_KEY' }, { status: 500 })
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

  const body = await request.json().catch(() => null)
  const receiverId = String(body?.receiverId || '')
  const title = String(body?.title || 'OnePiece Vault').slice(0, 80)
  const messageBody = String(body?.body || 'Hai una nuova notifica.').slice(0, 180)
  const url = String(body?.url || '/chat').slice(0, 300)

  if (!receiverId) {
    return Response.json({ ok: false, error: 'Missing receiverId' }, { status: 400 })
  }
  if (receiverId === user.id) {
    return Response.json({ ok: true, subscriptions: 0, sent: 0, failures: [] })
  }

  const db = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false }
  })

  const delivery = await sendPushToUsers(db, [receiverId], { title, body: messageBody, url })
  return Response.json({ ok: true, ...delivery })
}
