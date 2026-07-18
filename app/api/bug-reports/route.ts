import { createClient } from '@supabase/supabase-js'
import { isAdminAccount } from '@/lib/admin'
import { notifyAdmins } from '@/lib/adminPush'
import { validateUserText } from '@/lib/textModeration'

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://jxwgbzatdueefdiyxlns.supabase.co'
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
const db = () => {
  if (!SERVICE_ROLE_KEY) return null
  return createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } })
}

const getUser = async (request: Request) => {
  const authHeader = request.headers.get('authorization') || ''
  const token = authHeader.replace(/^Bearer\s+/i, '')
  if (!token || !SERVICE_ROLE_KEY) return { user: null, profile: null, error: 'Missing auth token' }

  const authClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false }
  })
  const { data: { user }, error } = await authClient.auth.getUser(token)
  if (error || !user) return { user: null, profile: null, error: 'Invalid session' }

  const client = db()
  const { data: profile } = client
    ? await client.from('profiles').select('username').eq('id', user.id).maybeSingle()
    : { data: null }

  return { user, profile, error: null }
}

export async function GET(request: Request) {
  const client = db()
  if (!client) return Response.json({ ok: false, error: 'Missing SUPABASE_SERVICE_ROLE_KEY' }, { status: 500 })

  const { user, profile, error } = await getUser(request)
  if (error || !user) return Response.json({ ok: false, error }, { status: 401 })
  if (!isAdminAccount(user, profile)) return Response.json({ ok: false, error: 'Forbidden' }, { status: 403 })

  const { data, error: listError } = await client
    .from('bug_reports')
    .select('id, reporter_id, reporter_email, reporter_username, page_path, title, message, user_agent, status, resolved_at, created_at, updated_at')
    .order('created_at', { ascending: false })

  if (listError) return Response.json({ ok: false, error: listError.message }, { status: 500 })
  return Response.json({ ok: true, reports: data || [] })
}

export async function POST(request: Request) {
  const client = db()
  if (!client) return Response.json({ ok: false, error: 'Missing SUPABASE_SERVICE_ROLE_KEY' }, { status: 500 })

  const { user, profile, error } = await getUser(request)
  if (error || !user) return Response.json({ ok: false, error }, { status: 401 })

  const body = await request.json().catch(() => null)
  const message = String(body?.message || '').trim().slice(0, 1600)
  const title = String(body?.title || '').trim().slice(0, 120)
  const pagePath = String(body?.pagePath || '').trim().slice(0, 300)

  if (message.length < 5) {
    return Response.json({ ok: false, error: 'Descrizione troppo breve.' }, { status: 400 })
  }

  const moderation = validateUserText(`${title} ${message}`)
  if (!moderation.ok) {
    return Response.json({ ok: false, error: moderation.message }, { status: 400 })
  }

  const { data, error: insertError } = await client
    .from('bug_reports')
    .insert({
      reporter_id: user.id,
      reporter_email: user.email || null,
      reporter_username: profile?.username || null,
      page_path: pagePath || null,
      title: title || null,
      message,
      user_agent: request.headers.get('user-agent'),
      status: 'new'
    })
    .select('id')
    .single()

  if (insertError) return Response.json({ ok: false, error: insertError.message }, { status: 500 })

  const push = await notifyAdmins(
    'Nuova segnalazione bug',
    `${profile?.username || user.email || 'Utente'}: ${title || message.slice(0, 80)}`
  )

  return Response.json({ ok: true, id: data?.id, push })
}

export async function PATCH(request: Request) {
  const client = db()
  if (!client) return Response.json({ ok: false, error: 'Missing SUPABASE_SERVICE_ROLE_KEY' }, { status: 500 })

  const { user, profile, error } = await getUser(request)
  if (error || !user) return Response.json({ ok: false, error }, { status: 401 })
  if (!isAdminAccount(user, profile)) return Response.json({ ok: false, error: 'Forbidden' }, { status: 403 })

  const body = await request.json().catch(() => null)
  const id = String(body?.id || '')
  const status = String(body?.status || 'resolved')
  if (!id) return Response.json({ ok: false, error: 'Missing id' }, { status: 400 })

  const { error: updateError } = await client
    .from('bug_reports')
    .update({
      status,
      resolved_at: status === 'resolved' ? new Date().toISOString() : null,
      resolved_by: status === 'resolved' ? user.id : null,
      updated_at: new Date().toISOString()
    })
    .eq('id', id)

  if (updateError) return Response.json({ ok: false, error: updateError.message }, { status: 500 })
  return Response.json({ ok: true })
}

export async function DELETE(request: Request) {
  const client = db()
  if (!client) return Response.json({ ok: false, error: 'Missing SUPABASE_SERVICE_ROLE_KEY' }, { status: 500 })

  const { user, profile, error } = await getUser(request)
  if (error || !user) return Response.json({ ok: false, error }, { status: 401 })
  if (!isAdminAccount(user, profile)) return Response.json({ ok: false, error: 'Forbidden' }, { status: 403 })

  const { searchParams } = new URL(request.url)
  const id = searchParams.get('id')
  if (!id) return Response.json({ ok: false, error: 'Missing id' }, { status: 400 })

  const { error: deleteError } = await client.from('bug_reports').delete().eq('id', id)
  if (deleteError) return Response.json({ ok: false, error: deleteError.message }, { status: 500 })
  return Response.json({ ok: true })
}
