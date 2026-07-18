export type BinderKit = {
  id: string
  title: string
  closed_url: string
  open_url: string
  left_url: string
  right_url: string
  created_at?: string
  updated_at?: string
}

const KIT_PREFIX = 'opv-kit:'

export const encodeBinderKit = (kit: BinderKit) =>
  `${KIT_PREFIX}${encodeURIComponent(JSON.stringify({
    id: kit.id,
    title: kit.title,
    closed_url: kit.closed_url,
    open_url: kit.open_url,
    left_url: kit.left_url,
    right_url: kit.right_url,
  }))}`

export const decodeBinderKit = (value?: string | null): BinderKit | null => {
  if (!value?.startsWith(KIT_PREFIX)) return null
  try {
    const kit = JSON.parse(decodeURIComponent(value.slice(KIT_PREFIX.length))) as BinderKit
    return kit?.id && kit.closed_url && kit.open_url && kit.left_url && kit.right_url ? kit : null
  } catch {
    return null
  }
}

export const binderClosedImage = (value?: string | null) => decodeBinderKit(value)?.closed_url || value || null
export const binderOpenImage = (value?: string | null) => decodeBinderKit(value)?.open_url || value || null
export const binderHalfImage = (value: string | null | undefined, side: 'left' | 'right') => {
  const kit = decodeBinderKit(value)
  return kit ? (side === 'left' ? kit.left_url : kit.right_url) : value || null
}

export const loadBinderKits = async (): Promise<BinderKit[]> => {
  const response = await fetch('/api/binder-kits', { cache: 'no-store' })
  const data = await response.json().catch(() => null)
  return response.ok && Array.isArray(data?.kits) ? data.kits : []
}
