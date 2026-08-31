import assert from 'node:assert/strict'
import { looksLikeDonOcrText } from '../lib/donOcrRouting'
import { rankCardsByVisibleText, selectCardsFromVisibleTextRanking } from '../lib/cardTextRecognition'

const newgate = {
  card_id: 'ST15-002_p3',
  name: 'Edward.Newgate',
  card_cost: 7,
  card_power: 8000,
  card_type: 'CHARACTER',
  card_text: '[On Play] Give up to 1 rested DON!! card to your Leader or 1 of your Characters. [Activate: Main] You may rest this Character: K.O. up to 1 of your opponent\'s Characters with 5000 power or less.',
}
const text = `7 8000 4th Anniversary ${newgate.card_text} CHARACTER Edward.Newgate The Four Emperors/Whitebeard Pirates`
assert.equal(looksLikeDonOcrText(text), false, 'Newgate must reach normal name/effect recognition')
const ranked = rankCardsByVisibleText(text, [newgate])
assert.equal(ranked[0].exactName, true)
assert.equal(ranked[0].confident, true)
assert.equal(ranked[0].costMatch, true)
assert.equal(ranked[0].powerMatch, true)
assert.equal(selectCardsFromVisibleTextRanking(ranked, [newgate])[0].card_id, newgate.card_id)

const normalCards = [
  // Cropped/partial OCR still contains rules evidence, even without the name.
  'Give up to 1 rested DON!! card to your Leader or 1 of your Characters.',
  'DON!! x2 Your Turn This Character gains +1000 power.',
  'DON!! x1 On Play Draw 1 card.',
  'DON!! x1 On\nPlay Draw 1 card.',
  'Give 1 DON!! to your Characters.',
  'DON!!\nEVENT',
  'DON!!\nSTAGE',
  'DON!!\nCounter',
  'DON!!\nTrigger',
  'DON!! Your Turn +1000 power',
  '8000 7 CHARACTER Edward.Newgate',
  '',
]
for (const sample of normalCards) assert.equal(looksLikeDonOcrText(sample), false, sample)

const dons = [
  'SAMPLE DON!! CARD Your Turn +1000', // DP12 silhouette, unchanged route.
  'DON!! CARD Your Turn +1000',
  'DON! CARD',
  'DON !! CARD',
  'DON!!',
  'Your Turn +1000',
  'YOUR\nTURN\n1000',
  'I will be King of the Pirates! DON!! CARD Your Turn +1000',
]
for (const sample of dons) assert.equal(looksLikeDonOcrText(sample), true, sample)
console.log(`DON routing: Newgate recognition + ${normalCards.length} normal/empty inputs + ${dons.length} DON inputs passed.`)
