import assert from 'node:assert/strict'
import { catalogVariantIdAliases } from '../lib/catalogVariantIds'
import reviewed from './data/don-cardmarket-2026-08-31.json'

async function main() {
  assert.deepEqual(catalogVariantIdAliases([' DON_101 ', 'don_101']), ['DON_101', 'don_101'])
  assert(catalogVariantIdAliases(['DON_DP12_02']).includes('don_dp12_02'))
  assert(catalogVariantIdAliases(['op14-027_P2']).includes('OP14-027_p2'))
  assert(catalogVariantIdAliases(['OP01-006_R1']).includes('OP01-006_r1'))
  assert.equal(new Set(reviewed.lessons.map(row => row.variantId)).size, reviewed.lessons.length)
  assert.equal(new Set(reviewed.lessons.map(row => row.productId)).size, reviewed.lessons.length)
  assert.equal(reviewed.lessons.find(row => row.variantId === 'don_1')?.productId, 865607)
  assert.equal(reviewed.lessons.find(row => row.variantId === 'don_13')?.productId, 865608)

  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://fixture.supabase.co'
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'offline-test-only'
  process.env.PRICE_RUNTIME_EXTERNAL_FALLBACK = 'false'
  let average = 0.29
  const card = {
    variant_id: 'don_101', card_id: 'don_101', base_card_id: 'don_101',
    name: 'DON!! Card (Iceberg)', rarity: 'DON!!', card_type: 'DON!!',
    market_price: 900, cardmarket_product_id: 799474,
  }
  const originalFetch = globalThis.fetch
  globalThis.fetch = async (input) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url)
    assert.equal(url.hostname, 'fixture.supabase.co', 'Tests must not access production or upstream APIs')
    if (url.pathname.endsWith('/card_catalog')) {
      const ids = url.searchParams.get('variant_id')?.replace(/^in\.\(|\)$/g, '').split(',') || []
      // Match exactly, just like PostgreSQL. Uppercase-only DON queries fail.
      return Response.json(ids.includes(card.variant_id) ? [card] : [])
    }
    assert(url.pathname.endsWith('/cardmarket_prices'), `Unexpected request ${url.pathname}`)
    return Response.json([{
      product_id: 799474, card_id: '', product_name: 'Don!! (PRB Iceburg)', clean_name: 'Don!! (PRB Iceburg)',
      expansion_id: 5805, variant_rank: 0, price_avg_7: average, price_trend: 0.8,
      currency: 'EUR', synced_at: '2026-08-31T04:00:00Z',
    }], { headers: { 'content-range': '0-0/1' } })
  }
  try {
    const { GET } = await import('../app/api/cards/price/route')
    const { POST } = await import('../app/api/cards/prices/route')
    const { getLiveCardPrice, clearLiveCardPriceCache } = await import('../lib/cardPrices')
    const { clearCardmarketPriceCache } = await import('../lib/cardmarketPrices')
    for (const id of ['don_101', 'DON_101']) {
      const response = await GET(new Request(`https://opv.test/api/cards/price?cardId=${id}`))
      assert.equal(response.status, 200)
      const body = await response.json()
      assert.equal(body.price.productId, 799474)
      assert.equal(body.price.marketPrice, average)
      assert.equal(body.price.currency, 'EUR')
    }
    const batch = await POST(new Request('https://opv.test/api/cards/prices', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cards: [{ cardId: 'DON_101' }] }),
    }))
    assert.equal((await batch.json()).prices.DON_101.marketPrice, average)
    assert.equal(await getLiveCardPrice({ cardId: 'don_dp12_02', name: 'DON!! Card (Silhouette)', catalogResolved: true }), null)
    const manual = await getLiveCardPrice({ cardId: 'don_101', name: card.name, catalogResolved: true, manualPriceOverride: 2.5 })
    assert.equal(manual?.marketPrice, 2.5)
    average = 0.46
    clearCardmarketPriceCache()
    clearLiveCardPriceCache()
    const updated = await GET(new Request('https://opv.test/api/cards/price?cardId=don_101'))
    const updatedBody = await updated.json()
    assert.equal(updatedBody.price.productId, 799474, 'A daily update must not switch the product')
    assert.equal(updatedBody.price.marketPrice, average, 'The price must follow the new price guide')
    console.log('PASS: DON casing, exact product, batch/single parity, daily refresh, manual priority, unmapped DON, reviewed identities')
  } finally {
    globalThis.fetch = originalFetch
  }
}

main().catch(error => { console.error(error); process.exitCode = 1 })
