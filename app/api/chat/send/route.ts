import { createClient } from '@supabase/supabase-js'
import { validateUserText } from '@/lib/textModeration'
import { sendPushToUsers } from '@/lib/pushNotifications'

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://jxwgbzatdueefdiyxlns.supabase.co'
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
const db = () => SERVICE_ROLE_KEY
  ? createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } })
  : null

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
  const push = await sendPushToUsers(client, [receiverId], {
    title: `Nuovo messaggio da ${senderName}`,
    body: message.slice(0, 180),
    url: `/chat?user=${encodeURIComponent(user.id)}&post=${encodeURIComponent(postId)}`,
    tag: `chat-${postId}-${user.id}`,
  })

  return Response.json({ ok: true, message: inserted, post, push })
}
