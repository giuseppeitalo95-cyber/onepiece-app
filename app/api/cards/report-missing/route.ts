import { isAdminAccount } from '@/lib/admin'
import { notifyAdmins } from '@/lib/adminPush'
import { requireServiceClient } from '@/lib/serverSupabase'
import { validateUserText } from '@/lib/textModeration'

const getUser = async (request: Request) => {
  const client = requireServiceClient()
  const token = (request.headers.get('authorization') || '').replace(/^Bearer\s+/i, '')
  if (!token) return { user: null, profile: null }
  const { data: { user }, error } = await client.auth.getUser(token)
  if (error || !user) return { user: null, profile: null }
  const { data: profile } = await client.from('profiles').select('username').eq('id', user.id).maybeSingle()
  return { user, profile }
}

const normalizeCardCode = (value: unknown) => {
  const compact = String(value || '').trim().toUpperCase().replace(/\s+/g, '')
  const match = compact.match(/^((?:OP|ST|EB|PRB|SP|EX|CP)\d{2}|P|DON)-?(\d{3})$/i)
  return match ? `${match[1]}-${match[2]}` : ''
}

export async function GET(request: Request) {
  const client = requireServiceClient()
  const { user, profile } = await getUser(request)
  if (!user) return Response.json({ ok: false, error: 'Sessione non valida.' }, { status: 401 })
  if (!isAdminAccount(user, profile)) return Response.json({ ok: false, error: 'Accesso Admin richiesto.' }, { status: 403 })

  const { data, error } = await client
    .from('missing_card_reports')
    .select('id,card_code,card_variant,description,card_name,card_op,card_number,status,reported_by,created_at')
    .order('created_at', { ascending: false })
  if (error) return Response.json({ ok: false, error: error.message }, { status: 500 })
  return Response.json({ ok: true, reports: data || [] })
}

export async function POST(request: Request) {
  try {
    const client = requireServiceClient()
    const { user, profile } = await getUser(request)
    if (!user) return Response.json({ ok: false, error: 'Sessione non valida.' }, { status: 401 })

    const body = await request.json().catch(() => null)
    const cardCode = normalizeCardCode(body?.card_code)
    const cardVariant = String(body?.card_variant || '').trim().slice(0, 160)
    const description = String(body?.description || '').trim().slice(0, 1200)

    if (!cardCode) {
      return Response.json({ ok: false, error: 'Scrivi un codice completo, per esempio OP16-056.' }, { status: 400 })
    }
    if (cardVariant.length < 2) {
      return Response.json({ ok: false, error: 'Indica rarita e variante della carta.' }, { status: 400 })
    }

    const moderation = validateUserText(`${cardVariant} ${description}`)
    if (!moderation.ok) return Response.json({ ok: false, error: moderation.message }, { status: 400 })

    const [cardOp, cardNumber] = cardCode.split('-')
    const { data, error } = await client.from('missing_card_reports').insert({
      card_code: cardCode,
      card_variant: cardVariant,
      description: description || null,
      // Le colonne storiche restano compilate per compatibilita con i vecchi client.
      card_name: cardVariant,
      card_op: cardOp,
      card_number: cardNumber,
      reported_by: user.id,
      status: 'new',
      created_at: new Date().toISOString(),
    }).select('id').single()

    if (error) {
      if (/card_code|card_variant|description/i.test(error.message)) {
        return Response.json({ ok: false, error: 'Aggiorna prima lo schema con manual_card_import.sql.' }, { status: 500 })
      }
      return Response.json({ ok: false, error: error.message }, { status: 500 })
    }

    const push = await notifyAdmins(
      'Nuova carta assente',
      `${profile?.username || user.email || 'Utente'}: ${cardCode} · ${cardVariant}`,
      '/admin'
    )

    return Response.json({ ok: true, id: data?.id, push }, { status: 201 })
  } catch (error) {
    console.error('Report missing card error:', error)
    return Response.json({ ok: false, error: 'Errore server.' }, { status: 500 })
  }
}
