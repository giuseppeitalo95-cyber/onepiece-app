import { isAdminAccount } from '@/lib/admin'
import { getAdminTables, requireAdminTable } from '@/lib/adminDatabase'
import { deleteR2Object, getR2Status, listR2Objects } from '@/lib/r2Storage'
import { createServiceClient } from '@/lib/serverSupabase'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

const authenticateAdmin = async (request: Request) => {
  const client = createServiceClient()
  if (!client) return { error: Response.json({ ok: false, error: 'Service role non configurata.' }, { status: 503 }) }
  const token = (request.headers.get('authorization') || '').replace(/^Bearer\s+/i, '')
  if (!token) return { error: Response.json({ ok: false, error: 'Sessione mancante.' }, { status: 401 }) }
  const { data: { user }, error } = await client.auth.getUser(token)
  if (error || !user) return { error: Response.json({ ok: false, error: 'Sessione non valida.' }, { status: 401 }) }
  const { data: profile } = await client.from('profiles').select('username').eq('id', user.id).maybeSingle()
  if (!isAdminAccount(user, profile)) return { error: Response.json({ ok: false, error: 'Accesso admin richiesto.' }, { status: 403 }) }
  return { client, user }
}

const safeSearch = (value: string) => value.trim().replace(/[^\p{L}\p{N}@._+\- ]/gu, ' ').replace(/\s+/g, ' ').slice(0, 120)
const isTextColumn = (format: string) => ['text', 'character varying', 'citext'].includes(format)

export async function GET(request: Request) {
  const auth = await authenticateAdmin(request)
  if ('error' in auth) return auth.error

  try {
    const params = new URL(request.url).searchParams
    const source = params.get('source') || 'metadata'

    if (source === 'metadata') {
      const [tables, r2] = await Promise.all([getAdminTables(), getR2Status()])
      return Response.json({
        ok: true,
        tables: [
          { name: 'auth.users', columns: [], primaryKeys: ['id'], canInsert: false, canUpdate: false, canDelete: false, virtual: true },
          ...tables,
        ],
        r2: { configured: r2.configured, online: r2.online, objects: r2.objects, bytes: r2.bytes, bucket: r2.bucket },
      })
    }

    if (source === 'r2') {
      const result = await listR2Objects({
        prefix: params.get('q') || '',
        continuationToken: params.get('cursor') || undefined,
        limit: 60,
      })
      return Response.json({ ok: true, ...result })
    }

    const tableName = String(params.get('table') || '')
    const page = Math.max(1, Number(params.get('page') || 1))
    const limit = Math.min(100, Math.max(10, Number(params.get('limit') || 50)))
    const search = safeSearch(params.get('q') || '')

    if (tableName === 'auth.users') {
      const { data, error } = await auth.client.auth.admin.listUsers({ page: 1, perPage: 1000 })
      if (error) throw error
      const query = search.toLowerCase()
      const allRows = data.users
        .filter(user => !query || [user.id, user.email, user.phone, user.user_metadata?.username]
          .filter(Boolean).some(value => String(value).toLowerCase().includes(query)))
        .map(user => ({
          id: user.id,
          email: user.email || null,
          phone: user.phone || null,
          email_confirmed_at: user.email_confirmed_at || null,
          last_sign_in_at: user.last_sign_in_at || null,
          created_at: user.created_at,
          app_metadata: user.app_metadata,
          user_metadata: user.user_metadata,
        }))
      const offset = (page - 1) * limit
      return Response.json({ ok: true, rows: allRows.slice(offset, offset + limit), count: allRows.length, page, limit, readOnly: true })
    }

    const table = await requireAdminTable(tableName)
    let query = auth.client.from(table.name).select('*', { count: 'estimated' })
    if (search) {
      const conditions = table.columns
        .filter(column => isTextColumn(column.format))
        .slice(0, 24)
        .map(column => `${column.name}.ilike.*${search}*`)
      const numericValue = Number(search)
      if (Number.isFinite(numericValue)) {
        conditions.push(...table.columns
          .filter(column => ['integer', 'bigint', 'numeric', 'double precision', 'real'].includes(column.format))
          .slice(0, 8)
          .map(column => `${column.name}.eq.${numericValue}`))
      }
      if (conditions.length > 0) query = query.or(conditions.join(','))
    }
    const orderColumn = table.columns.find(column => column.name === 'created_at')?.name
      || table.columns.find(column => column.name === 'updated_at')?.name
      || table.primaryKeys[0]
    if (orderColumn) query = query.order(orderColumn, { ascending: false })
    const offset = (page - 1) * limit
    const { data, error, count } = await query.range(offset, offset + limit - 1)
    if (error) throw error
    return Response.json({ ok: true, rows: data || [], count: count || 0, page, limit, table })
  } catch (error) {
    return Response.json({ ok: false, error: error instanceof Error ? error.message : 'Lettura dati non riuscita.' }, { status: 500 })
  }
}

export async function PATCH(request: Request) {
  const auth = await authenticateAdmin(request)
  if ('error' in auth) return auth.error

  try {
    const body = await request.json().catch(() => null)
    if (body?.confirmation !== 'SALVA') return Response.json({ ok: false, error: 'Conferma non valida.' }, { status: 400 })
    const table = await requireAdminTable(String(body?.table || ''))
    if (!table.canUpdate || table.primaryKeys.length === 0) {
      return Response.json({ ok: false, error: 'Questa tabella non supporta modifiche sicure.' }, { status: 400 })
    }
    const primaryKey = body?.primaryKey && typeof body.primaryKey === 'object' ? body.primaryKey as Record<string, unknown> : {}
    const inputChanges = body?.changes && typeof body.changes === 'object' ? body.changes as Record<string, unknown> : {}
    const allowedColumns = new Set(table.columns.filter(column => !column.primaryKey).map(column => column.name))
    const changes = Object.fromEntries(Object.entries(inputChanges).filter(([key]) => allowedColumns.has(key)))
    if (Object.keys(changes).length === 0) return Response.json({ ok: false, error: 'Nessuna modifica valida.' }, { status: 400 })

    let query = auth.client.from(table.name).update(changes)
    for (const key of table.primaryKeys) {
      if (!(key in primaryKey)) throw new Error(`Chiave primaria mancante: ${key}`)
      const value = primaryKey[key]
      query = value === null ? query.is(key, null) : query.eq(key, value as string | number | boolean)
    }
    const { data, error } = await query.select('*')
    if (error) throw error
    if (!data?.length) throw new Error('Riga non trovata o non modificabile')
    return Response.json({ ok: true, row: data[0], updated: data.length })
  } catch (error) {
    return Response.json({ ok: false, error: error instanceof Error ? error.message : 'Salvataggio non riuscito.' }, { status: 500 })
  }
}

export async function DELETE(request: Request) {
  const auth = await authenticateAdmin(request)
  if ('error' in auth) return auth.error

  try {
    const body = await request.json().catch(() => null)
    if (body?.source === 'r2') {
      const key = String(body?.key || '')
      if (!key || body?.confirmation !== key) return Response.json({ ok: false, error: 'Conferma file non valida.' }, { status: 400 })
      await deleteR2Object(key)
      return Response.json({ ok: true, deleted: key })
    }

    const table = await requireAdminTable(String(body?.table || ''))
    if (!table.canDelete || table.primaryKeys.length === 0) {
      return Response.json({ ok: false, error: 'Questa tabella non supporta eliminazioni sicure.' }, { status: 400 })
    }
    if (body?.confirmation !== table.name) return Response.json({ ok: false, error: 'Conferma tabella non valida.' }, { status: 400 })
    const primaryKey = body?.primaryKey && typeof body.primaryKey === 'object' ? body.primaryKey as Record<string, unknown> : {}
    let query = auth.client.from(table.name).delete({ count: 'exact' })
    for (const key of table.primaryKeys) {
      if (!(key in primaryKey)) throw new Error(`Chiave primaria mancante: ${key}`)
      const value = primaryKey[key]
      query = value === null ? query.is(key, null) : query.eq(key, value as string | number | boolean)
    }
    const { error, count } = await query
    if (error) throw error
    return Response.json({ ok: true, deleted: count || 0 })
  } catch (error) {
    return Response.json({ ok: false, error: error instanceof Error ? error.message : 'Eliminazione non riuscita.' }, { status: 500 })
  }
}
