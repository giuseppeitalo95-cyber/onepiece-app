import { createClient } from '@supabase/supabase-js'
import { ADMIN_ACCOUNT, isAdminAccount } from '@/lib/admin'
import { getPremiumTier } from '@/lib/premium'

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://jxwgbzatdueefdiyxlns.supabase.co'
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY

type ProfileRow = {
  id: string
  username?: string | null
  is_premium?: boolean | null
  premium_until?: string | null
  is_vip?: boolean | null
  last_seen_at?: string | null
}

type AnalyticsEventRow = {
  user_id: string
  event_type: string
  page_path?: string | null
  metadata?: Record<string, unknown> | null
  created_at: string
}

type ScanRow = {
  user_id: string
  day: string
  scan_count: number
}

const db = () => SERVICE_ROLE_KEY
  ? createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } })
  : null

const dayKey = (date: Date) =>
  `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`

const sinceDate = (days: number) => {
  const date = new Date()
  date.setUTCDate(date.getUTCDate() - days)
  return date
}

const increment = (map: Record<string, number>, key: string, amount = 1) => {
  map[key] = (map[key] || 0) + amount
}

export async function GET(request: Request) {
  const client = db()
  if (!client) return Response.json({ ok: false, error: 'Missing SUPABASE_SERVICE_ROLE_KEY' }, { status: 503 })

  const authHeader = request.headers.get('authorization') || ''
  const token = authHeader.replace(/^Bearer\s+/i, '')
  if (!token) return Response.json({ ok: false, error: 'Missing auth token' }, { status: 401 })

  const { data: { user }, error: userError } = await client.auth.getUser(token)
  if (userError || !user) return Response.json({ ok: false, error: 'Invalid session' }, { status: 401 })

  const { data: adminProfile } = await client
    .from('profiles')
    .select('username')
    .eq('id', user.id)
    .maybeSingle()

  if (!isAdminAccount(user, adminProfile)) {
    return Response.json({ ok: false, error: 'Forbidden' }, { status: 403 })
  }

  const days = Math.max(1, Math.min(90, Number(new URL(request.url).searchParams.get('days') || 14)))
  const since = sinceDate(days)
  const sinceIso = since.toISOString()
  const today = dayKey(new Date())

  const { data: profilesData, error: profilesError } = await client
    .from('profiles')
    .select('id, username, is_premium, premium_until, is_vip, last_seen_at')

  if (profilesError) return Response.json({ ok: false, error: profilesError.message }, { status: 500 })

  const profiles = (profilesData || []) as ProfileRow[]
  const profileById = new Map(profiles.map(profile => [profile.id, profile]))
  const tierCounts = { admin: 0, vip: 0, premium: 0, free: 0 }
  const activeToday = profiles.filter(profile =>
    profile.last_seen_at && profile.last_seen_at.slice(0, 10) === today
  ).length

  profiles.forEach(profile => {
    const tier = getPremiumTier(profile, { id: profile.id })
    tierCounts[tier] += 1
  })

  const { data: scanData } = await client
    .from('user_scan_usage_daily')
    .select('user_id, day, scan_count')
    .gte('day', dayKey(since))

  const scans = (scanData || []) as ScanRow[]

  const analyticsResult = await client
    .from('analytics_events')
    .select('user_id, event_type, page_path, metadata, created_at')
    .gte('created_at', sinceIso)
    .order('created_at', { ascending: false })
    .limit(5000)

  const analyticsReady = !analyticsResult.error
  const events = analyticsReady ? ((analyticsResult.data || []) as AnalyticsEventRow[]) : []

  const daily: Record<string, { pageViews: number; searches: number; scans: number; activeUsers: Set<string> }> = {}
  for (let offset = 0; offset <= days; offset += 1) {
    const date = new Date()
    date.setUTCDate(date.getUTCDate() - offset)
    daily[dayKey(date)] = { pageViews: 0, searches: 0, scans: 0, activeUsers: new Set() }
  }

  const pageViews: Record<string, number> = {}
  const eventCounts: Record<string, number> = {}
  const userStats = new Map<string, {
    userId: string
    username: string
    tier: string
    pageViews: number
    searches: number
    scans: number
    lastSeen: string | null
    topPage: Record<string, number>
  }>()

  const ensureUser = (userId: string) => {
    const profile = profileById.get(userId)
    const tier = getPremiumTier(profile, { id: userId })
    if (!userStats.has(userId)) {
      userStats.set(userId, {
        userId,
        username: profile?.username || (userId === ADMIN_ACCOUNT.id ? ADMIN_ACCOUNT.username : 'Utente'),
        tier,
        pageViews: 0,
        searches: 0,
        scans: 0,
        lastSeen: profile?.last_seen_at || null,
        topPage: {}
      })
    }
    return userStats.get(userId)!
  }

  events.forEach(event => {
    const key = dayKey(new Date(event.created_at))
    if (!daily[key]) daily[key] = { pageViews: 0, searches: 0, scans: 0, activeUsers: new Set() }
    daily[key].activeUsers.add(event.user_id)
    increment(eventCounts, event.event_type)

    const userItem = ensureUser(event.user_id)
    if (event.event_type === 'page_view') {
      daily[key].pageViews += 1
      userItem.pageViews += 1
      const page = event.page_path || '/'
      increment(pageViews, page)
      increment(userItem.topPage, page)
    }
    if (event.event_type === 'manual_search' || event.event_type === 'deck_search') {
      daily[key].searches += 1
      userItem.searches += 1
    }
  })

  scans.forEach(scan => {
    if (!daily[scan.day]) daily[scan.day] = { pageViews: 0, searches: 0, scans: 0, activeUsers: new Set() }
    daily[scan.day].scans += Number(scan.scan_count || 0)
    daily[scan.day].activeUsers.add(scan.user_id)
    ensureUser(scan.user_id).scans += Number(scan.scan_count || 0)
  })

  const daySeries = Object.entries(daily)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([day, value]) => ({
      day,
      pageViews: value.pageViews,
      searches: value.searches,
      scans: value.scans,
      activeUsers: value.activeUsers.size
    }))

  const topPages = Object.entries(pageViews)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([page, count]) => ({ page, count }))

  const topUsers = [...userStats.values()]
    .sort((a, b) => (b.pageViews + b.searches + b.scans) - (a.pageViews + a.searches + a.scans))
    .slice(0, 20)
    .map(item => ({
      ...item,
      topPage: Object.entries(item.topPage).sort((a, b) => b[1] - a[1])[0]?.[0] || '-'
    }))

  return Response.json({
    ok: true,
    days,
    analyticsReady,
    analyticsError: analyticsResult.error?.message || null,
    totals: {
      users: profiles.length,
      activeToday,
      vip: tierCounts.vip,
      premium: tierCounts.premium,
      admin: tierCounts.admin,
      free: tierCounts.free,
      pageViews: events.filter(event => event.event_type === 'page_view').length,
      manualSearches: events.filter(event => event.event_type === 'manual_search').length,
      deckSearches: events.filter(event => event.event_type === 'deck_search').length,
      scans: scans.reduce((sum, scan) => sum + Number(scan.scan_count || 0), 0)
    },
    tierCounts,
    eventCounts,
    daySeries,
    topPages,
    topUsers
  })
}
