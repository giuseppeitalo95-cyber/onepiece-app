import { baseDeckCardId } from './deckAvailability'

export const DECK_SIZE = 50
export const STANDARD_COPY_LIMIT = 4

// The printed rule on OP16-042 explicitly overrides the normal four-copy limit.
const UNLIMITED_COPY_CARD_IDS = new Set(['op16042'])

export const hasUnlimitedDeckCopies = (cardId?: string | null) =>
  UNLIMITED_COPY_CARD_IDS.has(baseDeckCardId(cardId))

export const maxDeckCopies = (cardId?: string | null) =>
  hasUnlimitedDeckCopies(cardId) ? DECK_SIZE : STANDARD_COPY_LIMIT
