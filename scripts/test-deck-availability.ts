import assert from 'node:assert/strict'
import { reconcileDeckOwnedQuantities } from '../lib/deckAvailability'

const reconciled = reconcileDeckOwnedQuantities([
  { card_id: 'OP17-062', quantity: 3, owned_quantity: 1 },
  { card_id: 'OP17-062_p1', quantity: 1, owned_quantity: 1 },
], [
  { card_id: 'OP17-062', quantity: 2 },
  { card_id: 'OP17-062_p1', quantity: 1 },
])

assert.deepEqual(reconciled.map(card => card.owned_quantity), [2, 1])
assert.equal(reconciled.reduce((sum, card) => sum + Number(card.owned_quantity || 0), 0), 3)
assert.equal(reconciled.reduce((sum, card) => sum + Math.max(0, Number(card.quantity || 0) - Number(card.owned_quantity || 0)), 0), 1)

const interchangeableArtwork = reconcileDeckOwnedQuantities([
  { card_id: 'OP17-062', quantity: 2, owned_quantity: 0 },
], [
  { card_id: 'OP17-062_p2', quantity: 2 },
])
assert.equal(interchangeableArtwork[0].owned_quantity, 2)

const manualTracking = reconcileDeckOwnedQuantities([
  { card_id: 'OP17-062', quantity: 2, owned_quantity: 2 },
], [])
assert.equal(manualTracking[0].owned_quantity, 2)

console.log('Deck availability OK: variants share one owned copy pool without double counting.')
