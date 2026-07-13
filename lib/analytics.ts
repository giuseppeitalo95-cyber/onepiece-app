import { supabase } from './supabase'

type AnalyticsEventType =
  | 'page_view'
  | 'manual_search'
  | 'scan_open'
  | 'scan_result'
  | 'deck_search'
  | 'board_post'

let lastEventKey = ''
let lastEventAt = 0

export const trackAnalyticsEvent = async (
  eventType: AnalyticsEventType,
  metadata: Record<string, unknown> = {},
  pagePath?: string
) => {
  try {
    const path = pagePath || (typeof window !== 'undefined' ? window.location.pathname : '')
    const key = `${eventType}:${path}:${JSON.stringify(metadata).slice(0, 120)}`
    const now = Date.now()

    if (key === lastEventKey && now - lastEventAt < 5000) return
    lastEventKey = key
    lastEventAt = now

    const { data: { session } } = await supabase.auth.getSession()
    if (!session?.access_token) return

    await fetch('/api/analytics/track', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${session.access_token}`
      },
      body: JSON.stringify({
        eventType,
        pagePath: path,
        metadata
      })
    }).catch(() => undefined)
  } catch {
  }
}
