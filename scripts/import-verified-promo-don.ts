import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3'
import { requireServiceClient } from '../lib/serverSupabase'
import { mirrorCardImage, getR2Config, getR2SafetyLimitBytes, getR2Usage } from '../lib/r2Storage'
import { rowMarketPrice } from '../lib/cardmarketPrices'
import { refreshCatalogSyncState } from '../lib/cardCatalogSync'
import { isPlausibleDonImage } from '../lib/donImageFingerprint'
import donReview from './data/don-cardmarket-2026-08-31.json'

// Reviewed against the English product images, not another printing sharing
// the code. Product IDs persist; prices are read from the daily price guide.
const promos = [
  { code: 'ST15-002', productId: 902489, folder: 'UP' },
  { code: 'OP14-027', productId: 902493, folder: 'UP' },
  { code: 'EB04-030', productId: 902495, folder: 'UP' },
  { code: 'OP12-049', productId: 902494, folder: 'UP' },
  { code: 'P-099', productId: 902492, folder: 'P' },
  { code: 'P-100', productId: 902491, folder: 'P' },
  { code: 'ST20-005', productId: 902487, folder: 'UP' },
]
const confirmed = process.argv.includes('--confirm')
const donImagePath = process.argv.find(value => value.startsWith('--don-image='))?.slice('--don-image='.length)
const client = requireServiceClient()
const now = new Date().toISOString()
const donId = 'don_dp12_02'
const donSource = 'https://en.onepiece-cardgame.com/onepiececg/bccard/en/product/2026/08/06/Gb9gC2rKQVBn7rAl/img_item04.webp'
const donPage = 'https://en.onepiece-cardgame.com/products/dp12.html'

async function main() {
  const [cardsResult, donsResult, pricesResult] = await Promise.all([
    client.from('card_catalog').select('*').in('base_card_id', promos.map(row => row.code)),
    client.from('card_catalog').select('*').or('card_type.eq.DON!!,rarity.eq.DON!!'),
    client.from('cardmarket_prices').select('*').in('product_id', [
      ...promos.map(row => row.productId), ...donReview.lessons.map(row => row.productId),
    ]),
  ])
  for (const result of [cardsResult, donsResult, pricesResult]) if (result.error) throw result.error
  const cards = cardsResult.data || []
  const dons = donsResult.data || []
  const prices = new Map((pricesResult.data || []).map(row => [Number(row.product_id), row]))
  const changes = []
  for (const lesson of donReview.lessons) {
    const card = dons.find(row => row.variant_id === lesson.variantId)
    const price = prices.get(lesson.productId)
    if (!card || card.name !== lesson.expectedName || card.source_image_url !== lesson.sourceImageUrl) {
      throw new Error(`${lesson.variantId}: identity changed since visual review; re-audit before applying.`)
    }
    if (!price || !/^don!!/i.test(price.product_name)) throw new Error(`Missing DON product ${lesson.productId}`)
    // Never replace the owner's manually selected product or fixed price.
    if (card.cardmarket_product_id || card.manual_price_override != null) continue
    changes.push({ card, lesson })
  }
  const imports = []
  for (const promo of promos) {
    const imageUrl = `https://product-images.s3.cardmarket.com/1621/${promo.folder}/${promo.productId}/${promo.productId}.jpg`
    const existing = cards.find(row => Number(row.cardmarket_product_id) === promo.productId || row.source_image_url === imageUrl)
    if (existing) continue
    const product = prices.get(promo.productId)
    if (!product || product.card_id !== promo.code) throw new Error(`Product identity mismatch: ${promo.code}`)
    const siblings = cards.filter(row => row.base_card_id === promo.code)
    const reference = siblings.find(row => row.variant_id === promo.code) || siblings[0]
    if (!reference) throw new Error(`Missing rules reference: ${promo.code}`)
    let suffix = 1
    while (siblings.some(row => row.variant_id.toLowerCase() === `${promo.code}_p${suffix}`.toLowerCase())) suffix++
    imports.push({ promo, imageUrl, reference, product, variantId: `${promo.code}_p${suffix}` })
  }
  const needsDon = !dons.some(row => row.variant_id === donId || row.source_image_url === donSource)
  const donImage = needsDon && donImagePath ? await readFile(donImagePath) : null
  if (donImage && !(await isPlausibleDonImage(donImage))) throw new Error('DON image must be the full portrait card.')
  if (donImage && createHash('sha256').update(donImage).digest('hex') !== 'c520bf3b3439daee4e44732fc26d2ac50d1c9157e17de134adee51da892081db') {
    throw new Error('This is not the reviewed DP12 attachment; inspect it before changing the manifest.')
  }
  if (confirmed && needsDon && !donImage) throw new Error('Pass --don-image=<reviewed attachment> to import DP12.')
  const report = {
    mode: confirmed ? 'apply' : 'dry-run',
    mappings: changes.length,
    imports: imports.map(row => ({ variantId: row.variantId, productId: row.promo.productId })),
    dp12: needsDon ? 'import without a price; no exact Cardmarket product verified' : 'already present',
  }
  console.log(JSON.stringify(report, null, 2))
  if (!confirmed) return

  await mkdir('.optimizer/backups', { recursive: true })
  // Keep a recoverable snapshot, outside Git, before the first database write.
  await writeFile(`.optimizer/backups/promo-don-${Date.now()}.json`, JSON.stringify({ now, cards, dons, report }, null, 2))
  for (const { card, lesson } of changes) {
    const { error } = await client.from('card_catalog').update({
      cardmarket_product_id: lesson.productId,
      cardmarket_url: `https://www.cardmarket.com/en/OnePiece/Products?idProduct=${lesson.productId}`,
      updated_at: now,
    }).eq('variant_id', card.variant_id).is('cardmarket_product_id', null).is('manual_price_override', null)
    if (error) throw error
  }

  for (const { promo, imageUrl, reference, product, variantId } of imports) {
    const mirrored = await mirrorCardImage({ sourceUrl: imageUrl, variantId })
    const row = {
      variant_id: variantId, card_id: variantId, base_card_id: promo.code,
      name: product.clean_name || reference.name,
      ...Object.fromEntries(['rarity', 'card_color', 'card_type', 'card_cost', 'card_power', 'card_counter', 'life', 'attribute', 'card_text', 'sub_types'].map(field => [field, reference[field]])),
      set_name: '4th Anniversary Treasure Campaign Pack [OP17]',
      source: 'manual_admin', source_endpoint: `https://www.cardmarket.com/en/OnePiece/Products?idProduct=${promo.productId}`,
      source_image_url: imageUrl, r2_image_url: mirrored.publicUrl, r2_storage_key: mirrored.key,
      image_status: 'ready', image_bytes: mirrored.bytes, image_synced_at: now,
      cardmarket_product_id: promo.productId,
      cardmarket_url: `https://www.cardmarket.com/en/OnePiece/Products?idProduct=${promo.productId}`,
      market_price: rowMarketPrice(product), inventory_price: null,
      is_manual: true, manual_price_override: null,
      raw_data: { import_type: 'verified_anniversary_2026', variant_label: '4th Anniversary Treasure Campaign', language: 'en', product_id: promo.productId, imported_at: now },
      source_updated_at: product.synced_at, updated_at: now,
    }
    const { error } = await client.from('card_catalog').insert(row)
    if (error) throw error
    const { error: sourceError } = await client.from('card_catalog_sources').upsert({
      source_key: createHash('sha1').update(`manual_admin|${variantId}|${promo.productId}`).digest('hex'),
      source: 'manual_admin', source_endpoint: row.source_endpoint, source_record_id: String(promo.productId),
      variant_id: variantId, raw_data: row.raw_data, synced_at: now,
    }, { onConflict: 'source_key' })
    if (sourceError) throw sourceError
    console.log(`Imported ${variantId} -> ${promo.productId}`)
  }

  if (needsDon && donImage) {
    const config = getR2Config()
    if (!config) throw new Error('Missing R2 configuration')
    const usage = await getR2Usage(true)
    if (usage.bytes + donImage.length > getR2SafetyLimitBytes()) throw new Error('R2 safety limit reached')
    const hash = createHash('sha256').update(donImage).digest('hex')
    const key = `cards/${donId}-${hash.slice(0, 12)}.webp`
    const storage = new S3Client({ region: 'auto', endpoint: `https://${config.accountId}.r2.cloudflarestorage.com`, credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey } })
    // Preserve the user-supplied, tightly framed English SAMPLE artwork as-is.
    // The official product page presents this same image on a square canvas.
    await storage.send(new PutObjectCommand({ Bucket: config.bucket, Key: key, Body: donImage, ContentType: 'image/webp', CacheControl: 'public, max-age=31536000, immutable' }))
    const row = {
      variant_id: donId, card_id: donId, base_card_id: donId,
      name: 'DON!! Card (Double Pack Set Vol. 12) (Silhouette)', rarity: 'DON!!', card_type: 'DON!!',
      card_text: 'Your Turn +1000', set_name: 'Double Pack Set Vol.12 [DP-12] - OP17',
      source: 'manual_admin', source_endpoint: donPage, source_image_url: donSource,
      r2_image_url: `${config.publicBaseUrl}/${key}`, r2_storage_key: key, image_status: 'ready',
      image_bytes: donImage.length, image_synced_at: now, is_manual: true,
      cardmarket_product_id: null, market_price: null, inventory_price: null,
      raw_data: { import_type: 'verified_dp12_2026', language: 'en', official_product_page: donPage, image_sha256: hash, price_mapping_status: 'awaiting_exact_product', imported_at: now },
      updated_at: now,
    }
    const { error } = await client.from('card_catalog').insert(row)
    if (error) throw error
    const { error: sourceError } = await client.from('card_catalog_sources').upsert({
      source_key: createHash('sha1').update(`manual_admin|${donId}|dp12-02`).digest('hex'),
      source: 'manual_admin', source_endpoint: donPage, source_record_id: 'dp12-02', variant_id: donId,
      raw_data: row.raw_data, synced_at: now,
    }, { onConflict: 'source_key' })
    if (sourceError) throw sourceError
    console.log(`Imported ${donId} without an invented price`)
  }
  await refreshCatalogSyncState()
  console.log('Completed. Run again without --confirm to check idempotence.')
}

main().catch(error => { console.error(error); process.exitCode = 1 })
