import { getAllCards } from '@/lib/cardData'

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url)
  const q = searchParams.get('q')

  if (!q) return Response.json([])

  try {
    const normalize = (str: string) => str.toLowerCase().replace(/[^a-z0-9]/g, ' ').replace(/\s+/g, ' ').trim()
    const compact = (str: string) => normalize(str).replace(/\s/g, '')
    const baseCode = (str: string) => {
      const raw = (str || '').toLowerCase().replace(/[^a-z0-9_]/g, '')
      const withoutUnderscoreVariant = raw.replace(/_p\d+$/i, '')
      return withoutUnderscoreVariant
        .replace(/[^a-z0-9]/g, '')
        .replace(/^((?:op|st|eb|prb|sp|ex|cp)\d{5,6}|p\d{3}|don\d{3})p\d+$/i, '$1')
    }
    const looksLikeCodePrefix = (str: string) => /^(op|st|eb|prb|sp|don|ex|cp|p)\d{0,3}\d{0,4}(?:p\d*)?$/i.test(compact(str))
    const looksLikeCompleteCode = (str: string) => /^(op|st|eb|prb|sp|don|ex|cp|p)\d{1,3}\d{2,4}(?:p\d+)?$/i.test(compact(str))
    const query = normalize(q)
    const compactQuery = compact(q)
    const queryTokens = query.split(' ').filter(token => token.length >= 2)
    const cards = await getAllCards()

    if (looksLikeCodePrefix(q)) {
      const wanted = baseCode(q)
      const completeCode = looksLikeCompleteCode(q)
      const variants = cards
        .map((card: any, index: number) => {
          const id = compact(card.card_id || card.id || '')
          const baseId = baseCode(card.card_id || card.id || '')
          let score = 0

          if (completeCode && baseId === wanted) score += 100
          if (id === compactQuery) score += 80
          if (id.startsWith(compactQuery)) score += 60
          if (baseId.startsWith(wanted)) score += 45

          return { card, id, score, index }
        })
        .filter((item: any) => item.score > 0)
        .sort((a: any, b: any) => {
          const aVariant = /p\d+$/i.test(a.id) ? 1 : 0
          const bVariant = /p\d+$/i.test(b.id) ? 1 : 0
          return b.score - a.score || a.id.localeCompare(b.id) || aVariant - bVariant || a.index - b.index
        })

      const seenCodes = new Set<string>()
      const uniqueVariants = variants
        .map((item: any) => item.card)
        .filter((card: any) => {
          const id = compact(card.card_id || card.id || '')
          if (!id || seenCodes.has(id)) return false
          seenCodes.add(id)
          return true
        })

      return Response.json(uniqueVariants.slice(0, 80))
    }

    const scoredCards = cards.map((card: any, index: number) => {
      const searchable = [
        card.name,
        card.card_name,
        card.card_id,
        card.id,
        card.rarity,
        card.card_cost,
        card.card_power,
        card.card_text,
        card.set_name,
        card.sub_types,
        card.card_type,
        card.card_color
      ].filter(Boolean).join(' ')

      const normalizedSearchable = normalize(searchable)
      const compactSearchable = normalizedSearchable.replace(/\s/g, '')
      const name = normalize(card.card_name || card.name || '')
      const id = compact(card.card_id || card.id || '')
      let score = 0

      if (compactQuery && id === compactQuery) score += 100
      if (compactQuery && id.includes(compactQuery)) score += 40
      if (compactQuery && compactSearchable.includes(compactQuery)) score += 20
      if (query && name === query) score += 25
      if (query && name.includes(query)) score += 14
      if (query && normalizedSearchable.includes(query)) score += 10

      for (const token of queryTokens) {
        if (name.split(' ').includes(token)) score += 8
        else if (name.includes(token)) score += 5
        else if (normalizedSearchable.includes(token)) score += 2
      }

      return { card, score, index }
    })
      .filter(item => item.score > 0)
      .sort((a, b) => b.score - a.score || a.index - b.index)
      .map(item => item.card)

    return Response.json(scoredCards.slice(0, 80))
  } catch (err) {
    console.error('Card search error:', err)
    return Response.json({ error: 'API error' }, { status: 500 })
  }
}
