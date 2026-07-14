import { createClient } from '@supabase/supabase-js'
import webPush from 'web-push'
import { validateUserText } from '@/lib/textModeration'

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://jxwgbzatdueefdiyxlns.supabase.co'
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
const VAPID_PUBLIC_KEY = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY
const VAPID_SUBJECT = process.env.VAPID_SUBJECT || 'mailto:giuseppeitalo95@gmail.com'

type PushSubscriptionRow = {
  id: string
  subscription: webPush.PushSubscription
}

const db = () => SERVICE_ROLE_KEY
  ? createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } })
  : null

const configureWebPush = () => {
  if (!VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) return false
  webPush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY)
  return true
}

const sendMessagePush = async (
  client: any,
  receiverId: string,
  senderName: string,
  message: string,
  senderId: string,
  postId: string
) => {
  if (!configureWebPush()) return

  const { data: subscriptions } = await client
    .from('push_subscriptions')
    .select('id, subscription')
    .eq('user_id', receiverId)

  const payload = JSON.stringify({
    title: `Nuovo messaggio da ${senderName}`,
    body: message.slice(0, 180),
    url: `/chat?user=${encodeURIComponent(senderId)}&post=${encodeURIComponent(postId)}`
  })

  await Promise.all(((subscriptions || []) as PushSubscriptionRow[]).map(async item => {
    try {
      await webPush.sendNotification(item.subscription, payload)
    } catch (sendError: any) {
      const statusCode = Number(sendError?.statusCode || 0)
      if (statusCode === 404 || statusCode === 410) {
        await client.from('push_subscriptions').delete().eq('id', item.id)
      }
    }
  }))
}

export async function POST(request: Request) {
  const client = db()
  if (!client) return Response.json({ ok: false, error: 'Missing SUPABASE_SERVICE_ROLE_KEY' }, { status: 503 })

  const authHeader = request.headers.get('authorization') || ''
  const token = authHeader.replace(/^Bearer\s+/i, '')
  if (!token) return Response.json({ ok: false, error: 'Missing auth token' }, { status: 401 })

  const { data: { user }, error: userError } = await client.auth.getUser(token)
  if (userError || !user) return Response.json({ ok: false, error: 'Invalid session' }, { status: 401 })

  const body = await request.json().catch(() => null)
  const receiverId = String(body?.receiverId || '')
  const postId = String(body?.postId || '')
  const message = String(body?.body || '').trim().slice(0, 800)

  if (!receiverId || receiverId === user.id) {
    return Response.json({ ok: false, error: 'Destinatario non valido.' }, { status: 400 })
  }
  if (!postId) {
    return Response.json({ ok: false, error: 'La chat puo partire solo da un annuncio.' }, { status: 400 })
  }
  if (!message) {
    return Response.json({ ok: false, error: 'Messaggio vuoto.' }, { status: 400 })
  }
  const moderation = validateUserText(message)
  if (!moderation.ok) {
    return Response.json({ ok: false, error: moderation.message }, { status: 400 })
  }

  const { data: post, error: postError } = await client
    .from('board_posts')
    .select('id, user_id, title, card_name, card_code, created_at')
    .eq('id', postId)
    .maybeSingle()

  if (postError || !post) {
    return Response.json({ ok: false, error: 'Annuncio non trovato.' }, { status: 404 })
  }

  const postOwnerId = String(post.user_id)
  const isPostConversation =
    (user.id === postOwnerId && receiverId !== postOwnerId) ||
    (receiverId === postOwnerId && user.id !== postOwnerId)

  if (!isPostConversation) {
    return Response.json({ ok: false, error: 'Questa chat non appartiene all annuncio.' }, { status: 403 })
  }

  const { data: block } = await client
    .from('chat_blocks')
    .select('blocker_id')
    .or(`and(blocker_id.eq.${user.id},blocked_id.eq.${receiverId}),and(blocker_id.eq.${receiverId},blocked_id.eq.${user.id})`)
    .limit(1)
    .maybeSingle()

  if (block) {
    return Response.json({ ok: false, error: 'Chat bloccata da uno dei due utenti.' }, { status: 403 })
  }

  let { data: inserted, error: insertError } = await client
    .from('chat_messages')
    .insert({
      post_id: postId,
      sender_id: user.id,
      receiver_id: receiverId,
      body: message
    })
    .select('id, post_id, sender_id, receiver_id, body, read_at, created_at')
    .single()

  if (insertError && insertError.message.toLowerCase().includes('post_id')) {
    const fallback = await client
      .from('chat_messages')
      .insert({
        sender_id: user.id,
        receiver_id: receiverId,
        body: message
      })
      .select('id, sender_id, receiver_id, body, read_at, created_at')
      .single()

    inserted = fallback.data ? { ...fallback.data, post_id: null } : null
    insertError = fallback.error
  }

  if (insertError) return Response.json({ ok: false, error: insertError.message }, { status: 500 })
  const { data: senderProfile } = await client
    .from('profiles')
    .select('username')
    .eq('id', user.id)
    .maybeSingle()

  const senderName = String(senderProfile?.username || user.email?.split('@')[0] || 'OPV')
  await sendMessagePush(client, receiverId, senderName, message, user.id, postId)

  return Response.json({ ok: true, message: inserted, post })
}
