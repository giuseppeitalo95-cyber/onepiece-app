import {
  OPV_CARDMARKET_REGRESSION_CASES,
  selectOpvCardmarketCandidate,
  type OpvCardmarketCandidate,
} from '../lib/opvCardmarketMatcher'

const candidates: OpvCardmarketCandidate[] = [
  { product_id: 744752, card_id: 'ST10-006', product_name: 'Monkey.D.Luffy (ST10-006)', clean_name: 'Monkey.D.Luffy', expansion_id: 5380, variant_rank: 2, product_date_added: '2023-11-10T05:06:21+01:00' },
  { product_id: 747213, card_id: 'ST10-006', product_name: 'Monkey.D.Luffy (ST10-006)', clean_name: 'Monkey.D.Luffy', expansion_id: 5558, variant_rank: 0, product_date_added: '2023-11-28T14:52:52+01:00' },
  { product_id: 786110, card_id: 'ST10-006', product_name: 'Monkey.D.Luffy (ST10-006)', clean_name: 'Monkey.D.Luffy', expansion_id: 5303, variant_rank: 3, product_date_added: '2024-08-30T16:05:30+02:00' },
  { product_id: 858769, card_id: 'ST10-006', product_name: 'Monkey.D.Luffy (ST10-006)', clean_name: 'Monkey.D.Luffy', expansion_id: 5303, variant_rank: 0, product_date_added: '2025-11-12T13:01:57+01:00' },
  { product_id: 858289, card_id: 'EB03-013', product_name: 'Carrot (EB03-013)', clean_name: 'Carrot', expansion_id: 6379, variant_rank: 0, product_date_added: '2025-10-10T00:00:00+02:00' },
  { product_id: 858290, card_id: 'EB03-013', product_name: 'Carrot (EB03-013)', clean_name: 'Carrot', expansion_id: 6379, variant_rank: 1, product_date_added: '2025-10-10T00:01:00+02:00' },
  { product_id: 871978, card_id: 'EB03-013', product_name: 'Carrot (EB03-013)', clean_name: 'Carrot', expansion_id: 6449, variant_rank: 1, product_date_added: '2026-01-01T00:00:00+01:00' },
]

const sevenDayPrice = new Map<number, number>([
  [744752, 1.11],
  [747213, 1.70],
  [786110, 21.63],
  [858769, 1.56],
  [858289, 0.13],
  [858290, 5.96],
  [871978, 5.99],
])

for (const regression of OPV_CARDMARKET_REGRESSION_CASES) {
  const baseId = regression.cardId.replace(/_p\d+$/i, '')
  const match = selectOpvCardmarketCandidate({
    input: {
      cardId: regression.cardId,
      name: regression.name,
      setName: regression.setName,
      referencePrice: regression.referencePrice,
    },
    candidates: candidates.filter(candidate => candidate.card_id === baseId),
    priceOf: candidate => sevenDayPrice.get(candidate.product_id) ?? null,
    expansionLesson: 'expansionLesson' in regression ? regression.expansionLesson : null,
  })

  if (match?.candidate.product_id !== regression.expectedProductId) {
    throw new Error(`${regression.id}: atteso ${regression.expectedProductId}, ricevuto ${match?.candidate.product_id || 'null'}`)
  }
}

const lessonlessMatch = selectOpvCardmarketCandidate({
  input: {
    cardId: 'EB03-013',
    name: 'Carrot',
    referencePrice: 0.18,
  },
  candidates: candidates.filter(candidate => candidate.card_id === 'EB03-013'),
  priceOf: candidate => sevenDayPrice.get(candidate.product_id) ?? null,
})

if (lessonlessMatch?.candidate.product_id !== 858289) {
  throw new Error(`fallback senza espansione: atteso 858289, ricevuto ${lessonlessMatch?.candidate.product_id || 'null'}`)
}

console.log(`OPV price matcher: ${OPV_CARDMARKET_REGRESSION_CASES.length + 1} regressioni verificate.`)
