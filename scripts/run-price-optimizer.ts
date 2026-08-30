import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { createClient } from '@supabase/supabase-js'
import sharp from 'sharp'
import {
  discoverOpvEnglishExpansion,
  OPV_CARDMARKET_MATCHER_VERSION,
  selectOpvCardmarketCandidate,
  type OpvCardmarketCandidate,
} from '../lib/opvCardmarketMatcher'
import { OPV_CARDMARKET_OPTIMIZER_LESSONS } from '../lib/opvCardmarketOptimizerLessons'
import { rowMarketPrice } from '../lib/cardmarketPrices'

type CatalogRow = {
  variant_id: string
  base_card_id: string
  name: string
  set_name: string | null
  rarity: string | null
  market_price: number | null
  source_image_url: string | null
  r2_image_url: string | null
  cardmarket_product_id: number | null
  manual_price_override: number | null
}

type PriceRow = OpvCardmarketCandidate & {
  price_low: number | null
  price_trend: number | null
  price_avg: number | null
  price_avg_1: number | null
  price_avg_7: number | null
  price_avg_30: number | null
}

type ImageSignature = {
  full: Buffer
  artwork: Buffer
}

type VisualCandidate = {
  productId: number
  imageUrl: string
  score: number
  price: number | null
  expansionId: number | null
  variantRank: number
}

const CATALOG_FIELDS = 'variant_id,base_card_id,name,set_name,rarity,market_price,source_image_url,r2_image_url,cardmarket_product_id,manual_price_override'
const PRICE_FIELDS = 'product_id,card_id,product_name,clean_name,category_id,expansion_id,variant_rank,product_date_added,price_low,price_trend,price_avg,price_avg_1,price_avg_7,price_avg_30'
const SPECIAL_FOLDERS = ['UP', 'P', 'JDG', 'STP', 'STR', 'WC', 'R', 'OPPR', 'PB-XX', 'MINI', 'DEMO']

const argumentValue = (name: string) => {
  const inline = process.argv.find(value => value.startsWith(`--${name}=`))
  if (inline) return inline.slice(name.length + 3)
  const index = process.argv.indexOf(`--${name}`)
  return index >= 0 ? process.argv[index + 1] : null
}

const groupLimit = Math.max(1, Math.min(5000, Number(argumentValue('groups') || 30)))
const groupOffset = Math.max(0, Number(argumentValue('offset') || 0))
const concurrency = Math.max(1, Math.min(8, Number(argumentValue('concurrency') || 4)))
const outputPath = resolve(argumentValue('output') || '.optimizer/cardmarket-price-audit.json')
const skipReviewed = process.argv.includes('--skip-reviewed')

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!supabaseUrl || !serviceRoleKey) {
  throw new Error('Configura NEXT_PUBLIC_SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY per eseguire Optimizer.')
}

const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
})

const loadTable = async <T>(table: string, fields: string): Promise<T[]> => {
  const rows: T[] = []
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase.from(table).select(fields).range(from, from + 999)
    if (error) throw error
    rows.push(...((data || []) as T[]))
    if ((data || []).length < 1000) break
  }
  return rows
}

const mapLimit = async <T, R>(items: T[], limit: number, task: (item: T, index: number) => Promise<R>) => {
  const output = new Array<R>(items.length)
  let nextIndex = 0
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (nextIndex < items.length) {
      const index = nextIndex++
      output[index] = await task(items[index], index)
    }
  })
  await Promise.all(workers)
  return output
}

const priceOf = (row: PriceRow) => rowMarketPrice(row) ?? row.price_low ?? null

const baseCode = (value: string) => value.replace(/_p\d+$/i, '').toUpperCase()

// Risk order changes whenever Cardmarket refreshes a price. Offset-only runs can
// therefore revisit an old group and skip a new one. This ledger derives the
// already audited base codes from durable Optimizer lessons before slicing.
const reviewedBaseCodes = new Set(Object.keys(OPV_CARDMARKET_OPTIMIZER_LESSONS)
  .map(variantId => variantId.match(/((?:OP|ST|EB|PRB|SP|EX|CP)\d{2}-\d{3}|P-\d{3}|CM-\d+)/gi)?.at(-1)?.toUpperCase())
  .filter((value): value is string => Boolean(value)))

const foldersFor = (cardId: string, setName?: string | null) => {
  const code = cardId.split('-')[0].toUpperCase()
  const starter = code.match(/^ST(\d{2})$/)
  const standard = starter ? `ST-${starter[1]}` : code
  const rawSetName = setName || ''
  const text = rawSetName.toLowerCase()
  const namedFolders = [...rawSetName.matchAll(/\[([a-z0-9-]+)\]/gi)]
    .flatMap(match => {
      const folder = match[1].toUpperCase()
      return [folder, folder.replaceAll('-', ''), ...folder.split('-')]
    })
  const starterSet = rawSetName.match(/starter deck\s*(\d{1,2})/i)
  if (starterSet) {
    const number = starterSet[1].padStart(2, '0')
    namedFolders.push(`ST${number}`, `ST-${number}`)
  }
  const premiumBooster = rawSetName.match(/premium booster\s*-?the best-?(?:\s*vol\.?\s*(\d+))?/i)
  if (premiumBooster) {
    const number = (premiumBooster[1] || '1').padStart(2, '0')
    namedFolders.push(`PRB${number}`, `PRB-${number}`)
  }
  const learnTogether = rawSetName.match(/learn together deck set(?:\s*(\d+))?/i)
  if (learnTogether) {
    // Cardmarket stores these reprints under LD01/LD02 rather than STxx.
    const number = (learnTogether[1] || '1').padStart(2, '0')
    namedFolders.push(`LD${number}`)
  }
  const specialFirst = /promo|winner|judge|regional|anniversary|tournament|premium|one piece day/.test(text)
  const folders = specialFirst
    ? [...namedFolders, ...SPECIAL_FOLDERS, standard, code]
    : [standard, code, ...namedFolders, `${standard}-JP`, `${code}-JP`, ...SPECIAL_FOLDERS]
  return [...new Set(folders)]
}

const imageUrlCache = new Map<string, Promise<string | null>>()
const resolveCardmarketImage = (row: PriceRow, folders: string[]) => {
  const cacheKey = `${row.product_id}:${folders.join(',')}`
  const cached = imageUrlCache.get(cacheKey)
  if (cached) return cached

  const promise = (async () => {
    if (!row.category_id) return null
    for (const folder of folders) {
      const url = `https://product-images.s3.cardmarket.com/${row.category_id}/${folder}/${row.product_id}/${row.product_id}.jpg`
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), 3500)
      try {
        const response = await fetch(url, {
          headers: {
            Range: 'bytes=0-31',
            Referer: 'https://www.cardmarket.com/',
            'User-Agent': 'OnePieceVault-Optimizer/1.0',
          },
          signal: controller.signal,
          cache: 'no-store',
        })
        await response.body?.cancel().catch(() => undefined)
        if (response.ok) return url
      } catch {
        // Continue with the next known Cardmarket image folder.
      } finally {
        clearTimeout(timeout)
      }
    }
    return null
  })()

  imageUrlCache.set(cacheKey, promise)
  return promise
}

const signatureCache = new Map<string, Promise<ImageSignature | null>>()
const imageSignature = (url: string) => {
  const cached = signatureCache.get(url)
  if (cached) return cached

  const promise = (async () => {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 9000)
    try {
      const isCardmarketImage = url.startsWith('https://product-images.s3.cardmarket.com/')
      const response = await fetch(url, {
        headers: {
          'User-Agent': 'OnePieceVault-Optimizer/1.0',
          ...(isCardmarketImage ? { Referer: 'https://www.cardmarket.com/' } : {}),
        },
        signal: controller.signal,
        cache: 'no-store',
      })
      if (!response.ok) return null
      const source = Buffer.from(await response.arrayBuffer())
      const full = await sharp(source)
        .rotate()
        .flatten({ background: '#ffffff' })
        .resize(72, 100, { fit: 'fill' })
        .grayscale()
        .normalize()
        .raw()
        .toBuffer()

      const artwork = Buffer.alloc(64 * 52)
      let target = 0
      for (let y = 7; y < 59; y += 1) {
        for (let x = 4; x < 68; x += 1) artwork[target++] = full[y * 72 + x]
      }
      return { full, artwork }
    } catch {
      return null
    } finally {
      clearTimeout(timeout)
    }
  })()

  signatureCache.set(url, promise)
  return promise
}

const vectorSimilarity = (left: Buffer, right: Buffer) => {
  if (left.length !== right.length || left.length === 0) return 0
  let leftMean = 0
  let rightMean = 0
  for (let index = 0; index < left.length; index += 1) {
    leftMean += left[index]
    rightMean += right[index]
  }
  leftMean /= left.length
  rightMean /= right.length

  let covariance = 0
  let leftVariance = 0
  let rightVariance = 0
  let absoluteDifference = 0
  for (let index = 0; index < left.length; index += 1) {
    const leftDelta = left[index] - leftMean
    const rightDelta = right[index] - rightMean
    covariance += leftDelta * rightDelta
    leftVariance += leftDelta * leftDelta
    rightVariance += rightDelta * rightDelta
    absoluteDifference += Math.abs(left[index] - right[index])
  }

  const denominator = Math.sqrt(leftVariance * rightVariance)
  const correlation = denominator > 0 ? covariance / denominator : 0
  const correlationScore = Math.max(0, Math.min(1, (correlation + 1) / 2))
  const differenceScore = Math.max(0, 1 - absoluteDifference / left.length / 255)
  return correlationScore * 0.78 + differenceScore * 0.22
}

const compareSignatures = (left: ImageSignature, right: ImageSignature) => (
  vectorSimilarity(left.full, right.full) * 0.62
  + vectorSimilarity(left.artwork, right.artwork) * 0.38
)

const main = async () => {
  console.log('Optimizer: caricamento catalogo e guida prezzi...')
  const [catalog, priceRows] = await Promise.all([
    loadTable<CatalogRow>('card_catalog', CATALOG_FIELDS),
    loadTable<PriceRow>('cardmarket_prices', PRICE_FIELDS),
  ])

  const catalogByBase = new Map<string, CatalogRow[]>()
  const seenCatalogVariants = new Set<string>()
  for (const card of catalog) {
    // Supabase string keys are case-sensitive, so legacy imports may contain
    // OPxx-xxx_p1 and OPxx-xxx_P1 as duplicate rows. Audit the printing once.
    const normalizedVariantId = card.variant_id.toUpperCase()
    if (seenCatalogVariants.has(normalizedVariantId)) continue
    seenCatalogVariants.add(normalizedVariantId)
    const code = baseCode(card.base_card_id || card.variant_id)
    catalogByBase.set(code, [...(catalogByBase.get(code) || []), card])
  }
  const pricesByBase = new Map<string, PriceRow[]>()
  for (const price of priceRows) {
    pricesByBase.set(price.card_id, [...(pricesByBase.get(price.card_id) || []), price])
  }

  const riskyGroups = [...catalogByBase.entries()]
    .map(([code, cards]) => {
      const candidates = pricesByBase.get(code) || []
      const prices = candidates.map(priceOf).filter((value): value is number => value != null && value > 0)
      const spread = prices.length > 1 ? Math.max(...prices) / Math.min(...prices) : 1
      const special = cards.some(card => /promo|winner|judge|regional|anniversary|tournament|premium|one piece day/i.test(card.set_name || ''))
      const risk = Math.log10(Math.max(1, spread)) * 42
        + Math.min(cards.length, 10) * 8
        + Math.min(candidates.length, 15) * 4
        + (special ? 25 : 0)
      return { code, cards, candidates, spread, risk }
    })
    .filter(group => group.cards.length > 1 && group.candidates.length > 1)
    .filter(group => !skipReviewed || !reviewedBaseCodes.has(group.code))
    .sort((left, right) => right.risk - left.risk)
    .slice(groupOffset, groupOffset + groupLimit)

  console.log(`Optimizer: audit visivo di ${riskyGroups.length} gruppi ad alto rischio...`)
  const audits: Record<string, unknown>[] = []

  for (let groupIndex = 0; groupIndex < riskyGroups.length; groupIndex += 1) {
    const group = riskyGroups[groupIndex]
    const candidateImagesByFolders = new Map<string, Promise<Array<{
      candidate: PriceRow
      imageUrl: string | null
      signature: ImageSignature | null
    }>>>()

    for (const card of group.cards) {
      const folders = foldersFor(group.code, card.set_name)
      const foldersKey = folders.join(',')
      let candidateImagesPromise = candidateImagesByFolders.get(foldersKey)
      if (!candidateImagesPromise) {
        candidateImagesPromise = mapLimit(group.candidates, concurrency, async candidate => {
          const imageUrl = await resolveCardmarketImage(candidate, folders)
          const signature = imageUrl ? await imageSignature(imageUrl) : null
          return { candidate, imageUrl, signature }
        })
        candidateImagesByFolders.set(foldersKey, candidateImagesPromise)
      }
      const candidateImages = await candidateImagesPromise
      const sourceImageUrl = card.r2_image_url || card.source_image_url
      const sourceSignature = sourceImageUrl ? await imageSignature(sourceImageUrl) : null
      const visualCandidates: VisualCandidate[] = sourceSignature
        ? candidateImages
            .filter(item => item.imageUrl && item.signature)
            .map(item => ({
              productId: item.candidate.product_id,
              imageUrl: item.imageUrl as string,
              score: compareSignatures(sourceSignature, item.signature as ImageSignature),
              price: priceOf(item.candidate),
              expansionId: item.candidate.expansion_id ?? null,
              variantRank: item.candidate.variant_rank,
            }))
            .sort((left, right) => right.score - left.score)
        : []

      const input = {
        cardId: card.variant_id,
        name: card.name,
        setName: card.set_name,
        referencePrice: card.market_price,
      }
      const expansionLesson = await discoverOpvEnglishExpansion(input, group.candidates)
      const automatic = selectOpvCardmarketCandidate({
        input,
        candidates: group.candidates,
        priceOf: candidate => priceOf(candidate as PriceRow),
        expansionLesson,
      })
      const currentProductId = card.cardmarket_product_id || automatic?.candidate.product_id || null
      const currentCandidate = group.candidates.find(candidate => candidate.product_id === currentProductId)
      const bestVisual = visualCandidates[0] || null
      const secondVisual = visualCandidates[1] || null
      const currentVisual = visualCandidates.find(candidate => candidate.productId === currentProductId) || null
      const visualGap = bestVisual ? bestVisual.score - (secondVisual?.score || 0) : 0
      const visualConfidence = bestVisual && bestVisual.score >= 0.78 && visualGap >= 0.035
        ? 'high'
        : bestVisual && bestVisual.score >= 0.68 && visualGap >= 0.018
          ? 'medium'
          : 'low'
      const currentIsSameArtwork = Boolean(
        bestVisual
        && currentVisual
        && currentVisual.score >= 0.90
        && bestVisual.score - currentVisual.score <= 0.08
      )
      const mismatch = Boolean(
        bestVisual
        && currentProductId
        && bestVisual.productId !== currentProductId
        && !currentIsSameArtwork
      )
      const status = mismatch && visualConfidence === 'high'
        ? 'likely_mismatch'
        : mismatch && visualConfidence === 'medium'
          ? 'review'
          : !bestVisual
            ? 'image_missing'
            : 'consistent'

      audits.push({
        status,
        risk: Number(group.risk.toFixed(2)),
        priceSpread: Number(group.spread.toFixed(2)),
        variantId: card.variant_id,
        baseCardId: group.code,
        name: card.name,
        setName: card.set_name,
        rarity: card.rarity,
        sourceImageUrl,
        explicitMapping: Boolean(card.cardmarket_product_id),
        current: {
          productId: currentProductId,
          price: currentCandidate ? priceOf(currentCandidate) : null,
          imageUrl: currentVisual?.imageUrl || null,
          visualScore: currentVisual ? Number(currentVisual.score.toFixed(4)) : null,
          sameArtworkAsBest: currentIsSameArtwork,
          matcherConfidence: automatic?.confidence || null,
          matcherReasons: automatic?.reasons || [],
        },
        visual: {
          confidence: visualConfidence,
          score: bestVisual ? Number(bestVisual.score.toFixed(4)) : null,
          gap: bestVisual ? Number(visualGap.toFixed(4)) : null,
          proposedProductId: bestVisual?.productId || null,
          proposedPrice: bestVisual?.price ?? null,
          candidates: visualCandidates.slice(0, 3).map(candidate => ({
            ...candidate,
            score: Number(candidate.score.toFixed(4)),
          })),
        },
      })
    }

    console.log(`  ${groupIndex + 1}/${riskyGroups.length} ${group.code}: ${group.cards.length} varianti, ${group.candidates.length} prodotti`)
  }

  const orderedAudits = [...audits].sort((left, right) => {
    const priority: Record<string, number> = { likely_mismatch: 0, review: 1, image_missing: 2, consistent: 3 }
    return (priority[String(left.status)] ?? 9) - (priority[String(right.status)] ?? 9)
      || Number(right.risk) - Number(left.risk)
  })
  const summary = orderedAudits.reduce<Record<string, number>>((counts, audit) => {
    const key = String(audit.status)
    counts[key] = (counts[key] || 0) + 1
    return counts
  }, {})
  const report = {
    optimizer: 'OPV Cardmarket Optimizer 0.1',
    matcher: OPV_CARDMARKET_MATCHER_VERSION,
    generatedAt: new Date().toISOString(),
    mode: 'read-only',
    scope: {
      catalogRows: catalog.length,
      cardmarketRows: priceRows.length,
      eligibleRiskGroups: [...catalogByBase.entries()].filter(([code, cards]) => cards.length > 1 && (pricesByBase.get(code)?.length || 0) > 1).length,
      excludedReviewedGroups: skipReviewed ? reviewedBaseCodes.size : 0,
      groupOffset,
      auditedGroups: riskyGroups.length,
      auditedVariants: orderedAudits.length,
      // Preserve the pre-sort audit order so one bulk run can be split into
      // reproducible review batches without recalculating images or prices.
      auditedBaseCodes: riskyGroups.map(group => group.code),
    },
    summary,
    audits: orderedAudits,
  }

  await mkdir(dirname(outputPath), { recursive: true })
  await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8')
  console.log(`Optimizer completato: ${outputPath}`)
  console.log(JSON.stringify({ scope: report.scope, summary }, null, 2))
}

main().catch(error => {
  console.error('Optimizer non completato:', error)
  process.exitCode = 1
})
