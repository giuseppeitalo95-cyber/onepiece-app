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
]

const sevenDayPrice = new Map<number, number>([
  [744752, 1.11],
  [747213, 1.70],
  [786110, 21.63],
  [858769, 1.56],
])

for (const regression of OPV_CARDMARKET_REGRESSION_CASES) {
  const match = selectOpvCardmarketCandidate({
    input: {
      cardId: regression.cardId,
      name: 'Monkey.D.Luffy',
      setName: regression.setName,
      referencePrice: 2.75,
    },
    candidates,
    priceOf: candidate => sevenDayPrice.get(candidate.product_id) ?? null,
  })

  if (match?.candidate.product_id !== regression.expectedProductId) {
    throw new Error(`${regression.id}: atteso ${regression.expectedProductId}, ricevuto ${match?.candidate.product_id || 'null'}`)
  }
}

console.log(`OPV price matcher: ${OPV_CARDMARKET_REGRESSION_CASES.length} regressione verificata.`)
