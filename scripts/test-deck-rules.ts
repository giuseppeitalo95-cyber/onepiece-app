import assert from 'node:assert/strict'
import { DECK_SIZE, hasUnlimitedDeckCopies, maxDeckCopies } from '../lib/deckRules'

assert.equal(hasUnlimitedDeckCopies('OP16-042'), true)
assert.equal(hasUnlimitedDeckCopies('OP16-042_p1'), true)
assert.equal(hasUnlimitedDeckCopies('OP16-041'), false)
assert.equal(maxDeckCopies('OP16-042'), DECK_SIZE)
assert.equal(maxDeckCopies('OP16-042_p3'), DECK_SIZE)
assert.equal(maxDeckCopies('OP16-041'), 4)

console.log('Deck rules OK: OP16-042 unlimited, standard cards capped at four.')
