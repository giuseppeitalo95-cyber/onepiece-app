import { createClient } from '@supabase/supabase-js'
import { ADMIN_ACCOUNT, isAdminAccount } from '@/lib/admin'

export const dynamic = 'force-dynamic'

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://jxwgbzatdueefdiyxlns.supabase.co'
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY

const db = () => SERVICE_ROLE_KEY
  ? createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } })
  : null

const currentMonthKey = () => {
  const now = new Date()
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`
}

const countTable = async (client: NonNullable<ReturnType<typeof db>>, table: string) => {
  const { count, error } = await client
    .from(table)
    .select('*', { count: 'exact', head: true })

  return {
    count: count || 0,
    error: error?.message || null
  }
}

export async function GET(request: Request) {
  const client = db()
  if (!client) return Response.json({ ok: false, error: 'Missing SUPABASE_SERVICE_ROLE_KEY' }, { status: 500 })

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

  const month = currentMonthKey()
  const [
    profiles,
    cards,
    decks,
    analytics,
    chat,
    pushSubscriptions,
    boardPosts,
    bugReports,
    cardmarketPrices,
    scanUsage,
    latestPriceSync
  ] = await Promise.all([
    countTable(client, 'profiles'),
    countTable(client, 'user_cards'),
    countTable(client, 'user_decks'),
    countTable(client, 'analytics_events'),
    countTable(client, 'chat_messages'),
    countTable(client, 'push_subscriptions'),
    countTable(client, 'board_posts'),
    countTable(client, 'bug_reports'),
    countTable(client, 'cardmarket_prices'),
    client
      .from('scan_usage_global')
      .select('scan_count')
      .eq('month', month)
      .maybeSingle(),
    client
      .from('cardmarket_prices')
      .select('synced_at')
      .order('synced_at', { ascending: false })
      .limit(1)
      .maybeSingle()
  ])

  return Response.json({
    ok: true,
    month,
    tables: {
      profiles,
      userCards: cards,
      userDecks: decks,
      analyticsEvents: analytics,
      chatMessages: chat,
      pushSubscriptions,
      boardPosts,
      bugReports,
      cardmarketPrices
    },
    scans: {
      used: Number(scanUsage.data?.scan_count || 0),
      limit: 1000,
      error: scanUsage.error?.message || null
    },
    prices: {
      latestSync: latestPriceSync.data?.synced_at || null,
      error: latestPriceSync.error?.message || null
    },
    config: {
      serviceRoleConfigured: Boolean(SERVICE_ROLE_KEY),
      cronSecretConfigured: Boolean(process.env.CRON_SECRET),
      cardmarketSyncSecretConfigured: Boolean(process.env.CARDMARKET_SYNC_SECRET),
      maintenanceSecretConfigured: Boolean(process.env.MAINTENANCE_SECRET),
      analyticsRetentionDays: Math.max(30, Number(process.env.ANALYTICS_RETENTION_DAYS || 180)),
      adminId: ADMIN_ACCOUNT.id
    }
  })
}
