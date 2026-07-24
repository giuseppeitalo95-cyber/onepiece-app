import { isAdminAccount } from '@/lib/admin'
import { createServiceClient } from '@/lib/serverSupabase'

export const dynamic = 'force-dynamic'

const json = (body: Record<string, unknown>, status = 200) =>
  Response.json(body, {
    status,
    headers: { 'Cache-Control': 'no-store' },
  })

export async function GET(request: Request) {
  const client = createServiceClient()
  if (!client) return json({ ok: false, error: 'Servizio admin non configurato.' }, 503)

  const token = (request.headers.get('authorization') || '').replace(/^Bearer\s+/i, '')
  if (!token) return json({ ok: false, error: 'Sessione mancante.' }, 401)

  const { data: { user }, error } = await client.auth.getUser(token)
  if (error || !user) return json({ ok: false, error: 'Sessione non valida.' }, 401)
  if (!isAdminAccount(user)) return json({ ok: false, error: 'Accesso admin richiesto.' }, 403)

  return json({ ok: true })
}
