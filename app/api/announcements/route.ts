import { createClient } from '@supabase/supabase-js'
import { isAdminAccount } from '@/lib/admin'

export const dynamic = 'force-dynamic'

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://jxwgbzatdueefdiyxlns.supabase.co'
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY

const getClient = () => SERVICE_ROLE_KEY
  ? createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false }
    })
  : null

const getUser = async (request: Request, client: NonNullable<ReturnType<typeof getClient>>) => {
  const token = (request.headers.get('authorization') || '').replace(/^Bearer\s+/i, '')
  if (!token) return null
  const { data: { user }, error } = await client.auth.getUser(token)
  return error ? null : user
}

const getAdmin = async (
  request: Request,
  client: NonNullable<ReturnType<typeof getClient>>
) => {
  const user = await getUser(request, client)
  if (!user) return null
  const { data: profile } = await client
    .from('profiles')
    .select('username')
    .eq('id', user.id)
    .maybeSingle()
  return isAdminAccount(user, profile) ? user : null
}

const configurationError = (message?: string) =>
  /app_announcements|app_announcement_reads|schema cache|does not exist|could not find/i.test(message || '')

export async function GET(request: Request) {
  const client = getClient()
  if (!client) return Response.json({ ok: false, error: 'Service role non configurata.' }, { status: 500 })

  const url = new URL(request.url)
  if (url.searchParams.get('admin') === '1') {
    const admin = await getAdmin(request, client)
    if (!admin) return Response.json({ ok: false, error: 'Accesso admin richiesto.' }, { status: 403 })

    const { data, error } = await client
      .from('app_announcements')
      .select('id,title,message,is_active,published_at,created_at,updated_at')
      .order('published_at', { ascending: false })
      .limit(30)

    if (error) {
      return Response.json({
        ok: false,
        error: configurationError(error.message)
          ? 'Sistema annunci non configurato: esegui app_announcements.sql su Supabase.'
          : error.message
      }, { status: configurationError(error.message) ? 503 : 500 })
    }

    const ids = (data || []).map(item => item.id)
    const readCounts: Record<string, number> = {}
    if (ids.length > 0) {
      const { data: reads } = await client
        .from('app_announcement_reads')
        .select('announcement_id')
        .in('announcement_id', ids)
      for (const read of reads || []) {
        readCounts[read.announcement_id] = (readCounts[read.announcement_id] || 0) + 1
      }
    }

    return Response.json({
      ok: true,
      announcements: (data || []).map(item => ({ ...item, read_count: readCounts[item.id] || 0 }))
    })
  }

  const user = await getUser(request, client)
  if (!user) return Response.json({ ok: true, announcement: null })

  const { data: announcement, error } = await client
    .from('app_announcements')
    .select('id,title,message,published_at')
    .eq('is_active', true)
    .lte('published_at', new Date().toISOString())
    .order('published_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (error) {
    if (configurationError(error.message)) return Response.json({ ok: true, announcement: null })
    return Response.json({ ok: false, error: error.message }, { status: 500 })
  }
  if (!announcement) return Response.json({ ok: true, announcement: null })

  const { data: receipt } = await client
    .from('app_announcement_reads')
    .select('announcement_id')
    .eq('announcement_id', announcement.id)
    .eq('user_id', user.id)
    .maybeSingle()

  return Response.json({ ok: true, announcement: receipt ? null : announcement })
}

export async function POST(request: Request) {
  const client = getClient()
  if (!client) return Response.json({ ok: false, error: 'Service role non configurata.' }, { status: 500 })
  const admin = await getAdmin(request, client)
  if (!admin) return Response.json({ ok: false, error: 'Accesso admin richiesto.' }, { status: 403 })

  const body = await request.json().catch(() => null)
  const title = String(body?.title || '').trim()
  const message = String(body?.message || '').trim()
  if (title.length < 3 || title.length > 100) {
    return Response.json({ ok: false, error: 'Il titolo deve contenere da 3 a 100 caratteri.' }, { status: 400 })
  }
  if (message.length < 5 || message.length > 2000) {
    return Response.json({ ok: false, error: 'La descrizione deve contenere da 5 a 2000 caratteri.' }, { status: 400 })
  }

  const now = new Date().toISOString()
  const { error: deactivateError } = await client
    .from('app_announcements')
    .update({ is_active: false, updated_at: now })
    .eq('is_active', true)
  if (deactivateError && configurationError(deactivateError.message)) {
    return Response.json({ ok: false, error: 'Sistema annunci non configurato: esegui app_announcements.sql su Supabase.' }, { status: 503 })
  }

  const { data, error } = await client
    .from('app_announcements')
    .insert({ title, message, is_active: true, published_at: now, created_by: admin.id, updated_at: now })
    .select('id,title,message,is_active,published_at,created_at,updated_at')
    .single()

  if (error) return Response.json({ ok: false, error: error.message }, { status: 500 })
  return Response.json({ ok: true, announcement: { ...data, read_count: 0 } })
}

export async function PATCH(request: Request) {
  const client = getClient()
  if (!client) return Response.json({ ok: false, error: 'Service role non configurata.' }, { status: 500 })
  const body = await request.json().catch(() => null)
  const announcementId = String(body?.announcementId || '').trim()
  const action = String(body?.action || 'acknowledge')
  if (!announcementId) return Response.json({ ok: false, error: 'Annuncio mancante.' }, { status: 400 })

  if (action === 'withdraw') {
    const admin = await getAdmin(request, client)
    if (!admin) return Response.json({ ok: false, error: 'Accesso admin richiesto.' }, { status: 403 })
    const { error } = await client
      .from('app_announcements')
      .update({ is_active: false, updated_at: new Date().toISOString() })
      .eq('id', announcementId)
    if (error) return Response.json({ ok: false, error: error.message }, { status: 500 })
    return Response.json({ ok: true })
  }

  const user = await getUser(request, client)
  if (!user) return Response.json({ ok: false, error: 'Accesso richiesto.' }, { status: 401 })
  const { error } = await client
    .from('app_announcement_reads')
    .upsert({ announcement_id: announcementId, user_id: user.id, read_at: new Date().toISOString() }, {
      onConflict: 'announcement_id,user_id'
    })
  if (error) return Response.json({ ok: false, error: error.message }, { status: 500 })
  return Response.json({ ok: true })
}

export async function DELETE(request: Request) {
  const client = getClient()
  if (!client) return Response.json({ ok: false, error: 'Service role non configurata.' }, { status: 500 })
  const admin = await getAdmin(request, client)
  if (!admin) return Response.json({ ok: false, error: 'Accesso admin richiesto.' }, { status: 403 })
  const id = new URL(request.url).searchParams.get('id')?.trim()
  if (!id) return Response.json({ ok: false, error: 'Annuncio mancante.' }, { status: 400 })

  const { error } = await client.from('app_announcements').delete().eq('id', id)
  if (error) return Response.json({ ok: false, error: error.message }, { status: 500 })
  return Response.json({ ok: true })
}
