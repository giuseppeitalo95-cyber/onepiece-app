type MetaDeckCard = {
  card_id: string
  name: string
  quantity: number
  image_url: string | null
  rarity: string | null
  card_color: string | null
  card_type: string | null
}

const LIMITLESS_BASE = 'https://onepiece.limitlesstcg.com'

const decodeHtml = (value: string) =>
  value
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/&rsquo;/g, "'")
    .replace(/&lsquo;/g, "'")
    .replace(/&eacute;/g, 'é')
    .replace(/&uuml;/g, 'ü')
    .replace(/<[^>]+>/g, '')
    .trim()

const cardImageUrl = (cardId: string) =>
  `https://en.onepiece-cardgame.com/images/cardlist/card/${cardId}.png`

const parseDeckSummary = (html: string) => {
  const decks: Array<{ id: string; title: string; player: string; placement: string; url: string }> = []
  const rowRegex = /<tr>\s*<td>([^<]+)<\/td>\s*<td><a href="\/decks\/list\/(\d+)">([\s\S]*?)<\/a><\/td>\s*<\/tr>/g
  let match: RegExpExecArray | null

  while ((match = rowRegex.exec(html)) && decks.length < 12) {
    const [, placement, id, rawTitle] = match
    const title = decodeHtml(rawTitle.replace(/<span class="annotation">[\s\S]*?<\/span>/, ''))
    const player = decodeHtml(rawTitle.match(/<span class="annotation">by ([\s\S]*?)<\/span>/)?.[1] || '')
    decks.push({
      id,
      title,
      player,
      placement: decodeHtml(placement),
      url: `${LIMITLESS_BASE}/decks/list/${id}`
    })
  }

  return decks
}

const parseDeckDetail = (html: string, summary: { id: string; title: string; player: string; placement: string; url: string }) => {
  const cards: MetaDeckCard[] = []
  const cardRegex = /<div class="decklist-card" data-count="(\d+)" data-id="([^"]+)"[\s\S]*?<span class="card-name">([^<]+)<\/span>[\s\S]*?<\/div>/g
  let match: RegExpExecArray | null

  while ((match = cardRegex.exec(html))) {
    const [, countRaw, cardId, rawName] = match
    const quantity = Number(countRaw || 1)
    const name = decodeHtml(rawName.replace(/\s*\([^)]*\)\s*$/, ''))
    const isLeader = cards.length === 0

    cards.push({
      card_id: cardId,
      name,
      quantity,
      image_url: cardImageUrl(cardId),
      rarity: null,
      card_color: null,
      card_type: isLeader ? 'Leader' : null
    })
  }

  const leader = cards[0] || null
  const mainCards = cards.slice(1)
  const eurTotal = decodeHtml(html.match(/<\/a>\s*([0-9.,]+€)\s*<\/div>/)?.[1] || '')

  return {
    id: `meta-${summary.id}`,
    name: summary.title,
    player: summary.player,
    placement: summary.placement,
    sourceUrl: summary.url,
    source: 'Limitless',
    eurTotal,
    leader,
    cards: mainCards,
    updatedAt: new Date().toISOString()
  }
}

export async function GET() {
  try {
    const listRes = await fetch(`${LIMITLESS_BASE}/decks/lists`, {
      headers: { 'User-Agent': 'OnePieceVault/1.0' },
      next: { revalidate: 900 }
    } as RequestInit & { next: { revalidate: number } })
    const listHtml = await listRes.text()
    const summaries = parseDeckSummary(listHtml)

    const decks = await Promise.all(
      summaries.slice(0, 8).map(async summary => {
        const detailRes = await fetch(summary.url, {
          headers: { 'User-Agent': 'OnePieceVault/1.0' },
          next: { revalidate: 900 }
        } as RequestInit & { next: { revalidate: number } })
        return parseDeckDetail(await detailRes.text(), summary)
      })
    )

    return Response.json({ decks })
  } catch (error) {
    console.error('Meta decks error:', error)
    return Response.json({ decks: [], error: 'Meta decks unavailable' }, { status: 500 })
  }
}
