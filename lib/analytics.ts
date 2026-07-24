import { supabase } from './supabase'

type AnalyticsEventType =
  | 'page_view'
  | 'manual_search'
  | 'scan_open'
  | 'scan_result'
  | 'deck_search'
  | 'board_post'

const recentEvents = new Map<string, number>()
const MAX_RECENT_EVENTS = 200

export const trackAnalyticsEvent = async (
  eventType: AnalyticsEventType,
  metadata: Record<string, unknown> = {},
  pagePath?: string
) => {
  try {
    const path = pagePath || (typeof window !== 'undefined' ? window.location.pathname : '')
    const key = `${eventType}:${path}:${JSON.stringify(metadata).slice(0, 120)}`
    const now = Date.now()
    const minimumInterval = eventType === 'page_view' ? 60_000 : 5_000
    const previousAt = recentEvents.get(key) || 0

    if (now - previousAt < minimumInterval) return
    recentEvents.set(key, now)
    if (recentEvents.size > MAX_RECENT_EVENTS) {
      for (const [eventKey, eventAt] of recentEvents) {
        if (now - eventAt > 60_000 || recentEvents.size > MAX_RECENT_EVENTS) recentEvents.delete(eventKey)
        if (recentEvents.size <= MAX_RECENT_EVENTS) break
      }
    }

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
