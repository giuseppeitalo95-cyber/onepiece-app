import assert from 'node:assert/strict'
import { recommendDeckCard } from '../lib/deckRecommendation'

const selected = [{ card_id: 'OP16-001' }, { card_id: 'OP16-002' }]
const result = recommendDeckCard(selected, [
  { placement: '1st', cards: [{ card_id: 'OP16-001', quantity: 4 }, { card_id: 'OP16-002', quantity: 4 }, { card_id: 'OP16-003', name: 'Best fit', quantity: 4 }] },
  { placement: '4th', cards: [{ card_id: 'OP16-001_p1', quantity: 4 }, { card_id: 'OP16-002', quantity: 3 }, { card_id: 'OP16-003', name: 'Best fit', quantity: 3 }] },
  { placement: '8th', cards: [{ card_id: 'OP16-001', quantity: 4 }, { card_id: 'OP16-099', name: 'Weak overlap', quantity: 4 }] },
])

assert.equal(result?.card.card_id, 'OP16-003')
assert.equal(result?.matchingDecks, 2)
assert.equal(result?.supportingDecks, 2)
assert.ok((result?.percentage || 0) >= 99)
assert.equal(recommendDeckCard([], []), null)

console.log('Deck recommendation OK: closest decklists drive the suggested card.')
