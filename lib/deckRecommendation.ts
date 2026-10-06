import { baseDeckCardId } from './deckAvailability'

export type RecommendationCard = {
  card_id: string
  name?: string | null
  quantity?: number | null
  image_url?: string | null
  rarity?: string | null
  card_color?: string | null
  card_type?: string | null
  card_cost?: number | null
  card_power?: number | null
}

export type RecommendationDeck = {
  placement?: string | null
  cards?: RecommendationCard[] | null
}

export type DeckRecommendation = {
  card: RecommendationCard
  percentage: number
  matchingDecks: number
  supportingDecks: number
  recommendedCopies: number
}

const placementWeight = (placement?: string | null) => {
  const rank = Number((placement || '').match(/\d+/)?.[0] || 99)
  if (rank === 1) return 1.3
  if (rank <= 4) return 1.18
  if (rank <= 8) return 1.08
  return 1
}

export const recommendDeckCard = (
  selectedCards: RecommendationCard[],
  decks: RecommendationDeck[],
): DeckRecommendation | null => {
  const selectedIds = new Set(selectedCards.map(card => baseDeckCardId(card.card_id)).filter(Boolean))
  if (selectedIds.size === 0 || decks.length === 0) return null

  const compared = decks.flatMap(deck => {
    const cards = Array.isArray(deck.cards) ? deck.cards : []
    const ids = new Set(cards.map(card => baseDeckCardId(card.card_id)).filter(Boolean))
    const overlap = [...selectedIds].filter(id => ids.has(id)).length
    if (overlap === 0) return []
    const coverage = overlap / selectedIds.size
    const precision = overlap / Math.max(1, ids.size)
    return [{ deck, cards, overlap, weight: placementWeight(deck.placement) * overlap * (0.6 + coverage * coverage) * (0.75 + precision) }]
  })
  if (compared.length === 0) return null

  // Keep only the closest decklists. This prevents a generic one-card overlap from
  // overpowering a smaller group that matches most of the user's current build.
  const bestOverlap = Math.max(...compared.map(item => item.overlap))
  const minimumOverlap = selectedIds.size <= 2 ? bestOverlap : Math.max(1, bestOverlap - 1)
  const matching = compared.filter(item => item.overlap >= minimumOverlap)
  const totalWeight = matching.reduce((sum, item) => sum + item.weight, 0)
  if (totalWeight <= 0) return null

  const candidates = new Map<string, {
    card: RecommendationCard
    supportingDecks: number
    weightedPresence: number
    weightedQuantity: number
  }>()

  for (const item of matching) {
    const seenInDeck = new Set<string>()
    for (const card of item.cards) {
      const id = baseDeckCardId(card.card_id)
      if (!id || selectedIds.has(id) || seenInDeck.has(id)) continue
      seenInDeck.add(id)
      const current = candidates.get(id) || { card, supportingDecks: 0, weightedPresence: 0, weightedQuantity: 0 }
      current.supportingDecks += 1
      current.weightedPresence += item.weight
      current.weightedQuantity += item.weight * Math.max(1, Number(card.quantity || 1))
      candidates.set(id, current)
    }
  }

  const ranked = [...candidates.values()].sort((left, right) => {
    const leftRate = left.weightedPresence / totalWeight
    const rightRate = right.weightedPresence / totalWeight
    const leftScore = leftRate * Math.log2(left.supportingDecks + 2)
    const rightScore = rightRate * Math.log2(right.supportingDecks + 2)
    return rightScore - leftScore || right.supportingDecks - left.supportingDecks
  })
  const best = ranked[0]
  if (!best) return null

  return {
    card: best.card,
    percentage: Math.max(1, Math.min(100, Math.round((best.weightedPresence / totalWeight) * 100))),
    matchingDecks: matching.length,
    supportingDecks: best.supportingDecks,
    recommendedCopies: Math.max(1, Math.round(best.weightedQuantity / best.weightedPresence)),
  }
}
