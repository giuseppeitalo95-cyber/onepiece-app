import { createHash } from 'node:crypto'
import { isAdminAccount } from '@/lib/admin'
import { clearCardCache } from '@/lib/cardData'
import { refreshCatalogSyncState } from '@/lib/cardCatalogSync'
import { mirrorCardImage } from '@/lib/r2Storage'
import { requireServiceClient } from '@/lib/serverSupabase'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

type CatalogRow = {
  variant_id: string
  card_id: string
  base_card_id: string
  name: string
  rarity: string | null
  card_color: string | null
  card_type: string | null
  card_cost: number | null
  card_power: number | null
  card_counter: number | null
  life: number | null
  attribute: string | null
  card_text: string | null
  set_name: string | null
  sub_types: string | null
  market_price: number | null
  inventory_price: number | null
  source: string | null
  raw_data: Record<string, unknown> | null
  source_image_url: string | null
  r2_image_url: string | null
  r2_storage_key: string | null
  image_bytes: number | null
  cardmarket_product_id: number | null
  cardmarket_url: string | null
  manual_price_override: number | null
  manual_price_updated_at: string | null
  is_manual: boolean | null
}

type PriceRow = {
  product_id: number
  card_id: string
  product_name: string
  clean_name: string | null
  category_id: number | null
  expansion_id: number | null
  metacard_id: number | null
  variant_rank: number
  price_low: number | null
  price_trend: number | null
  price_avg: number | null
  price_avg_1: number | null
  price_avg_7: number | null
  price_avg_30: number | null
  product_date_added: string | null
  synced_at: string
}

const CATALOG_FIELDS = 'variant_id,card_id,base_card_id,name,rarity,card_color,card_type,card_cost,card_power,card_counter,life,attribute,card_text,set_name,sub_types,market_price,inventory_price,source,raw_data,source_image_url,r2_image_url,r2_storage_key,image_bytes,cardmarket_product_id,cardmarket_url,manual_price_override,manual_price_updated_at,is_manual'

// Cardmarket uses descriptive slugs in product URLs but short expansion
// abbreviations in its image archive.
const CARDMARKET_IMAGE_FOLDER_ALIASES: Record<string, string> = {
  'unnumbered-promos': 'UP',
  'judge-promos': 'JDG',
  'special-tournament-promos': 'STP',
  'promos': 'P',
  'reprints': 'R',
  'one-piece-products': 'OPPR',
  'premium-bandai-products': 'PB-XX',
  'mini-promo-cards': 'MINI',
  'demo-decks': 'DEMO',
}

const CARDMARKET_EXPANSION_ALIASES: Record<string, number> = {
  'promos': 5230,
  'promos-japanese': 5511,
}

const getAdmin = async (request: Request) => {
  const client = requireServiceClient()
  const token = (request.headers.get('authorization') || '').replace(/^Bearer\s+/i, '')
  if (!token) return null

  const { data: { user }, error } = await client.auth.getUser(token)
  if (error || !user) return null
  const { data: profile } = await client.from('profiles').select('username').eq('id', user.id).maybeSingle()
  return isAdminAccount(user, profile) ? user : null
}

const normalizeBaseCode = (value: unknown) => {
  const match = String(value || '').trim().toUpperCase().match(/((?:OP|ST|EB|PRB|SP|EX|CP)\d{2}-\d{3}|P-\d{3}|DON-\d{3}|CM-\d+)/i)
  return match?.[1]?.toUpperCase() || ''
}

const cleanProductName = (value: string) => value
  .replace(/\s*\(((?:OP|ST|EB|PRB|SP|EX|CP)\d{2}-\d{3}|P-\d{3}|DON-\d{3}|CM-\d+)\)\s*$/i, '')
  .trim()

const compactProductName = (value: unknown) => String(value || '')
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, '')

const nullableText = (value: unknown, max = 4000) => {
  const text = String(value ?? '').trim()
  return text ? text.slice(0, max) : null
}

const nullableNumber = (value: unknown) => {
  if (value == null || value === '') return null
  const number = Number(value)
  return Number.isFinite(number) ? number : null
}

const priceValue = (row: PriceRow) =>
  row.price_trend ?? row.price_avg_7 ?? row.price_avg_30 ?? row.price_avg ?? row.price_low ?? null

const buildPriceCandidates = async (priceRows: PriceRow[], folders: string[], preferredVersion?: number) => {
  const imageUrls = await Promise.all(priceRows.map(row => probeImage(row, folders)))
  const imageReadyRows = priceRows
    .map((row, index) => ({ row, imageUrl: imageUrls[index] }))
    .filter(item => item.imageUrl)
    .sort((left, right) => {
      const leftDate = new Date(left.row.product_date_added || 0).getTime()
      const rightDate = new Date(right.row.product_date_added || 0).getTime()
      return leftDate - rightDate || left.row.product_id - right.row.product_id
    })

  const urlVersionByProduct = new Map<number, number>()
  imageReadyRows.forEach((item, index) => urlVersionByProduct.set(item.row.product_id, index + 1))

  return priceRows.map((row, index) => ({
    product_id: row.product_id,
    product_name: row.product_name,
    clean_name: row.clean_name,
    expansion_id: row.expansion_id,
    metacard_id: row.metacard_id,
    variant_rank: row.variant_rank,
    url_version: urlVersionByProduct.get(row.product_id) || null,
    price: priceValue(row),
    price_low: row.price_low,
    price_trend: row.price_trend,
    price_avg_1: row.price_avg_1,
    price_avg_7: row.price_avg_7,
    price_avg_30: row.price_avg_30,
    synced_at: row.synced_at,
    image_url: imageUrls[index],
    product_url: `https://www.cardmarket.com/en/OnePiece/Products?idProduct=${row.product_id}`,
  })).sort((left, right) => {
    if (preferredVersion != null) {
      const leftExact = left.url_version === preferredVersion ? 1 : 0
      const rightExact = right.url_version === preferredVersion ? 1 : 0
      if (rightExact !== leftExact) return rightExact - leftExact
      const leftRank = left.variant_rank === preferredVersion - 1 ? 1 : 0
      const rightRank = right.variant_rank === preferredVersion - 1 ? 1 : 0
      if (rightRank !== leftRank) return rightRank - leftRank
    }
    return Number(Boolean(right.image_url)) - Number(Boolean(left.image_url)) || left.product_id - right.product_id
  })
}

const parseCardmarketUrl = (value: unknown) => {
  let url: URL
  try {
    url = new URL(String(value || '').trim())
  } catch {
    throw new Error('Incolla un link Cardmarket valido.')
  }

  const hostname = url.hostname.toLowerCase().replace(/^www\./, '')
  if (hostname !== 'cardmarket.com') throw new Error('Il link deve appartenere a cardmarket.com.')

  const parts = url.pathname.split('/').filter(Boolean).map(part => decodeURIComponent(part))
  const gameIndex = parts.findIndex(part => part.toLowerCase() === 'onepiece')
  const singlesIndex = parts.findIndex(part => part.toLowerCase() === 'singles')
  if (gameIndex < 0 || singlesIndex < 0 || !parts[singlesIndex + 1] || !parts[singlesIndex + 2]) {
    throw new Error('Usa il link della pagina di una singola carta One Piece.')
  }

  const setFolder = parts[singlesIndex + 1]
  const productSlug = parts[singlesIndex + 2]
  const cardCode = normalizeBaseCode(productSlug)
  const version = Math.max(1, Number(productSlug.match(/-V(\d+)$/i)?.[1] || 1))
  const productNameSlug = productSlug.replace(/-V\d+$/i, '')

  return {
    normalizedUrl: `https://www.cardmarket.com/en/OnePiece/Products/Singles/${encodeURIComponent(setFolder)}/${encodeURIComponent(productSlug)}`,
    setFolder,
    productSlug,
    productNameSlug,
    cardCode,
    version,
  }
}

const probeImage = async (row: PriceRow, folders: string[]) => {
  if (!row.category_id) return null

  for (const folder of folders) {
    if (!folder || !/^[a-z0-9-]+$/i.test(folder)) continue
    const imageUrl = `https://product-images.s3.cardmarket.com/${row.category_id}/${folder}/${row.product_id}/${row.product_id}.jpg`
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 5000)
    try {
      const response = await fetch(imageUrl, {
        headers: {
          'User-Agent': 'OnePieceVault/1.0',
          Referer: 'https://www.cardmarket.com/',
          Range: 'bytes=0-2047',
        },
        signal: controller.signal,
        cache: 'no-store',
      })
      const contentType = response.headers.get('content-type') || ''
      await response.body?.cancel().catch(() => undefined)
      // Cardmarket's S3 currently returns the literal multer metadata value
      // instead of image/jpeg, so the HTTP status is the reliable signal here.
      if (response.ok && (contentType.startsWith('image/') || contentType === 'multerS3.AUTO_CONTENT_TYPE')) {
        return imageUrl
      }
    } catch {
      // Il candidato resta selezionabile anche se Cardmarket non espone l'immagine.
    } finally {
      clearTimeout(timeout)
    }
  }

  return null
}

const variantIndex = (value: string) => {
  if (!/_p\d+$/i.test(value)) return 0
  return Number(value.match(/_p(\d+)$/i)?.[1] || 0) + 1
}

const nextFreeVariantId = (baseCode: string, existing: CatalogRow[], preferredVersion: number) => {
  const used = new Set(existing.map(row => row.variant_id.toUpperCase()))
  const preferred = preferredVersion <= 1 ? baseCode : `${baseCode}_p${preferredVersion - 1}`
  if (!used.has(preferred.toUpperCase())) return preferred

  let suffix = 1
  while (used.has(`${baseCode}_P${suffix}`)) suffix += 1
  return `${baseCode}_p${suffix}`
}

const analyze = async (body: Record<string, unknown>) => {
  const client = requireServiceClient()
  const parsed = parseCardmarketUrl(body?.url)

  let resolvedCardCode = parsed.cardCode
  let resolvedPriceRows: PriceRow[] | null = null

  if (!resolvedCardCode) {
    const expansionId = CARDMARKET_EXPANSION_ALIASES[parsed.setFolder.toLowerCase()]
    if (!expansionId) {
      throw new Error('Questa promo non mostra un codice. La sua sezione Cardmarket non e ancora supportata automaticamente.')
    }

    const { data, error } = await client
      .from('cardmarket_prices')
      .select('*')
      .eq('expansion_id', expansionId)
      .like('card_id', 'CM-%')
      .order('product_date_added', { ascending: true, nullsFirst: false })
      .order('product_id', { ascending: true })
      .limit(1000)
    if (error) throw new Error(error.message)

    const wantedName = compactProductName(parsed.productNameSlug)
    const matchingRows = ((data || []) as PriceRow[])
      .filter(row => compactProductName(row.clean_name || row.product_name) === wantedName)
    const metacardId = matchingRows[0]?.metacard_id
    resolvedPriceRows = metacardId
      ? matchingRows.filter(row => row.metacard_id === metacardId)
      : []
    resolvedCardCode = resolvedPriceRows[0]?.card_id || ''

    if (!resolvedCardCode || resolvedPriceRows.length === 0) {
      throw new Error('Promo senza numero non ancora sincronizzata. Aggiorna i prezzi Cardmarket dalla pagina Admin e riprova.')
    }
  }

  const [catalogResult, pricesResult] = await Promise.all([
    client
      .from('card_catalog')
      .select(CATALOG_FIELDS)
      .or(`base_card_id.eq.${resolvedCardCode},variant_id.eq.${resolvedCardCode},variant_id.like.${resolvedCardCode}_%`)
      .order('variant_id', { ascending: true }),
    client
      .from('cardmarket_prices')
      .select('*')
      .eq('card_id', resolvedCardCode)
      .order('product_date_added', { ascending: true, nullsFirst: false })
      .order('product_id', { ascending: true })
      .limit(40),
  ])

  if (catalogResult.error) {
    if (/cardmarket_product_id|is_manual|cardmarket_url/i.test(catalogResult.error.message)) {
      throw new Error('Schema importatore non installato: esegui manual_card_import.sql su Supabase.')
    }
    throw new Error(catalogResult.error.message)
  }
  if (pricesResult.error) throw new Error(pricesResult.error.message)

  const existing = (catalogResult.data || []) as CatalogRow[]
  const priceRows = resolvedPriceRows || (pricesResult.data || []) as PriceRow[]
  if (priceRows.length === 0) {
    throw new Error('Cardmarket non ha ancora questo codice nell export sincronizzato. Aggiorna prima i prezzi e riprova.')
  }

  const prefix = resolvedCardCode.split('-')[0]
  const folderAlias = CARDMARKET_IMAGE_FOLDER_ALIASES[parsed.setFolder.toLowerCase()]
  const folders = [...new Set([
    folderAlias,
    parsed.setFolder,
    parsed.setFolder.replace(/[^a-z0-9]/gi, ''),
    prefix,
  ].filter((folder): folder is string => Boolean(folder)))]
  const candidates = await buildPriceCandidates(priceRows, folders, parsed.version)

  const selected = candidates[0]
  const orderedExisting = [...existing].sort((a, b) => variantIndex(a.variant_id) - variantIndex(b.variant_id))
  const reference = orderedExisting[Math.min(parsed.version - 1, Math.max(orderedExisting.length - 1, 0))] || orderedExisting[0] || null
  const proposedVariantId = nextFreeVariantId(resolvedCardCode, existing, parsed.version)

  return {
    ok: true,
    parsed: {
      card_code: resolvedCardCode,
      version: parsed.version,
      set_folder: parsed.setFolder,
      cardmarket_url: parsed.normalizedUrl,
    },
    selected_product_id: selected.product_id,
    candidates,
    duplicates: existing.map(row => ({
      variant_id: row.variant_id,
      name: row.name,
      rarity: row.rarity,
      image_url: row.r2_image_url || row.source_image_url,
      cardmarket_product_id: row.cardmarket_product_id,
      is_manual: Boolean(row.is_manual),
    })),
    card: {
      variant_id: proposedVariantId,
      base_card_id: resolvedCardCode,
      name: cleanProductName(selected.product_name),
      rarity: reference?.rarity || '',
      card_color: reference?.card_color || '',
      card_type: reference?.card_type || '',
      card_cost: reference?.card_cost ?? '',
      card_power: reference?.card_power ?? '',
      card_counter: reference?.card_counter ?? '',
      life: reference?.life ?? '',
      attribute: reference?.attribute || '',
      card_text: reference?.card_text || '',
      set_name: reference?.set_name || parsed.setFolder,
      sub_types: reference?.sub_types || '',
      source_image_url: selected.image_url || reference?.r2_image_url || reference?.source_image_url || '',
      variant_label: parsed.version > 1 ? `V.${parsed.version}` : 'Base / V.1',
      cardmarket_product_id: selected.product_id,
      cardmarket_url: parsed.normalizedUrl,
      market_price: selected.price,
      manual_price_enabled: false,
      manual_price_override: '',
      preview_image_url: selected.image_url || reference?.r2_image_url || reference?.source_image_url || '',
    },
  }
}

const save = async (body: Record<string, unknown>, adminId: string) => {
  const client = requireServiceClient()
  const input = body.card && typeof body.card === 'object'
    ? body.card as Record<string, unknown>
    : {}
  const baseCode = normalizeBaseCode(input.base_card_id || input.variant_id)
  const requestedVariantId = String(input.variant_id || '').trim()
  const productId = Number(input.cardmarket_product_id)
  const force = body?.force === true
  const manualPriceEnabled = input.manual_price_enabled === true
  const manualPrice = manualPriceEnabled ? nullableNumber(input.manual_price_override) : null

  if (!baseCode || !requestedVariantId || !/^[A-Z0-9_-]{5,40}$/i.test(requestedVariantId)) {
    throw new Error('Codice carta o ID variante non valido.')
  }
  if (!Number.isInteger(productId) || productId <= 0) throw new Error('Seleziona il prodotto Cardmarket esatto.')
  if (!nullableText(input.name, 180)) throw new Error('Il nome della carta e obbligatorio.')
  if (!nullableText(input.source_image_url, 2000)) throw new Error('Inserisci o seleziona l immagine della carta.')
  if (manualPriceEnabled && (manualPrice == null || manualPrice < 0)) throw new Error('Inserisci un prezzo manuale valido.')

  const [productResult, duplicateResult] = await Promise.all([
    client.from('cardmarket_prices').select('*').eq('product_id', productId).maybeSingle(),
    client
      .from('card_catalog')
      .select(CATALOG_FIELDS)
      .or(`base_card_id.eq.${baseCode},variant_id.eq.${baseCode},variant_id.like.${baseCode}_%`)
      .order('variant_id'),
  ])
  if (productResult.error || !productResult.data) throw new Error('Prodotto Cardmarket non trovato nel database prezzi.')
  if (duplicateResult.error) throw new Error(duplicateResult.error.message)

  const product = productResult.data as PriceRow
  if (product.card_id !== baseCode) throw new Error('Il prodotto Cardmarket non corrisponde al codice della carta.')
  const duplicates = (duplicateResult.data || []) as CatalogRow[]
  if (duplicates.length > 0 && !force) {
    return Response.json({
      ok: false,
      duplicate: true,
      error: 'Carta o variante con lo stesso codice gia presente.',
      duplicates,
    }, { status: 409 })
  }

  let variantId = requestedVariantId
  if (duplicates.some(row => row.variant_id.toUpperCase() === variantId.toUpperCase())) {
    variantId = nextFreeVariantId(baseCode, duplicates, Math.max(2, duplicates.length + 1))
  }

  const sourceImageUrl = String(input.source_image_url).trim()
  const mirrored = await mirrorCardImage({ sourceUrl: sourceImageUrl, variantId })
  const now = new Date().toISOString()
  const row = {
    variant_id: variantId,
    card_id: variantId,
    base_card_id: baseCode,
    name: String(input.name).trim().slice(0, 180),
    rarity: nullableText(input.rarity, 80),
    card_color: nullableText(input.card_color, 80),
    card_type: nullableText(input.card_type, 80),
    card_cost: nullableNumber(input.card_cost),
    card_power: nullableNumber(input.card_power),
    card_counter: nullableNumber(input.card_counter),
    life: nullableNumber(input.life),
    attribute: nullableText(input.attribute, 200),
    card_text: nullableText(input.card_text, 5000) || '',
    set_name: nullableText(input.set_name, 240) || '',
    sub_types: nullableText(input.sub_types, 500) || '',
    market_price: manualPrice ?? priceValue(product),
    inventory_price: null,
    source: 'manual_admin',
    source_endpoint: nullableText(input.cardmarket_url, 2000),
    source_image_url: sourceImageUrl,
    r2_image_url: mirrored.publicUrl,
    r2_storage_key: mirrored.key,
    image_status: 'ready',
    image_bytes: mirrored.bytes,
    image_error: null,
    image_synced_at: now,
    cardmarket_product_id: productId,
    cardmarket_url: nullableText(input.cardmarket_url, 2000),
    manual_price_override: manualPrice,
    manual_price_updated_at: manualPrice != null ? now : null,
    is_manual: true,
    manual_created_by: adminId,
    raw_data: {
      import_type: 'cardmarket_admin',
      variant_label: nullableText(input.variant_label, 120),
      cardmarket_product_id: productId,
      cardmarket_product_name: product.product_name,
      imported_by: adminId,
      imported_at: now,
    },
    source_updated_at: product.synced_at,
    updated_at: now,
  }

  const { error: insertError } = await client.from('card_catalog').insert(row)
  if (insertError) throw new Error(insertError.message)

  const sourceKey = createHash('sha1').update(`manual_admin|${variantId}|${productId}`).digest('hex')
  await client.from('card_catalog_sources').upsert({
    source_key: sourceKey,
    source: 'manual_admin',
    source_endpoint: row.cardmarket_url,
    source_record_id: String(productId),
    variant_id: variantId,
    raw_data: row.raw_data,
    synced_at: now,
  }, { onConflict: 'source_key' })

  clearCardCache()
  await refreshCatalogSyncState({ last_error: null })

  return Response.json({
    ok: true,
    card: {
      variant_id: variantId,
      base_card_id: baseCode,
      name: row.name,
      image_url: mirrored.publicUrl,
      cardmarket_product_id: productId,
      market_price: row.market_price,
    },
  })
}

const loadCard = async (body: Record<string, unknown>) => {
  const client = requireServiceClient()
  const variantId = String(body.variant_id || '').trim()
  if (!variantId) throw new Error('Seleziona una carta da modificare.')

  const { data, error } = await client
    .from('card_catalog')
    .select(CATALOG_FIELDS)
    .eq('variant_id', variantId)
    .maybeSingle()
  if (error) throw new Error(error.message)
  if (!data) throw new Error('Carta non trovata nel catalogo OPV.')

  const row = data as CatalogRow
  const { data: priceRowsData, error: priceRowsError } = await client
    .from('cardmarket_prices')
    .select('*')
    .eq('card_id', row.base_card_id)
    .order('product_date_added', { ascending: true, nullsFirst: false })
    .order('product_id', { ascending: true })
    .limit(40)
  if (priceRowsError) throw new Error(priceRowsError.message)

  const prefix = row.base_card_id.split('-')[0]
  let cardmarketFolder = ''
  try {
    cardmarketFolder = row.cardmarket_url ? parseCardmarketUrl(row.cardmarket_url).setFolder : ''
  } catch {
    cardmarketFolder = ''
  }
  const folders = [...new Set([
    CARDMARKET_IMAGE_FOLDER_ALIASES[cardmarketFolder.toLowerCase()],
    cardmarketFolder,
    cardmarketFolder.replace(/[^a-z0-9]/gi, ''),
    prefix,
  ].filter((folder): folder is string => Boolean(folder)))]
  const candidates = await buildPriceCandidates((priceRowsData || []) as PriceRow[], folders)
  let automaticPrice = row.market_price
  if (row.cardmarket_product_id) {
    const { data: price } = await client
      .from('cardmarket_prices')
      .select('*')
      .eq('product_id', row.cardmarket_product_id)
      .maybeSingle()
    if (price) automaticPrice = priceValue(price as PriceRow)
  }

  return {
    ok: true,
    candidates,
    card: {
      variant_id: row.variant_id,
      base_card_id: row.base_card_id,
      name: row.name,
      rarity: row.rarity || '',
      card_color: row.card_color || '',
      card_type: row.card_type || '',
      card_cost: row.card_cost ?? '',
      card_power: row.card_power ?? '',
      card_counter: row.card_counter ?? '',
      life: row.life ?? '',
      attribute: row.attribute || '',
      card_text: row.card_text || '',
      set_name: row.set_name || '',
      sub_types: row.sub_types || '',
      source_image_url: row.source_image_url || row.r2_image_url || '',
      preview_image_url: row.r2_image_url || row.source_image_url || '',
      variant_label: String(row.raw_data?.variant_label || ''),
      cardmarket_product_id: row.cardmarket_product_id || '',
      cardmarket_url: row.cardmarket_url || '',
      market_price: automaticPrice,
      manual_price_enabled: row.manual_price_override != null,
      manual_price_override: row.manual_price_override ?? '',
    },
  }
}

const updateCard = async (body: Record<string, unknown>, adminId: string) => {
  const client = requireServiceClient()
  const input = body.card && typeof body.card === 'object'
    ? body.card as Record<string, unknown>
    : {}
  const variantId = String(input.variant_id || '').trim()
  const baseCode = normalizeBaseCode(input.base_card_id || variantId)
  if (!variantId || !baseCode) throw new Error('Carta o codice non valido.')
  if (!nullableText(input.name, 180)) throw new Error('Il nome della carta e obbligatorio.')
  if (!nullableText(input.source_image_url, 2000)) throw new Error('Inserisci l immagine della carta.')

  const { data, error } = await client
    .from('card_catalog')
    .select(CATALOG_FIELDS)
    .eq('variant_id', variantId)
    .maybeSingle()
  if (error) throw new Error(error.message)
  if (!data) throw new Error('Carta non trovata nel catalogo OPV.')
  const existing = data as CatalogRow

  const manualPriceEnabled = input.manual_price_enabled === true
  const manualPrice = manualPriceEnabled ? nullableNumber(input.manual_price_override) : null
  if (manualPriceEnabled && (manualPrice == null || manualPrice < 0)) {
    throw new Error('Inserisci un prezzo manuale valido.')
  }

  const productId = nullableNumber(input.cardmarket_product_id)
  let automaticPrice = existing.market_price
  if (productId && Number.isInteger(productId)) {
    const { data: price } = await client
      .from('cardmarket_prices')
      .select('*')
      .eq('product_id', productId)
      .maybeSingle()
    if (price) automaticPrice = priceValue(price as PriceRow)
  }

  const sourceImageUrl = String(input.source_image_url).trim()
  const imageChanged = sourceImageUrl !== existing.source_image_url && sourceImageUrl !== existing.r2_image_url
  const mirrored = imageChanged
    ? await mirrorCardImage({ sourceUrl: sourceImageUrl, variantId })
    : {
        publicUrl: existing.r2_image_url || sourceImageUrl,
        key: existing.r2_storage_key,
        bytes: existing.image_bytes,
      }
  const now = new Date().toISOString()
  const update = {
    base_card_id: baseCode,
    name: String(input.name).trim().slice(0, 180),
    rarity: nullableText(input.rarity, 80),
    card_color: nullableText(input.card_color, 80),
    card_type: nullableText(input.card_type, 80),
    card_cost: nullableNumber(input.card_cost),
    card_power: nullableNumber(input.card_power),
    card_counter: nullableNumber(input.card_counter),
    life: nullableNumber(input.life),
    attribute: nullableText(input.attribute, 200),
    card_text: nullableText(input.card_text, 5000) || '',
    set_name: nullableText(input.set_name, 240) || '',
    sub_types: nullableText(input.sub_types, 500) || '',
    market_price: manualPrice ?? automaticPrice,
    source_image_url: sourceImageUrl,
    r2_image_url: mirrored.publicUrl,
    r2_storage_key: mirrored.key,
    image_status: 'ready',
    image_bytes: mirrored.bytes,
    image_error: null,
    image_synced_at: imageChanged ? now : undefined,
    cardmarket_product_id: productId && Number.isInteger(productId) ? productId : null,
    cardmarket_url: nullableText(input.cardmarket_url, 2000),
    manual_price_override: manualPrice,
    manual_price_updated_at: manualPrice != null ? now : null,
    is_manual: true,
    manual_created_by: adminId,
    raw_data: {
      ...(existing.raw_data || {}),
      variant_label: nullableText(input.variant_label, 120),
      last_admin_edit_by: adminId,
      last_admin_edit_at: now,
    },
    updated_at: now,
  }

  const { error: updateError } = await client
    .from('card_catalog')
    .update(update)
    .eq('variant_id', variantId)
  if (updateError) throw new Error(updateError.message)

  // Le copie gia presenti nelle collezioni ricevono subito i dati corretti.
  await client.from('user_cards').update({
    name: update.name,
    image_url: mirrored.publicUrl,
    rarity: update.rarity,
    card_color: update.card_color,
    card_type: update.card_type,
    card_cost: update.card_cost,
    card_power: update.card_power,
  }).eq('card_id', variantId)

  clearCardCache()
  await refreshCatalogSyncState({ last_error: null })

  return Response.json({
    ok: true,
    card: {
      variant_id: variantId,
      name: update.name,
      image_url: mirrored.publicUrl,
      market_price: update.market_price,
      manual_price_override: manualPrice,
    },
  })
}

export async function POST(request: Request) {
  try {
    const admin = await getAdmin(request)
    if (!admin) return Response.json({ ok: false, error: 'Accesso Admin richiesto.' }, { status: 403 })

    const body = await request.json().catch(() => null) as Record<string, unknown> | null
    if (body?.action === 'analyze') return Response.json(await analyze(body))
    if (body?.action === 'save') return await save(body, admin.id)
    if (body?.action === 'load') return Response.json(await loadCard(body))
    if (body?.action === 'update') return await updateCard(body, admin.id)
    return Response.json({ ok: false, error: 'Azione non valida.' }, { status: 400 })
  } catch (error) {
    console.error('Manual Cardmarket import error:', error)
    return Response.json({
      ok: false,
      error: error instanceof Error ? error.message : 'Importazione non riuscita.',
    }, { status: 500 })
  }
}
