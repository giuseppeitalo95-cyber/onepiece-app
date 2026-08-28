import { createClient } from '@supabase/supabase-js'
import { OPV_CARDMARKET_OPTIMIZER_LESSONS } from '../lib/opvCardmarketOptimizerLessons'

const requestedGroup = process.argv.find(value => value.startsWith('--group='))?.split('=')[1]
const confirmed = process.argv.includes('--confirm')
if (!requestedGroup || !confirmed) {
  throw new Error('Usa --group=<nome> --confirm per applicare un gruppo Optimizer verificato.')
}

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!supabaseUrl || !serviceRoleKey) throw new Error('Credenziali Supabase mancanti.')

const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
})

const main = async () => {
  const lessons = Object.entries(OPV_CARDMARKET_OPTIMIZER_LESSONS)
    .filter(([, lesson]) => lesson.group === requestedGroup)
  if (lessons.length === 0) throw new Error(`Nessuna lezione trovata per ${requestedGroup}.`)

  const validated: Array<{ variantId: string; catalogVariantId: string; productId: number }> = []
  for (const [variantId, lesson] of lessons) {
    const { data: card, error: cardError } = await supabase
      .from('card_catalog')
      .select('variant_id,base_card_id,cardmarket_product_id')
      .ilike('variant_id', variantId)
      .maybeSingle()
    if (cardError) throw cardError
    if (!card) throw new Error(`${variantId}: carta non trovata.`)

    const { data: price, error: priceError } = await supabase
      .from('cardmarket_prices')
      .select('product_id,card_id')
      .eq('product_id', lesson.productId)
      .maybeSingle()
    if (priceError) throw priceError
    if (!price) throw new Error(`${variantId}: prodotto ${lesson.productId} non trovato.`)
    if (String(price.card_id).toUpperCase() !== String(card.base_card_id).toUpperCase()) {
      throw new Error(`${variantId}: il prodotto ${lesson.productId} appartiene a ${price.card_id}.`)
    }
    if (card.cardmarket_product_id && Number(card.cardmarket_product_id) !== lesson.productId) {
      throw new Error(`${variantId}: collegamento Admin esistente ${card.cardmarket_product_id}; applicazione interrotta.`)
    }

    validated.push({ variantId, catalogVariantId: card.variant_id, productId: lesson.productId })
  }

  let applied = 0
  for (const item of validated) {
    const { error: updateError } = await supabase
      .from('card_catalog')
      .update({
        cardmarket_product_id: item.productId,
        cardmarket_url: `https://www.cardmarket.com/en/OnePiece/Products?idProduct=${item.productId}`,
        updated_at: new Date().toISOString(),
      })
      .eq('variant_id', item.catalogVariantId)
    if (updateError) throw updateError
    applied += 1
  }

  console.log(JSON.stringify({ group: requestedGroup, lessons: lessons.length, applied }, null, 2))
}

main().catch(error => {
  console.error(error)
  process.exitCode = 1
})
