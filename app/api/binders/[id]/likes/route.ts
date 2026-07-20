import { sendPushToUsers } from '@/lib/pushNotifications'
import { createServiceClient } from '@/lib/serverSupabase'

type RouteContext = {
  params: Promise<{ id: string }>
}

const authenticate = async (request: Request) => {
  const client = createServiceClient()
  if (!client) return { error: Response.json({ ok: false, error: 'Servizio non configurato.' }, { status: 503 }) }

  const token = (request.headers.get('authorization') || '').replace(/^Bearer\s+/i, '')
  if (!token) return { error: Response.json({ ok: false, error: 'Sessione mancante.' }, { status: 401 }) }

  const { data: { user }, error } = await client.auth.getUser(token)
  if (error || !user) return { error: Response.json({ ok: false, error: 'Sessione non valida.' }, { status: 401 }) }

  return { client, user }
}

export async function GET(request: Request, context: RouteContext) {
  const auth = await authenticate(request)
  if ('error' in auth) return auth.error

  const { id: binderId } = await context.params
  const { data: binder } = await auth.client
    .from('binders')
    .select('id, user_id, is_shared')
    .eq('id', binderId)
    .maybeSingle()

  if (!binder || (!binder.is_shared && binder.user_id !== auth.user.id)) {
    return Response.json({ ok: false, error: 'Raccoglitore non disponibile.' }, { status: 404 })
  }

  const { data: rows, error } = await auth.client
    .from('binder_likes')
    .select('user_id, created_at')
    .eq('binder_id', binderId)
    .order('created_at', { ascending: false })

  if (error) return Response.json({ ok: false, error: error.message }, { status: 500 })

  const userIds = (rows || []).map(row => String(row.user_id))
  const { data: profiles } = userIds.length
    ? await auth.client.from('profiles').select('id, username, avatar_url').in('id', userIds)
    : { data: [] }
  const profileById = new Map((profiles || []).map(profile => [String(profile.id), profile]))
  const likes = (rows || []).map(row => {
    const profile = profileById.get(String(row.user_id))
    return {
      userId: String(row.user_id),
      username: String(profile?.username || 'Utente OPV'),
      avatarUrl: profile?.avatar_url ? String(profile.avatar_url) : null,
      createdAt: String(row.created_at),
    }
  })

  return Response.json({
    ok: true,
    likes,
    count: likes.length,
    liked: userIds.includes(auth.user.id),
  })
}

export async function POST(request: Request, context: RouteContext) {
  const auth = await authenticate(request)
  if ('error' in auth) return auth.error

  const { id: binderId } = await context.params
  const { data: binder } = await auth.client
    .from('binders')
    .select('id, user_id, title, is_shared')
    .eq('id', binderId)
    .maybeSingle()

  if (!binder?.is_shared) {
    return Response.json({ ok: false, error: 'Raccoglitore non disponibile.' }, { status: 404 })
  }

  const { data: existing } = await auth.client
    .from('binder_likes')
    .select('binder_id')
    .eq('binder_id', binderId)
    .eq('user_id', auth.user.id)
    .maybeSingle()

  let liked = false
  if (existing) {
    const { error } = await auth.client
      .from('binder_likes')
      .delete()
      .eq('binder_id', binderId)
      .eq('user_id', auth.user.id)
    if (error) return Response.json({ ok: false, error: error.message }, { status: 500 })
  } else {
    const { error } = await auth.client
      .from('binder_likes')
      .insert({ binder_id: binderId, user_id: auth.user.id })
    if (error && error.code !== '23505') {
      return Response.json({ ok: false, error: error.message }, { status: 500 })
    }
    liked = true

    if (binder.user_id !== auth.user.id) {
      const { data: actor } = await auth.client
        .from('profiles')
        .select('username')
        .eq('id', auth.user.id)
        .maybeSingle()
      const actorName = String(actor?.username || auth.user.email?.split('@')[0] || 'Un utente')
      await sendPushToUsers(auth.client, [String(binder.user_id)], {
        title: 'Nuovo like al tuo raccoglitore',
        body: `${actorName} ha messo 1 like al tuo raccoglitore "${binder.title}"`,
        url: `/binders/${binderId}`,
        tag: `binder-like-${binderId}-${auth.user.id}`,
      })
    }
  }

  const { count } = await auth.client
    .from('binder_likes')
    .select('binder_id', { count: 'exact', head: true })
    .eq('binder_id', binderId)

  return Response.json({ ok: true, liked, count: count || 0 })
}
