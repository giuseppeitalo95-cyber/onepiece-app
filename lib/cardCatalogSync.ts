import { createHash } from 'node:crypto'
import { clearCardCache, fetchSourceCards, normalizeSourceCard, type RawCard } from '@/lib/cardData'
import { mirrorCardImage, getR2Usage } from '@/lib/r2Storage'
import { requireServiceClient } from '@/lib/serverSupabase'

const UPSERT_BATCH_SIZE = 250

const safeDate = (value: unknown) => {
  if (!value) return null
  const date = new Date(String(value))
  return Number.isNaN(date.getTime()) ? null : date.toISOString()
}

const sourcePayload = (card: RawCard) => {
  const payload = { ...card }
  delete payload._opv_source
  delete payload._opv_source_endpoint
  delete payload._opv_source_index
  return payload
}

const stableSourceKey = (raw: RawCard, normalized: RawCard) => {
  const source = String(raw._opv_source || normalized.source || 'source')
  const endpoint = String(raw._opv_source_endpoint || normalized.source_endpoint || '')
  const recordId = String(raw.card_image_id || raw.card_id || raw.card_set_id || raw.id || normalized.card_id)
  const name = String(raw.card_name || raw.name || normalized.name)
  return createHash('sha1').update(`${source}|${endpoint}|${recordId}|${name}`).digest('hex')
}

const canonicalRow = (raw: RawCard, normalized: RawCard) => {
  const variantId = String(normalized.card_id)
  const generatedImageUrl = /^((?:OP|ST|EB|PRB|SP|EX|CP)\d{2}|P|DON)-\d{3}(?:_p\d+)?$/i.test(variantId)
    ? `https://en.onepiece-cardgame.com/images/cardlist/card/${variantId}.png`
    : null

  return {
    variant_id: variantId,
    card_id: variantId,
    base_card_id: String(normalized.base_card_id || normalized.card_id).replace(/_p\d+$/i, ''),
    name: String(normalized.name || 'Carta'),
    rarity: normalized.rarity || null,
    card_color: normalized.card_color || null,
    card_type: normalized.card_type || null,
    card_cost: normalized.card_cost,
    card_power: normalized.card_power,
    card_counter: normalized.card_counter,
    life: normalized.life,
    attribute: normalized.attribute || '',
    card_text: normalized.card_text || '',
    set_name: normalized.set_name || '',
    sub_types: normalized.sub_types || '',
    market_price: normalized.market_price,
    inventory_price: normalized.inventory_price,
    source: normalized.source || 'source',
    source_endpoint: normalized.source_endpoint || null,
    source_image_url: normalized.image_url || generatedImageUrl,
    raw_data: sourcePayload(raw),
    source_updated_at: safeDate(normalized.source_updated_at),
    updated_at: new Date().toISOString(),
  }
}

const upsertBatches = async (table: string, rows: Record<string, unknown>[], conflict: string) => {
  const client = requireServiceClient()
  for (let index = 0; index < rows.length; index += UPSERT_BATCH_SIZE) {
    const batch = rows.slice(index, index + UPSERT_BATCH_SIZE)
    const { error } = await client.from(table).upsert(batch, { onConflict: conflict })
    if (error) throw new Error(`${table}: ${error.message}`)
  }
}

export const readCatalogSyncState = async () => {
  const client = requireServiceClient()
  const { data, error } = await client
    .from('card_catalog_sync_state')
    .select('*')
    .eq('id', 'catalog')
    .maybeSingle()
  if (error) throw new Error(error.message)
  return data
}

export const refreshCatalogSyncState = async (updates: Record<string, unknown> = {}) => {
  const client = requireServiceClient()
  const [catalog, sources, ready, failed, pending, usage] = await Promise.all([
    client.from('card_catalog').select('*', { count: 'exact', head: true }),
    client.from('card_catalog_sources').select('*', { count: 'exact', head: true }),
    client.from('card_catalog').select('*', { count: 'exact', head: true }).eq('image_status', 'ready'),
    client.from('card_catalog').select('*', { count: 'exact', head: true }).in('image_status', ['failed', 'blocked']),
    client.from('card_catalog').select('*', { count: 'exact', head: true }).in('image_status', ['pending', 'migrating']),
    getR2Usage().catch(() => ({ bytes: 0, objects: 0, expiresAt: 0 })),
  ])

  const state = {
    id: 'catalog',
    source_rows: sources.count || 0,
    catalog_rows: catalog.count || 0,
    image_ready: ready.count || 0,
    image_failed: failed.count || 0,
    image_pending: pending.count || 0,
    r2_bytes: usage.bytes,
    updated_at: new Date().toISOString(),
    ...updates,
  }
  const { error } = await client.from('card_catalog_sync_state').upsert(state, { onConflict: 'id' })
  if (error) throw new Error(error.message)
  return state
}

export const syncCardCatalog = async () => {
  const rawCards = await fetchSourceCards()
  if (rawCards.length === 0) throw new Error('Le fonti non hanno restituito carte')

  const sourceRows: Record<string, unknown>[] = []
  const canonical = new Map<string, { raw: RawCard; normalized: RawCard }>()
  const syncedAt = new Date().toISOString()

  for (const raw of rawCards) {
    const normalized = normalizeSourceCard(raw)
    const variantId = String(normalized.card_id || '').trim()
    if (!variantId) continue

    sourceRows.push({
      source_key: stableSourceKey(raw, normalized),
      source: normalized.source || 'source',
      source_endpoint: normalized.source_endpoint || null,
      source_record_id: String(raw.card_image_id || raw.card_id || raw.card_set_id || raw.id || variantId),
      variant_id: variantId,
      raw_data: sourcePayload(raw),
      synced_at: syncedAt,
    })

    const existing = canonical.get(variantId)
    if (!existing || (normalized.source === 'official' && existing.normalized.source !== 'official')) {
      canonical.set(variantId, {
        raw,
        normalized: existing ? {
          ...normalized,
          image_url: normalized.image_url || existing.normalized.image_url,
          card_image: normalized.card_image || existing.normalized.card_image,
          market_price: normalized.market_price ?? existing.normalized.market_price,
          inventory_price: normalized.inventory_price ?? existing.normalized.inventory_price,
        } : normalized,
      })
    } else if (existing.normalized.source === 'official') {
      existing.normalized.market_price ??= normalized.market_price
      existing.normalized.inventory_price ??= normalized.inventory_price
    }
  }

  const catalogRows = [...canonical.values()].map(({ raw, normalized }) => canonicalRow(raw, normalized))
  await upsertBatches('card_catalog_sources', sourceRows, 'source_key')
  await upsertBatches('card_catalog', catalogRows, 'variant_id')
  clearCardCache()

  const state = await refreshCatalogSyncState({
    last_catalog_sync_at: syncedAt,
    last_error: null,
  })

  return {
    ok: true,
    fetched: rawCards.length,
    sourceRows: sourceRows.length,
    catalogRows: catalogRows.length,
    syncedAt,
    state,
  }
}

const migrateOneImage = async (row: RawCard) => {
  const client = requireServiceClient()
  const variantId = String(row.variant_id)
  const sourceUrl = String(row.source_image_url || '')
  if (!sourceUrl) return { variantId, status: 'skipped' as const }

  await client.from('card_catalog').update({ image_status: 'migrating', image_error: null }).eq('variant_id', variantId)

  try {
    const mirrored = await mirrorCardImage({ sourceUrl, variantId })
    const { error } = await client.from('card_catalog').update({
      r2_image_url: mirrored.publicUrl,
      r2_storage_key: mirrored.key,
      image_bytes: mirrored.bytes,
      image_status: 'ready',
      image_error: null,
      image_synced_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }).eq('variant_id', variantId)
    if (error) throw new Error(error.message)
    return { variantId, status: 'ready' as const, bytes: mirrored.bytes, created: mirrored.created }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Migrazione immagine fallita'
    const blocked = message.includes('Limite di sicurezza R2')
    await client.from('card_catalog').update({
      image_status: blocked ? 'blocked' : 'failed',
      image_error: message.slice(0, 500),
      updated_at: new Date().toISOString(),
    }).eq('variant_id', variantId)
    return { variantId, status: blocked ? 'blocked' as const : 'failed' as const, error: message }
  }
}

export const syncCatalogImages = async (requestedLimit = 40) => {
  const client = requireServiceClient()
  const limit = Math.max(1, Math.min(100, Math.floor(requestedLimit)))
  const { data, error } = await client
    .from('card_catalog')
    .select('variant_id,source_image_url,image_status')
    .is('r2_image_url', null)
    .not('source_image_url', 'is', null)
    .in('image_status', ['pending', 'migrating'])
    .order('updated_at', { ascending: true })
    .limit(limit)
  if (error) throw new Error(error.message)

  const rows = data || []
  const results: Awaited<ReturnType<typeof migrateOneImage>>[] = []
  const concurrency = 4
  for (let index = 0; index < rows.length; index += concurrency) {
    results.push(...await Promise.all(rows.slice(index, index + concurrency).map(migrateOneImage)))
    if (results.some(result => result.status === 'blocked')) break
  }

  clearCardCache()
  const syncedAt = new Date().toISOString()
  const errors = results.filter(result => result.status === 'failed' || result.status === 'blocked')
  const state = await refreshCatalogSyncState({
    last_image_sync_at: syncedAt,
    last_error: errors[0]?.error || null,
  })

  return {
    ok: errors.every(result => result.status !== 'blocked'),
    requested: limit,
    processed: results.length,
    ready: results.filter(result => result.status === 'ready').length,
    failed: results.filter(result => result.status === 'failed').length,
    blocked: results.filter(result => result.status === 'blocked').length,
    remaining: state.image_pending,
    syncedAt,
    state,
  }
}
