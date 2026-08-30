import { createClient } from '@supabase/supabase-js'
import sharp from 'sharp'
import {
  createDonImageFingerprint,
  decodeDonImageFingerprint,
  donFingerprintDistance,
} from '../lib/donImageFingerprint'
import { DON_IMAGE_SIGNATURES } from '../lib/donImageSignatures.generated'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!supabaseUrl || !serviceRoleKey) throw new Error('Credenziali Supabase mancanti.')

const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
})
const signatures = Object.entries(DON_IMAGE_SIGNATURES).map(([variantId, value]) => ({
  variantId,
  value: decodeDonImageFingerprint(value),
}))

const main = async () => {
  const { data, error } = await supabase
    .from('card_catalog')
    .select('variant_id,r2_image_url,source_image_url')
    .or('card_type.eq.DON!!,rarity.eq.DON!!')
    .not('r2_image_url', 'is', null)
    .order('variant_id')
  if (error) throw error

  const indexedIds = new Set(signatures.map(signature => signature.variantId))
  const indexedRows = (data || []).filter(row => indexedIds.has(String(row.variant_id).toUpperCase()))
  const sample = indexedRows
    .filter((_, index, rows) => index % Math.max(1, Math.floor(rows.length / 36)) === 0)
    .slice(0, 36)
  let topOne = 0
  let topFour = 0
  const misses: Array<{ expected: string; received: string; gap: number }> = []

  for (const row of sample) {
    const response = await fetch(row.r2_image_url || row.source_image_url, { signal: AbortSignal.timeout(10_000) })
    if (!response.ok) throw new Error(`${row.variant_id}: immagine non raggiungibile`)
    const original = Buffer.from(await response.arrayBuffer())
    const metadata = await sharp(original).metadata()
    const width = metadata.width || 1000
    const height = metadata.height || 1400
    const insetX = Math.max(0, Math.floor(width * 0.018))
    const insetY = Math.max(0, Math.floor(height * 0.018))
    const photographed = await sharp(original)
      .extract({ left: insetX, top: insetY, width: width - insetX * 2, height: height - insetY * 2 })
      .modulate({ brightness: 1.07, saturation: 0.92 })
      .jpeg({ quality: 86 })
      .toBuffer()
    const query = await createDonImageFingerprint(photographed)
    const ranked = signatures
      .map(signature => ({
        variantId: signature.variantId,
        score: donFingerprintDistance(query, signature.value),
      }))
      .sort((left, right) => left.score - right.score)
    const expected = String(row.variant_id).toUpperCase()
    if (ranked[0]?.variantId === expected) topOne += 1
    else misses.push({
      expected,
      received: ranked[0]?.variantId || 'none',
      gap: Number(((ranked[1]?.score || 0) - (ranked[0]?.score || 0)).toFixed(4)),
    })
    if (ranked.slice(0, 4).some(item => item.variantId === expected)) topFour += 1
  }

  if (topFour !== sample.length) {
    throw new Error(`DON visual test: carta corretta nella top 4 per ${topFour}/${sample.length}`)
  }
  console.log(`DON visual test: top 1 ${topOne}/${sample.length}, top 4 ${topFour}/${sample.length}, indice ${signatures.length}.`)
  if (misses.length) console.log(JSON.stringify({ ambiguousSamples: misses }))
}

main().catch(error => {
  console.error(error)
  process.exitCode = 1
})
