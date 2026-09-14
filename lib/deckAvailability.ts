export type DeckAvailabilityCard = {
  card_id: string
  quantity?: number | null
}

export const baseDeckCardId = (value?: string | null) => {
  const raw = (value || '').toLowerCase().replace(/[^a-z0-9_]/g, '')
  const withoutUnderscoreVariant = raw.replace(/_[pr]\d+$/i, '')
  return withoutUnderscoreVariant
    .replace(/[^a-z0-9]/g, '')
    .replace(/^((?:op|st|eb|prb|sp|ex|cp)\d{5,6}|p\d{3}|don\d{3})p\d+$/i, '$1')
}

export const buildOwnedQuantityByBase = (cards: DeckAvailabilityCard[]) =>
  cards.reduce<Record<string, number>>((totals, card) => {
    const key = baseDeckCardId(card.card_id)
    if (key) totals[key] = (totals[key] || 0) + Math.max(0, Number(card.quantity || 0))
    return totals
  }, {})

export const summarizeDeckAvailability = (
  leader: DeckAvailabilityCard | null,
  cards: DeckAvailabilityCard[],
  ownedQuantityByBase: Record<string, number>,
) => {
  const requirements = new Map<string, number>()
  if (leader) requirements.set(baseDeckCardId(leader.card_id), 1)
  for (const card of cards) {
    const key = baseDeckCardId(card.card_id)
    requirements.set(key, (requirements.get(key) || 0) + Math.max(0, Number(card.quantity || 0)))
  }

  let required = 0
  let covered = 0
  let missing = 0
  let missingTypes = 0
  for (const [key, quantity] of requirements) {
    const owned = ownedQuantityByBase[key] || 0
    required += quantity
    covered += Math.min(quantity, owned)
    if (owned < quantity) {
      missing += quantity - owned
      missingTypes += 1
    }
  }

  return { required, covered, missing, missingTypes, complete: required === 51 && missing === 0 }
}
