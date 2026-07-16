export type BinderCard = {
  card_id: string
  name: string
  image_url: string | null
  rarity?: string | null
  card_color?: string | null
  card_cost?: number | null
  card_power?: number | null
}

export type BinderPage = {
  slots: Array<BinderCard | null>
}

export type BinderRecord = {
  id: string
  user_id: string
  title: string
  cover_color: string
  cover_image_url: string | null
  columns_count: number
  rows_count: number
  pages: BinderPage[]
  is_shared: boolean
  created_at?: string
  updated_at?: string
}

export const BINDER_COLORS = [
  '#164e63', '#0f4c5c', '#075985', '#1e3a8a',
  '#312e81', '#4c1d95', '#701a75', '#9f1239',
  '#7f1d1d', '#9a3412', '#854d0e', '#713f12',
  '#14532d', '#065f46', '#334155', '#18181b',
]

export const binderCapacity = (binder: Pick<BinderRecord, 'columns_count' | 'rows_count'>) =>
  binder.columns_count * binder.rows_count

export const normalizeBinderPages = (
  pages: unknown,
  columns: number,
  rows: number,
  minimumPages = 1
): BinderPage[] => {
  const capacity = columns * rows
  const input = Array.isArray(pages) ? pages : []
  const normalized: BinderPage[] = input.map(pageValue => {
    const page = pageValue && typeof pageValue === 'object' ? pageValue as Record<string, unknown> : {}
    const slots = Array.isArray(page.slots) ? page.slots : []
    return {
      slots: Array.from({ length: capacity }, (_, index) => {
        const cardValue = slots[index]
        if (!cardValue || typeof cardValue !== 'object') return null
        const card = cardValue as Record<string, unknown>
        if (!card.card_id) return null
        return {
          card_id: String(card.card_id),
          name: String(card.name || card.card_id),
          image_url: card.image_url ? String(card.image_url) : null,
          rarity: card.rarity ? String(card.rarity) : null,
          card_color: card.card_color ? String(card.card_color) : null,
          card_cost: card.card_cost == null || !Number.isFinite(Number(card.card_cost)) ? null : Number(card.card_cost),
          card_power: card.card_power == null || !Number.isFinite(Number(card.card_power)) ? null : Number(card.card_power),
        }
      })
    }
  })

  while (normalized.length < minimumPages) normalized.push({ slots: Array(capacity).fill(null) })
  return normalized
}

export const binderSpreadIndexes = (spreadIndex: number) => spreadIndex <= 0
  ? { left: null, right: 0 }
  : { left: spreadIndex * 2 - 1, right: spreadIndex * 2 }

export const binderMaxSpread = (pageCount: number) => Math.max(0, Math.ceil((Math.max(1, pageCount) - 1) / 2))

export const normalizeBinder = (value: unknown): BinderRecord => {
  const row = value && typeof value === 'object' ? value as Record<string, unknown> : {}
  const columns = Math.min(5, Math.max(2, Number(row.columns_count || 3)))
  const rows = Math.min(5, Math.max(2, Number(row.rows_count || 3)))
  return {
    id: String(row.id || ''),
    user_id: String(row.user_id || ''),
    title: String(row.title || 'Raccoglitore'),
    cover_color: String(row.cover_color || BINDER_COLORS[0]),
    cover_image_url: row.cover_image_url ? String(row.cover_image_url) : null,
    columns_count: columns,
    rows_count: rows,
    pages: normalizeBinderPages(row.pages, columns, rows),
    is_shared: Boolean(row.is_shared),
    created_at: row.created_at ? String(row.created_at) : undefined,
    updated_at: row.updated_at ? String(row.updated_at) : undefined,
  }
}
