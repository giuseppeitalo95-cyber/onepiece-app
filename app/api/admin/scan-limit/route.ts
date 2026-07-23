import { isAdminAccount } from '@/lib/admin'
import {
  DEFAULT_MONTHLY_SCAN_LIMIT,
  MAX_MONTHLY_SCAN_LIMIT,
  SCAN_LIMIT_SETTINGS_KEY,
  normalizeMonthlyScanLimit,
  readMonthlyScanLimit,
} from '@/lib/scanLimit'
import { createServiceClient } from '@/lib/serverSupabase'

export const dynamic = 'force-dynamic'

const currentMonthKey = () => {
  const now = new Date()
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`
}

const authenticateAdmin = async (request: Request) => {
  const client = createServiceClient()
  if (!client) return { error: Response.json({ ok: false, error: 'Service role non configurata.' }, { status: 503 }) }

  const token = (request.headers.get('authorization') || '').replace(/^Bearer\s+/i, '')
  if (!token) return { error: Response.json({ ok: false, error: 'Sessione mancante.' }, { status: 401 }) }

  const { data: { user }, error } = await client.auth.getUser(token)
  if (error || !user) return { error: Response.json({ ok: false, error: 'Sessione non valida.' }, { status: 401 }) }

  const { data: profile } = await client.from('profiles').select('username').eq('id', user.id).maybeSingle()
  if (!isAdminAccount(user, profile)) {
    return { error: Response.json({ ok: false, error: 'Accesso admin richiesto.' }, { status: 403 }) }
  }

  return { client }
}

export async function GET(request: Request) {
  const auth = await authenticateAdmin(request)
  if ('error' in auth) return auth.error

  const month = currentMonthKey()
  const [limit, usage] = await Promise.all([
    readMonthlyScanLimit(auth.client),
    auth.client.from('scan_usage_global').select('scan_count').eq('month', month).maybeSingle(),
  ])

  return Response.json({
    ok: true,
    month,
    scansUsed: Number(usage.data?.scan_count || 0),
    scansLimit: limit,
    error: usage.error?.message || null,
  })
}

export async function PATCH(request: Request) {
  const auth = await authenticateAdmin(request)
  if ('error' in auth) return auth.error

  const body = await request.json().catch(() => null)
  if (body?.confirmation !== 'SALVA') {
    return Response.json({ ok: false, error: 'Conferma non valida.' }, { status: 400 })
  }

  const rawLimit = Number(body?.limit)
  if (!Number.isInteger(rawLimit) || rawLimit < 1 || rawLimit > MAX_MONTHLY_SCAN_LIMIT) {
    return Response.json({
      ok: false,
      error: `Inserisci un limite intero tra 1 e ${MAX_MONTHLY_SCAN_LIMIT}.`,
    }, { status: 400 })
  }

  const limit = normalizeMonthlyScanLimit(rawLimit)
  const { error } = await auth.client
    .from('scan_usage_global')
    .upsert({
      month: SCAN_LIMIT_SETTINGS_KEY,
      scan_count: limit,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'month' })

  if (error) {
    return Response.json({ ok: false, error: error.message }, { status: 500 })
  }

  return Response.json({
    ok: true,
    month: currentMonthKey(),
    scansLimit: limit,
    defaultLimit: DEFAULT_MONTHLY_SCAN_LIMIT,
  })
}
