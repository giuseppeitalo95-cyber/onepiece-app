export type DeckAvailabilityCard = {
  card_id: string
  quantity?: number | null
}

export type TrackedDeckAvailabilityCard = DeckAvailabilityCard & {
  owned_quantity?: number | null
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

const exactDeckCardId = (value?: string | null) =>
  (value || '').toLowerCase().replace(/[^a-z0-9_]/g, '')

export const reconcileDeckOwnedQuantities = <T extends TrackedDeckAvailabilityCard>(
  cards: T[],
  collectionCards: DeckAvailabilityCard[],
  { preserveManual = true }: { preserveManual?: boolean } = {},
): T[] => {
  const collectionByBase = buildOwnedQuantityByBase(collectionCards)
  const collectionByExact = collectionCards.reduce<Record<string, number>>((totals, card) => {
    const key = exactDeckCardId(card.card_id)
    if (key) totals[key] = (totals[key] || 0) + Math.max(0, Number(card.quantity || 0))
    return totals
  }, {})
  const indicesByBase = new Map<string, number[]>()
  cards.forEach((card, index) => {
    const key = baseDeckCardId(card.card_id)
    if (!key) return
    indicesByBase.set(key, [...(indicesByBase.get(key) || []), index])
  })

  const owned = new Array(cards.length).fill(0) as number[]
  for (const [baseId, indices] of indicesByBase) {
    const manuallyTracked = preserveManual
      ? indices.reduce((sum, index) => sum + Math.min(
        Math.max(0, Number(cards[index].quantity || 0)),
        Math.max(0, Number(cards[index].owned_quantity || 0)),
      ), 0)
      : 0
    const available = Math.max(collectionByBase[baseId] || 0, manuallyTracked)

    // Prefer the artwork actually owned, then use the remaining copies as the
    // same playable card. Alternative arts share the card-code copy pool.
    let assigned = 0
    const remainingByExact = { ...collectionByExact }
    for (const index of indices) {
      const required = Math.max(0, Number(cards[index].quantity || 0))
      const exactId = exactDeckCardId(cards[index].card_id)
      const exactOwned = Math.max(0, remainingByExact[exactId] || 0)
      const exactAssigned = Math.min(required, exactOwned)
      owned[index] = exactAssigned
      remainingByExact[exactId] = exactOwned - exactAssigned
      assigned += exactAssigned
    }

    let remaining = Math.max(0, available - assigned)
    for (const index of indices) {
      if (remaining <= 0) break
      const required = Math.max(0, Number(cards[index].quantity || 0))
      const extra = Math.min(Math.max(0, required - owned[index]), remaining)
      owned[index] += extra
      remaining -= extra
    }
  }

  return cards.map((card, index) => ({ ...card, owned_quantity: owned[index] || 0 }))
}

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
