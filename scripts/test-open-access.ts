import assert from 'node:assert/strict'
import {
  DAILY_REWARD_VIP_NOTE_PREFIX,
  PREMIUM_FEATURES_ENABLED,
  getPremiumTier,
  hasPremiumAccess,
} from '../lib/premium'
import {
  baseDeckCardId,
  buildOwnedQuantityByBase,
  summarizeDeckAvailability,
} from '../lib/deckAvailability'

assert.equal(PREMIUM_FEATURES_ENABLED, false)
assert.equal(hasPremiumAccess(null, null), true, 'All signed-in profiles must receive full feature access')
assert.equal(getPremiumTier({ is_premium: true }), 'free', 'Dormant paid data must not show Premium branding')
assert.equal(getPremiumTier({ is_vip: true }), 'free', 'Old manually assigned VIP must not grant or show a tier')

const future = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString()
assert.equal(getPremiumTier({ vip_note: `${DAILY_REWARD_VIP_NOTE_PREFIX}${future}` }), 'vip')

assert.equal(baseDeckCardId('ST10-006_p3'), baseDeckCardId('ST10-006_r1'))
const owned = buildOwnedQuantityByBase([
  { card_id: 'ST10-006', quantity: 1 },
  { card_id: 'ST10-006_p3', quantity: 2 },
  { card_id: 'OP01-001', quantity: 1 },
])
const availability = summarizeDeckAvailability(
  { card_id: 'OP01-001', quantity: 1 },
  [
    { card_id: 'ST10-006_r1', quantity: 4 },
    { card_id: 'OP02-002', quantity: 46 },
  ],
  owned,
)
assert.deepEqual(availability, {
  required: 51,
  covered: 4,
  missing: 47,
  missingTypes: 2,
  complete: false,
})

console.log('Open access and meta-deck ownership checks passed.')
