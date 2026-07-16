import { NextRequest } from 'next/server'
import { isAdminAccount } from '@/lib/admin'
import { readCatalogSyncState, refreshCatalogSyncState, syncCardCatalog, syncCatalogImages } from '@/lib/cardCatalogSync'
import { createServiceClient } from '@/lib/serverSupabase'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const isCronAuthorized = (request: NextRequest) => {
  const secret = process.env.MAINTENANCE_SECRET || process.env.CRON_SECRET
  if (!secret) return false
  const authorization = request.headers.get('authorization') || ''
  const querySecret = request.nextUrl.searchParams.get('secret') || ''
  return authorization === `Bearer ${secret}` || querySecret === secret
}

const isAdminRequest = async (request: NextRequest) => {
  const client = createServiceClient()
  if (!client) return false

  const token = (request.headers.get('authorization') || '').replace(/^Bearer\s+/i, '')
  if (!token) return false
  const { data: { user }, error } = await client.auth.getUser(token)
  if (error || !user) return false

  const { data: profile } = await client
    .from('profiles')
    .select('username')
    .eq('id', user.id)
    .maybeSingle()
  return isAdminAccount(user, profile)
}

const authorize = async (request: NextRequest) => isCronAuthorized(request) || await isAdminRequest(request)

export async function GET(request: NextRequest) {
  if (!(await authorize(request))) return Response.json({ ok: false, error: 'Unauthorized' }, { status: 401 })

  try {
    const state = await readCatalogSyncState()
    return Response.json({ ok: true, state })
  } catch (error) {
    return Response.json({
      ok: false,
      error: error instanceof Error ? error.message : 'Stato catalogo non disponibile',
    }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  if (!(await authorize(request))) return Response.json({ ok: false, error: 'Unauthorized' }, { status: 401 })

  const body = await request.json().catch(() => ({})) as { mode?: string; limit?: number; resetFailed?: boolean }
  try {
    if (body.mode === 'images') {
      return Response.json(await syncCatalogImages(body.limit || 40, Boolean(body.resetFailed)))
    }
    if (body.mode === 'status') {
      return Response.json({ ok: true, state: await refreshCatalogSyncState() })
    }
    return Response.json(await syncCardCatalog())
  } catch (error) {
    return Response.json({
      ok: false,
      error: error instanceof Error ? error.message : 'Sincronizzazione catalogo fallita',
    }, { status: 500 })
  }
}
