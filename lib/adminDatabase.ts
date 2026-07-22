const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://jxwgbzatdueefdiyxlns.supabase.co'
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY

export type AdminColumn = {
  name: string
  type: string
  format: string
  required: boolean
  primaryKey: boolean
  description: string
  defaultValue?: unknown
}

export type AdminTable = {
  name: string
  columns: AdminColumn[]
  primaryKeys: string[]
  canInsert: boolean
  canUpdate: boolean
  canDelete: boolean
}

type OpenApiProperty = {
  type?: string
  format?: string
  description?: string
  default?: unknown
}

type OpenApiDocument = {
  paths?: Record<string, Record<string, unknown>>
  definitions?: Record<string, {
    required?: string[]
    properties?: Record<string, OpenApiProperty>
  }>
}

let schemaCache: { expiresAt: number; tables: AdminTable[] } | null = null

export const getAdminTables = async (force = false) => {
  if (!force && schemaCache && schemaCache.expiresAt > Date.now()) return schemaCache.tables
  if (!SERVICE_ROLE_KEY) throw new Error('SUPABASE_SERVICE_ROLE_KEY non configurata')

  const response = await fetch(`${SUPABASE_URL}/rest/v1/`, {
    headers: {
      apikey: SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
      Accept: 'application/openapi+json',
    },
    cache: 'no-store',
  })
  if (!response.ok) throw new Error(`Schema Supabase non disponibile (${response.status})`)
  const schema = await response.json() as OpenApiDocument

  const tables = Object.keys(schema.paths || {})
    .filter(path => path.startsWith('/') && path.length > 1 && !path.startsWith('/rpc/'))
    .map(path => {
      const name = path.slice(1)
      const definition = schema.definitions?.[name]
      const required = new Set(definition?.required || [])
      const methods = schema.paths?.[path] || {}
      const columns = Object.entries(definition?.properties || {}).map(([columnName, property]) => ({
        name: columnName,
        type: property.type || 'json',
        format: property.format || (property.type === 'object' ? 'jsonb' : ''),
        required: required.has(columnName),
        primaryKey: Boolean(property.description?.includes('<pk/>')),
        description: String(property.description || '').replace(/\s*Note:\s*/i, '').replace(/<pk\/>/g, '').trim(),
        defaultValue: property.default,
      }))

      return {
        name,
        columns,
        primaryKeys: columns.filter(column => column.primaryKey).map(column => column.name),
        canInsert: Boolean(methods.post),
        canUpdate: Boolean(methods.patch),
        canDelete: Boolean(methods.delete),
      }
    })
    .filter(table => table.columns.length > 0)
    .sort((left, right) => left.name.localeCompare(right.name))

  schemaCache = { expiresAt: Date.now() + 5 * 60_000, tables }
  return tables
}

export const requireAdminTable = async (tableName: string) => {
  const table = (await getAdminTables()).find(item => item.name === tableName)
  if (!table) throw new Error('Tabella non consentita')
  return table
}
