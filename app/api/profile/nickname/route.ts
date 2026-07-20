import { isAdminAccount } from '@/lib/admin'
import { requireServiceClient } from '@/lib/serverSupabase'
import { validateUserText } from '@/lib/textModeration'

const COOLDOWN_DAYS = 30
const MIN_LENGTH = 3
const MAX_LENGTH = 24

const cleanNickname = (value: unknown) => String(value || '').trim().replace(/\s+/g, ' ')

const validateNickname = (value: string) => {
  if (value.length < MIN_LENGTH || value.length > MAX_LENGTH) {
    return `Il nickname deve contenere da ${MIN_LENGTH} a ${MAX_LENGTH} caratteri.`
  }
  if (!/^[\p{L}\p{N}._ -]+$/u.test(value)) {
    return 'Usa solo lettere, numeri, spazi, punto, trattino o underscore.'
  }
  const moderation = validateUserText(value)
  return moderation.ok ? '' : moderation.message
}

const getRequestUser = async (request: Request) => {
  const client = requireServiceClient()
  const token = (request.headers.get('authorization') || '').replace(/^Bearer\s+/i, '')
  if (!token) return { client, user: null }
  const { data: { user } } = await client.auth.getUser(token)
  return { client, user }
}

export async function GET(request: Request) {
  const { client, user } = await getRequestUser(request)
  if (!user) return Response.json({ ok: false, error: 'Sessione non valida.' }, { status: 401 })

  const { data, error } = await client
    .from('profiles')
    .select('username, username_changed_at, username_change_credits')
    .eq('id', user.id)
    .maybeSingle()

  if (error) return Response.json({ ok: false, error: error.message }, { status: 500 })

  const changedAt = data?.username_changed_at ? new Date(data.username_changed_at) : null
  const nextChangeAt = changedAt
    ? new Date(changedAt.getTime() + COOLDOWN_DAYS * 24 * 60 * 60 * 1000)
    : null
  const credits = Math.max(0, Number(data?.username_change_credits || 0))

  return Response.json({
    ok: true,
    username: data?.username || '',
    credits,
    nextChangeAt: nextChangeAt?.toISOString() || null,
    canChange: !data?.username || credits > 0 || !nextChangeAt || nextChangeAt.getTime() <= Date.now(),
  })
}

export async function POST(request: Request) {
  const { client, user } = await getRequestUser(request)
  if (!user) return Response.json({ ok: false, error: 'Sessione non valida.' }, { status: 401 })

  const body = await request.json().catch(() => null)
  const nickname = cleanNickname(body?.nickname)
  const validationError = validateNickname(nickname)
  if (validationError) return Response.json({ ok: false, error: validationError }, { status: 400 })

  const { data: profile, error: profileError } = await client
    .from('profiles')
    .select('username, username_changed_at, username_change_credits')
    .eq('id', user.id)
    .maybeSingle()

  if (profileError) return Response.json({ ok: false, error: profileError.message }, { status: 500 })

  const isInitialChoice = !profile?.username
  const credits = Math.max(0, Number(profile?.username_change_credits || 0))
  const lastChanged = profile?.username_changed_at ? new Date(profile.username_changed_at).getTime() : 0
  const nextChangeTime = lastChanged + COOLDOWN_DAYS * 24 * 60 * 60 * 1000
  const cooldownActive = Boolean(lastChanged && nextChangeTime > Date.now())

  if (!isInitialChoice && credits === 0 && cooldownActive) {
    return Response.json({
      ok: false,
      error: `Potrai modificare di nuovo il nickname dal ${new Date(nextChangeTime).toLocaleDateString('it-IT')}.`,
      nextChangeAt: new Date(nextChangeTime).toISOString(),
    }, { status: 429 })
  }

  const changes = {
    username: nickname,
    username_locked: true,
    username_changed_at: isInitialChoice ? null : new Date().toISOString(),
    username_change_credits: !isInitialChoice && cooldownActive && credits > 0 ? credits - 1 : credits,
  }

  const result = profile
    ? await client.from('profiles').update(changes).eq('id', user.id)
    : await client.from('profiles').insert({ id: user.id, ...changes })

  if (result.error) {
    return Response.json({
      ok: false,
      error: result.error.code === '23505' ? 'Questo nickname è già utilizzato.' : result.error.message,
    }, { status: result.error.code === '23505' ? 409 : 500 })
  }

  return Response.json({ ok: true, username: nickname })
}

export async function PATCH(request: Request) {
  const { client, user } = await getRequestUser(request)
  if (!user) return Response.json({ ok: false, error: 'Sessione non valida.' }, { status: 401 })

  const { data: adminProfile } = await client
    .from('profiles')
    .select('username')
    .eq('id', user.id)
    .maybeSingle()
  if (!isAdminAccount(user, adminProfile)) {
    return Response.json({ ok: false, error: 'Accesso riservato agli admin.' }, { status: 403 })
  }

  const body = await request.json().catch(() => null)
  const userId = String(body?.userId || '')
  const action = String(body?.action || '')
  if (!userId) return Response.json({ ok: false, error: 'Utente non valido.' }, { status: 400 })

  if (action === 'grant-credit') {
    const { data: target, error } = await client
      .from('profiles')
      .select('username_change_credits')
      .eq('id', userId)
      .maybeSingle()
    if (error || !target) return Response.json({ ok: false, error: error?.message || 'Profilo non trovato.' }, { status: 404 })
    const nextCredits = Math.max(0, Number(target.username_change_credits || 0)) + 1
    const { error: updateError } = await client
      .from('profiles')
      .update({ username_change_credits: nextCredits })
      .eq('id', userId)
    if (updateError) return Response.json({ ok: false, error: updateError.message }, { status: 500 })
    return Response.json({ ok: true, credits: nextCredits })
  }

  if (action === 'rename') {
    const nickname = cleanNickname(body?.nickname)
    const validationError = validateNickname(nickname)
    if (validationError) return Response.json({ ok: false, error: validationError }, { status: 400 })
    const { error } = await client.from('profiles').update({ username: nickname }).eq('id', userId)
    if (error) {
      return Response.json({ ok: false, error: error.code === '23505' ? 'Nickname già utilizzato.' : error.message }, { status: error.code === '23505' ? 409 : 500 })
    }
    return Response.json({ ok: true, username: nickname })
  }

  return Response.json({ ok: false, error: 'Azione non valida.' }, { status: 400 })
}
