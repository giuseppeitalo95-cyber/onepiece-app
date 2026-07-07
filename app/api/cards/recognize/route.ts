import { getAllCards } from '@/lib/cardData'

const normalize = (value: string) =>
  value.toLowerCase().replace(/[^a-z0-9]/g, ' ').replace(/\s+/g, ' ').trim()

const compact = (value: string) => normalize(value).replace(/\s/g, '')

const tokenSimilarity = (a: string, b: string) => {
  if (a === b) return 1
  if (a.length < 3 || b.length < 3) return 0
  if (a.includes(b) || b.includes(a)) return 0.85

  const maxLength = Math.max(a.length, b.length)
  let same = 0
  const minLength = Math.min(a.length, b.length)
  for (let i = 0; i < minLength; i += 1) {
    if (a[i] === b[i]) same += 1
  }
  return same / maxLength
}

const normalizeOcrNumber = (value: string) =>
  value
    .toUpperCase()
    .replace(/O/g, '0')
    .replace(/[IL]/g, '1')
    .replace(/S/g, '5')
    .replace(/B/g, '8')
    .replace(/[^0-9]/g, '')

const extractCardCode = (text: string) => {
  const clean = text.toUpperCase().replace(/[^A-Z0-9]/g, '')
  const match = clean.match(/(OP|0P|ST|EB|PRB|SP|DON|D0N|EX|CP|P)([A-Z0-9]{1,2})([A-Z0-9]{3})/)
  if (!match) return null

  const prefix = match[1].replace('0P', 'OP').replace('D0N', 'DON')
  const setNumber = normalizeOcrNumber(match[2]).padStart(2, '0')
  const cardNumber = normalizeOcrNumber(match[3]).padStart(3, '0')

  return `${prefix}${setNumber}-${cardNumber}`
}

const importantTokens = (text: string) => {
  const stopWords = new Set([
    'the', 'and', 'for', 'with', 'your', 'card', 'cards', 'this', 'that', 'when',
    'play', 'turn', 'cost', 'power', 'one', 'piece', 'character', 'opponent'
  ])

  return normalize(text)
    .split(' ')
    .filter(token => token.length >= 3 && !stopWords.has(token))
}

const toResponseCard = (card: any) => ({
  id: String(card.card_id || card.id || ''),
  card_id: String(card.card_id || card.id || ''),
  name: card.card_name || card.name || 'Carta',
  image_url: card.card_image || card.image_url || null,
  rarity: card.rarity || '-',
  card_color: card.card_color ?? null,
  card_type: card.card_type ?? null,
  card_cost: card.card_cost ? Number(card.card_cost) : null,
  card_power: card.card_power ? Number(card.card_power) : null,
  set_name: card.set_name || null,
  market_price: card.market_price ? Number(card.market_price) : null,
  inventory_price: card.inventory_price ? Number(card.inventory_price) : null,
})

export async function POST(req: Request) {
  try {
    const body = await req.json()
    const text = String(body?.text || '')
    if (!text.trim()) return Response.json({ card: null, candidates: [] })

    const cards = await getAllCards()
    const code = extractCardCode(text)

    if (code) {
      const exact = cards.find((card: any) => compact(card.card_id || card.id || '') === compact(code))
      if (exact) return Response.json({ card: toResponseCard(exact), candidates: [toResponseCard(exact)] })
    }

    const normalizedText = normalize(text)
    const compactText = compact(text)
    const tokens = importantTokens(text)

    const scored = cards
      .map((card: any, index: number) => {
        const name = normalize(card.card_name || card.name || '')
        const compactName = compact(card.card_name || card.name || '')
        const id = compact(card.card_id || card.id || '')
        const searchable = normalize([
          card.card_name || card.name,
          card.card_id || card.id,
          card.rarity,
          card.card_color,
          card.card_type,
          card.card_cost,
          card.card_power,
          card.sub_types,
          card.card_text,
          card.set_name
        ].filter(Boolean).join(' '))

        let score = 0
        let identityScore = 0
        if (id && compactText.includes(id)) identityScore += 80
        if (compactName && compactText.includes(compactName)) identityScore += 35
        if (name && normalizedText.includes(name)) identityScore += 25

        const nameTokens = name.split(' ').filter(Boolean)
        const nameTokenSet = new Set(nameTokens)
        for (const token of tokens) {
          if (nameTokenSet.has(token)) identityScore += 14
          else if (name.includes(token)) identityScore += 7
          else if (nameTokens.some(nameToken => tokenSimilarity(token, nameToken) >= 0.78)) identityScore += 6
          else if (identityScore > 0 && searchable.includes(token)) score += 2
        }

        return { card, score: identityScore > 0 ? score + identityScore : 0, index }
      })
      .filter(item => item.score > 0)
      .sort((a, b) => b.score - a.score || a.index - b.index)

    const best = scored[0]
    const second = scored[1]
    const confident = best && (best.score >= 8 || best.score - (second?.score || 0) >= 4)

    return Response.json({
      card: confident ? toResponseCard(best.card) : null,
      candidates: scored.slice(0, 5).map(item => toResponseCard(item.card))
    })
  } catch (error) {
    console.error('Card recognition error:', error)
    return Response.json({ card: null, candidates: [], error: 'Recognition error' }, { status: 500 })
  }
}
