import { ADMIN_ACCOUNT, isAdminAccount } from '@/lib/admin'
import { readCatalogSyncState } from '@/lib/cardCatalogSync'
import { getR2Status, isR2Configured } from '@/lib/r2Storage'
import { createServiceClient } from '@/lib/serverSupabase'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

type ServiceState = 'online' | 'degraded' | 'offline'

type ServiceStatus = {
  key: string
  label: string
  status: ServiceState
  message: string
  latencyMs?: number | null
  updatedAt?: string | null
}

const currentMonthKey = () => {
  const now = new Date()
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`
}

const countTable = async (client: NonNullable<ReturnType<typeof createServiceClient>>, table: string) => {
  const { count, error } = await client.from(table).select('*', { count: 'exact', head: true })
  return { count: count || 0, error: error?.message || null }
}

const probeUrl = async (url: string, init: RequestInit = {}) => {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 8_000)
  const startedAt = Date.now()
  try {
    const response = await fetch(url, {
      ...init,
      signal: controller.signal,
      cache: 'no-store',
      headers: { 'User-Agent': 'OnePieceVault-Status/1.0', ...(init.headers || {}) },
    })
    return { online: response.status < 500, status: response.status, latencyMs: Date.now() - startedAt, response }
  } catch (error) {
    return {
      online: false,
      status: 0,
      latencyMs: Date.now() - startedAt,
      response: null,
      error: error instanceof Error ? error.message : 'Servizio non raggiungibile',
    }
  } finally {
    clearTimeout(timeout)
  }
}

const isFresh = (value: string | null | undefined, hours: number) => {
  if (!value) return false
  return Date.now() - new Date(value).getTime() <= hours * 60 * 60 * 1000
}

const providerState = (indicator?: string | null): ServiceState => {
  if (!indicator || indicator === 'none') return 'online'
  if (indicator === 'critical' || indicator === 'major') return 'offline'
  return 'degraded'
}

const providerMessage = (description?: string | null) => {
  if (!description) return 'Stato globale non disponibile'
  if (description === 'All Systems Operational') return 'Tutti i sistemi operativi'
  if (description === 'Minor Service Outage') return 'Disservizio minore segnalato'
  if (description === 'Partial System Outage') return 'Disservizio parziale segnalato'
  if (description === 'Major Service Outage') return 'Disservizio importante segnalato'
  return description
}

export async function GET(request: Request) {
  const client = createServiceClient()
  if (!client) return Response.json({ ok: false, error: 'Missing SUPABASE_SERVICE_ROLE_KEY' }, { status: 500 })

  const token = (request.headers.get('authorization') || '').replace(/^Bearer\s+/i, '')
  if (!token) return Response.json({ ok: false, error: 'Missing auth token' }, { status: 401 })

  const { data: { user }, error: userError } = await client.auth.getUser(token)
  if (userError || !user) return Response.json({ ok: false, error: 'Invalid session' }, { status: 401 })

  const { data: adminProfile } = await client.from('profiles').select('username').eq('id', user.id).maybeSingle()
  if (!isAdminAccount(user, adminProfile)) return Response.json({ ok: false, error: 'Forbidden' }, { status: 403 })

  const month = currentMonthKey()
  const startedSupabase = Date.now()
  const profiles = await countTable(client, 'profiles')
  const supabaseLatencyMs = Date.now() - startedSupabase
  const [
    cards,
    decks,
    analytics,
    chat,
    pushSubscriptions,
    boardPosts,
    bugReports,
    cardmarketPrices,
    catalogCards,
    catalogSources,
    scanUsage,
    latestPriceSync,
    catalogState,
    r2,
    optcgProbe,
    officialProbe,
    visionProbe,
    supabasePageProbe,
    cloudflarePageProbe,
    vercelPageProbe,
    githubPageProbe,
  ] = await Promise.all([
    countTable(client, 'user_cards'),
    countTable(client, 'user_decks'),
    countTable(client, 'analytics_events'),
    countTable(client, 'chat_messages'),
    countTable(client, 'push_subscriptions'),
    countTable(client, 'board_posts'),
    countTable(client, 'bug_reports'),
    countTable(client, 'cardmarket_prices'),
    countTable(client, 'card_catalog'),
    countTable(client, 'card_catalog_sources'),
    client.from('scan_usage_global').select('scan_count').eq('month', month).maybeSingle(),
    client.from('cardmarket_prices').select('synced_at').order('synced_at', { ascending: false }).limit(1).maybeSingle(),
    readCatalogSyncState().catch(() => null),
    getR2Status(),
    probeUrl('https://www.optcgapi.com/api/sets/card/OP01-001/'),
    probeUrl('https://en.onepiece-cardgame.com/cardlist/', { method: 'HEAD' }),
    probeUrl('https://vision.googleapis.com/$discovery/rest?version=v1'),
    probeUrl('https://status.supabase.com/api/v2/status.json'),
    probeUrl('https://www.cloudflarestatus.com/api/v2/status.json'),
    probeUrl('https://www.vercel-status.com/api/v2/status.json'),
    probeUrl('https://www.githubstatus.com/api/v2/status.json'),
  ])

  const [supabasePage, cloudflarePage, vercelPage, githubPage] = await Promise.all([
    supabasePageProbe.response?.json().catch(() => null),
    cloudflarePageProbe.response?.json().catch(() => null),
    vercelPageProbe.response?.json().catch(() => null),
    githubPageProbe.response?.json().catch(() => null),
  ])
  const supabaseProviderState = supabasePageProbe.online ? providerState(supabasePage?.status?.indicator) : 'degraded'
  const cloudflareProviderState = cloudflarePageProbe.online ? providerState(cloudflarePage?.status?.indicator) : 'degraded'
  const vercelProviderState = vercelPageProbe.online ? providerState(vercelPage?.status?.indicator) : 'degraded'
  const githubProviderState = githubPageProbe.online ? providerState(githubPage?.status?.indicator) : 'degraded'

  const githubOwner = process.env.VERCEL_GIT_REPO_OWNER || 'giuseppeitalo95-cyber'
  const githubRepo = process.env.VERCEL_GIT_REPO_SLUG || 'onepiece-app'
  const githubBranch = process.env.VERCEL_GIT_COMMIT_REF || 'main'
  const githubProbe = await probeUrl(`https://api.github.com/repos/${githubOwner}/${githubRepo}/commits/${githubBranch}`, {
    headers: { Accept: 'application/vnd.github+json' },
  })
  const githubPayload = githubProbe.response ? await githubProbe.response.json().catch(() => null) : null
  const githubSha = typeof githubPayload?.sha === 'string' ? githubPayload.sha : null
  const deployedSha = process.env.VERCEL_GIT_COMMIT_SHA || null
  const deployMatchesGitHub = Boolean(!githubSha || !deployedSha || githubSha.startsWith(deployedSha) || deployedSha.startsWith(githubSha))
  const githubPubliclyReadable = githubProbe.status === 200

  const latestCatalogSync = catalogState?.last_catalog_sync_at || null
  const latestPriceSyncAt = latestPriceSync.data?.synced_at || null
  const catalogApisOnline = optcgProbe.online && officialProbe.online
  const services: ServiceStatus[] = [
    {
      key: 'supabase',
      label: 'Supabase',
      status: profiles.error || supabaseProviderState === 'offline' ? 'offline' : catalogCards.error || supabaseProviderState === 'degraded' ? 'degraded' : 'online',
      message: profiles.error || catalogCards.error || `${providerMessage(supabasePage?.status?.description)} · ${profiles.count} utenti, ${catalogCards.count} carte catalogo`,
      latencyMs: supabaseLatencyMs,
    },
    {
      key: 'cloudflare',
      label: 'Cloudflare R2',
      status: !r2.online || cloudflareProviderState === 'offline' ? 'offline' : cloudflareProviderState === 'degraded' || r2.bytes >= r2.limitBytes * 0.9 ? 'degraded' : 'online',
      message: r2.error || `${providerMessage(cloudflarePage?.status?.description)} · ${r2.objects} immagini archiviate`,
      latencyMs: r2.latencyMs,
    },
    {
      key: 'vercel',
      label: 'Vercel',
      status: vercelProviderState === 'offline' ? 'offline' : !process.env.VERCEL || vercelProviderState === 'degraded' ? 'degraded' : 'online',
      message: process.env.VERCEL ? `${providerMessage(vercelPage?.status?.description)} · deployment ${deployedSha?.slice(0, 7) || 'attivo'}` : 'Ambiente locale',
      updatedAt: process.env.VERCEL_ENV || null,
    },
    {
      key: 'github',
      label: 'GitHub',
      status: !githubProbe.online || githubProviderState === 'offline' ? 'offline' : githubProviderState === 'online' && githubPubliclyReadable && deployMatchesGitHub ? 'online' : 'degraded',
      message: !githubProbe.online
        ? `GitHub HTTP ${githubProbe.status || 'errore'}`
        : !githubPubliclyReadable
          ? `${providerMessage(githubPage?.status?.description)} · repository collegato a Vercel ma non verificabile pubblicamente`
          : deployMatchesGitHub
            ? `${providerMessage(githubPage?.status?.description)} · branch ${githubBranch} allineato`
            : 'GitHub contiene modifiche non ancora in produzione',
      latencyMs: githubProbe.latencyMs,
      updatedAt: githubSha?.slice(0, 7) || null,
    },
    {
      key: 'card-apis',
      label: 'API catalogo carte',
      status: !catalogApisOnline ? 'offline' : isFresh(latestCatalogSync, 36) ? 'online' : 'degraded',
      message: !catalogApisOnline ? `OPTCG ${optcgProbe.status || 'KO'} / Official ${officialProbe.status || 'KO'}` : isFresh(latestCatalogSync, 36) ? 'Fonti online e catalogo aggiornato' : 'Fonti online, sincronizzazione catalogo da aggiornare',
      latencyMs: Math.max(optcgProbe.latencyMs, officialProbe.latencyMs),
      updatedAt: latestCatalogSync,
    },
    {
      key: 'vision',
      label: 'Google Vision',
      status: !process.env.GOOGLE_VISION_API_KEY ? 'offline' : visionProbe.online ? 'online' : 'degraded',
      message: !process.env.GOOGLE_VISION_API_KEY ? 'Chiave API mancante' : visionProbe.online ? 'API raggiungibile e chiave configurata' : 'Chiave presente, endpoint non raggiungibile',
      latencyMs: visionProbe.latencyMs,
    },
    {
      key: 'cardmarket',
      label: 'Prezzi',
      status: !latestPriceSyncAt ? 'offline' : isFresh(latestPriceSyncAt, 36) ? 'online' : 'degraded',
      message: !latestPriceSyncAt ? 'Nessun prezzo sincronizzato' : isFresh(latestPriceSyncAt, 36) ? 'Database prezzi aggiornato' : 'Aggiornamento prezzi in ritardo',
      updatedAt: latestPriceSyncAt,
    },
  ]

  return Response.json({
    ok: true,
    month,
    checkedAt: new Date().toISOString(),
    services,
    tables: {
      profiles,
      userCards: cards,
      userDecks: decks,
      analyticsEvents: analytics,
      chatMessages: chat,
      pushSubscriptions,
      boardPosts,
      bugReports,
      cardmarketPrices,
      catalogCards,
      catalogSources,
    },
    scans: {
      used: Number(scanUsage.data?.scan_count || 0),
      limit: 1000,
      error: scanUsage.error?.message || null,
    },
    prices: { latestSync: latestPriceSyncAt, error: latestPriceSync.error?.message || null },
    catalog: catalogState,
    r2,
    config: {
      serviceRoleConfigured: Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY),
      cronSecretConfigured: Boolean(process.env.CRON_SECRET),
      cardmarketSyncSecretConfigured: Boolean(process.env.CARDMARKET_SYNC_SECRET),
      maintenanceSecretConfigured: Boolean(process.env.MAINTENANCE_SECRET),
      r2Configured: isR2Configured(),
      analyticsRetentionDays: Math.max(30, Number(process.env.ANALYTICS_RETENTION_DAYS || 180)),
      adminId: ADMIN_ACCOUNT.id,
    },
  })
}
