'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { ShieldCheck, ArrowLeft, Bug, CheckCircle2, Trash2, RotateCcw, BarChart3, Activity, BookOpen, Database, ChevronRight, Eraser, Info, Megaphone, MessageCircle, Search, Send, Settings, Users, Wrench } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { ADMIN_ACCOUNT, isAdminAccount } from '@/lib/admin'
import { getDailyRewardVipUntil } from '@/lib/premium'
import CatalogCardManager from './CatalogCardManager'
import BinderKitManager from './BinderKitManager'
import AdminDatabaseManager from './AdminDatabaseManager'

type ProfileItem = {
  id: string
  username: string | null
  username_locked?: boolean
  username_changed_at?: string | null
  username_change_credits?: number
  is_blocked?: boolean
  is_premium?: boolean
  is_vip?: boolean
  vip_note?: string | null
  vip_since?: string | null
}

type MissingCardRequest = {
  id: number
  card_name: string
  card_op: string
  card_number: string
  card_code?: string | null
  card_variant?: string | null
  description?: string | null
  status?: string
  reported_by?: string
  reporter_username?: string | null
  created_at?: string
}

type ScanUsage = {
  month?: string
  scansUsed: number
  scansLimit: number
  error?: string
}

type PriceSyncResult = {
  ok?: boolean
  updated?: number
  matched?: number
  skipped?: number
  syncedAt?: string
  error?: string
}

type BugReport = {
  id: string
  reporter_id?: string | null
  reporter_email?: string | null
  reporter_username?: string | null
  page_path?: string | null
  title?: string | null
  message: string
  user_agent?: string | null
  status: string
  resolved_at?: string | null
  created_at: string
  updated_at?: string | null
}

type AnnouncementItem = {
  id: string
  title: string
  message: string
  is_active: boolean
  published_at: string
  created_at: string
  updated_at?: string | null
  read_count: number
}

type CatalogSyncResult = {
  ok?: boolean
  fetched?: number
  sourceRows?: number
  catalogRows?: number
  processed?: number
  ready?: number
  failed?: number
  blocked?: number
  remaining?: number
  syncedAt?: string
  error?: string
}

type AdminAnalytics = {
  ok?: boolean
  days?: number
  analyticsReady?: boolean
  analyticsError?: string | null
  totals?: {
    users: number
    activeToday: number
    vip: number
    premium: number
    admin: number
    free: number
    pageViews: number
    manualSearches: number
    deckSearches: number
    scans: number
  }
  daySeries?: Array<{
    day: string
    pageViews: number
    searches: number
    scans: number
    activeUsers: number
  }>
  topPages?: Array<{ page: string; count: number }>
  topUsers?: Array<{
    userId: string
    username: string
    tier: string
    pageViews: number
    searches: number
    scans: number
    lastSeen: string | null
    topPage: string
  }>
}

type SystemHealth = {
  ok?: boolean
  month?: string
  checkedAt?: string
  services?: Array<{
    key: string
    label: string
    status: 'online' | 'degraded' | 'offline'
    message: string
    latencyMs?: number | null
    updatedAt?: string | null
  }>
  tables?: Record<string, { count: number; error?: string | null }>
  scans?: { used: number; limit: number; error?: string | null }
  prices?: { latestSync?: string | null; error?: string | null }
  catalog?: {
    source_rows?: number
    catalog_rows?: number
    image_ready?: number
    image_failed?: number
    image_pending?: number
    r2_bytes?: number
    last_catalog_sync_at?: string | null
    last_image_sync_at?: string | null
    last_error?: string | null
  } | null
  r2?: {
    configured: boolean
    online: boolean
    bucket?: string
    objects: number
    bytes: number
    limitBytes: number
    freeTierBytes: number
    latencyMs?: number
    error?: string | null
  }
  config?: {
    serviceRoleConfigured: boolean
    cronSecretConfigured: boolean
    cardmarketSyncSecretConfigured: boolean
    maintenanceSecretConfigured: boolean
    r2Configured: boolean
    analyticsRetentionDays: number
  }
  error?: string
}

const analyticsRanges = [
  { key: '24h', label: '24H', description: 'ultime 24 ore', days: 1 },
  { key: 'week', label: 'Settimana', description: 'ultima settimana', days: 7 },
  { key: 'month', label: 'Mese', description: 'ultimo mese', days: 30 },
  { key: 'year', label: 'Anno', description: 'ultimo anno', days: 365 },
] as const

type AnalyticsRangeKey = typeof analyticsRanges[number]['key']

const chartGranularities = [
  { key: 'daily', label: 'Giornaliero' },
  { key: 'weekly', label: 'Settimanale' },
  { key: 'monthly', label: 'Mensile' },
  { key: 'yearly', label: 'Annuale' },
] as const

type ChartGranularityKey = typeof chartGranularities[number]['key']

type AdminSection = 'home' | 'announcements' | 'reports' | 'catalog' | 'binderKits' | 'data' | 'analytics' | 'services' | 'status' | 'users' | 'cleanup' | 'info'

const formatBytes = (bytes?: number | null) => {
  const value = Number(bytes || 0)
  if (value < 1_000_000) return `${(value / 1_000).toFixed(value > 10_000 ? 0 : 1)} KB`
  if (value < 1_000_000_000) return `${(value / 1_000_000).toFixed(1)} MB`
  return `${(value / 1_000_000_000).toFixed(2)} GB`
}

type CleanupAction = {
  key: string
  title: string
  description: string
  needsUser?: boolean
  tone?: 'danger' | 'warning'
}

const cleanupActions: CleanupAction[] = [
  { key: 'expired_data', title: 'Pulisci dati scaduti', description: 'Elimina chat più vecchie di 24 ore e analytics oltre la retention.', tone: 'warning' },
  { key: 'board_all', title: 'Svuota bacheca', description: 'Elimina definitivamente tutti gli annunci pubblicati.' },
  { key: 'chats_all', title: 'Svuota tutte le chat', description: 'Elimina definitivamente tutti i messaggi di ogni utente.' },
  { key: 'chats_user', title: 'Svuota chat di un utente', description: 'Elimina tutti i messaggi inviati o ricevuti dall’utente selezionato.', needsUser: true },
  { key: 'daily_scans_user', title: 'Azzera scan giornalieri utente', description: 'Ripristina solo il limite giornaliero dell’utente selezionato.', needsUser: true, tone: 'warning' },
  { key: 'analytics_all', title: 'Svuota analytics', description: 'Elimina lo storico di utilizzo e i dati dei grafici.' },
  { key: 'bug_reports', title: 'Svuota segnalazioni bug', description: 'Elimina tutte le segnalazioni bug dal database.' },
  { key: 'resolved_card_reports', title: 'Elimina richieste carte risolte', description: 'Conserva le richieste aperte ed elimina solo quelle risolte.', tone: 'warning' },
]

export default function AdminPage() {
  const router = useRouter()
  const [loading, setLoading] = useState(true)
  const [profiles, setProfiles] = useState<ProfileItem[]>([])
  const [requests, setRequests] = useState<MissingCardRequest[]>([])
  const [actionMessage, setActionMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const [scanUsage, setScanUsage] = useState<ScanUsage | null>(null)
  const [priceSyncing, setPriceSyncing] = useState(false)
  const [priceSyncResult, setPriceSyncResult] = useState<PriceSyncResult | null>(null)
  const [catalogSyncing, setCatalogSyncing] = useState<'catalog' | 'images' | ''>('')
  const [catalogSyncResult, setCatalogSyncResult] = useState<CatalogSyncResult | null>(null)
  const [bugReports, setBugReports] = useState<BugReport[]>([])
  const [analyticsOpen, setAnalyticsOpen] = useState(false)
  const [analyticsLoading, setAnalyticsLoading] = useState(false)
  const [analytics, setAnalytics] = useState<AdminAnalytics | null>(null)
  const [analyticsRange, setAnalyticsRange] = useState<AnalyticsRangeKey>('week')
  const [chartGranularity, setChartGranularity] = useState<ChartGranularityKey>('daily')
  const [systemHealth, setSystemHealth] = useState<SystemHealth | null>(null)
  const [systemHealthLoading, setSystemHealthLoading] = useState(false)
  const [activeSection, setActiveSection] = useState<AdminSection>('home')
  const [cleanupConfirmation, setCleanupConfirmation] = useState('')
  const [cleanupUserId, setCleanupUserId] = useState('')
  const [cleanupBusyKey, setCleanupBusyKey] = useState('')
  const [userSearch, setUserSearch] = useState('')
  const [announcements, setAnnouncements] = useState<AnnouncementItem[]>([])
  const [announcementTitle, setAnnouncementTitle] = useState('')
  const [announcementMessage, setAnnouncementMessage] = useState('')
  const [announcementLoading, setAnnouncementLoading] = useState(false)
  const [announcementBusyId, setAnnouncementBusyId] = useState('')

  const filteredProfiles = useMemo(() => {
    const query = userSearch.trim().toLocaleLowerCase('it-IT')
    if (!query) return profiles
    return profiles.filter(profile =>
      profile.username?.toLocaleLowerCase('it-IT').includes(query) || profile.id.toLowerCase().includes(query)
    )
  }, [profiles, userSearch])


  const refreshData = async () => {
    await Promise.all([fetchProfiles(), fetchRequests(), fetchScanUsage(), fetchBugReports(), fetchAnnouncements()])
  }

  const openSection = (section: AdminSection) => {
    setActiveSection(section)

    if (section === 'services' || section === 'status' || section === 'info') {
      void fetchSystemHealth()
    }
    if (section === 'services') void fetchScanUsage()
    if (section === 'reports') void Promise.all([fetchRequests(), fetchBugReports()])
    if (section === 'announcements') void fetchAnnouncements()
    if (section === 'users' || section === 'cleanup') void fetchProfiles()
  }

  const syncPricesNow = async () => {
    if (priceSyncing) return

    setPriceSyncing(true)
    setPriceSyncResult(null)
    setActionMessage('Aggiornamento prezzi in corso...')

    try {
      const token = await getAccessToken()
      const res = await fetch('/api/cardmarket/sync', {
        method: 'POST',
        headers: token ? { Authorization: `Bearer ${token}` } : {}
      })
      const data = await res.json()
      setPriceSyncResult(data)

      if (!res.ok || !data?.ok) {
        setActionMessage(`Aggiornamento prezzi fallito: ${data?.error || 'errore sconosciuto'}`)
      } else {
        setActionMessage('Prezzi aggiornati correttamente.')
      }
    } catch {
      setPriceSyncResult({ ok: false, error: 'Impossibile avviare il sync prezzi.' })
      setActionMessage('Impossibile avviare il sync prezzi.')
    }

    setPriceSyncing(false)
  }

  const syncCatalogNow = async (mode: 'catalog' | 'images', migrateAll = false) => {
    if (catalogSyncing) return
    setCatalogSyncing(mode)
    setCatalogSyncResult(null)
    setActionMessage(mode === 'catalog' ? 'Sincronizzazione catalogo in corso...' : 'Copia immagini su Cloudflare in corso...')

    try {
      const token = await getAccessToken()
      let totalReady = 0
      let totalFailed = 0
      let rounds = 0
      let data: CatalogSyncResult = {}
      let responseOk = true

      do {
        const res = await fetch('/api/cards/catalog-sync', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
          body: JSON.stringify({
            mode,
            limit: mode === 'images' ? 16 : 80,
            resetFailed: mode === 'images' && migrateAll && rounds === 0,
          }),
        })
        const responseBody = await res.text()
        try {
          data = responseBody ? JSON.parse(responseBody) : {}
        } catch {
          data = { ok: false, error: `Errore server HTTP ${res.status}` }
        }
        responseOk = res.ok && data?.ok !== false
        totalReady += Number(data.ready || 0)
        totalFailed += Number(data.failed || 0)
        rounds += 1
        setCatalogSyncResult({ ...data, ready: totalReady, failed: totalFailed })
        if (mode === 'images') {
          setActionMessage(`Migrazione immagini: ${totalReady} copiate, ${data.remaining || 0} restanti.`)
        }
        if (!responseOk || mode !== 'images' || !migrateAll || !data.processed || !data.remaining || data.blocked) break
      } while (rounds < 400)

      setActionMessage(responseOk
        ? mode === 'catalog'
          ? `Catalogo aggiornato: ${data.catalogRows || 0} carte.`
          : `Immagini copiate: ${totalReady}. Restanti: ${data.remaining || 0}.`
        : data?.error || 'Sincronizzazione catalogo fallita.')
      await fetchSystemHealth()
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Impossibile avviare la sincronizzazione.'
      setCatalogSyncResult({ ok: false, error: message })
      setActionMessage(`Sincronizzazione interrotta: ${message}`)
    }

    setCatalogSyncing('')
  }

  const fetchScanUsage = async () => {
    try {
      const res = await fetch('/api/cards/ocr')
      const data = await res.json()
      setScanUsage({
        month: data?.month,
        scansUsed: Number(data?.scansUsed || 0),
        scansLimit: Number(data?.scansLimit || 1000),
        error: data?.error
      })
    } catch {
      setScanUsage({
        scansUsed: 0,
        scansLimit: 1000,
        error: 'Impossibile leggere il contatore Google Vision.'
      })
    }
  }

  const getAccessToken = async () => {
    const { data: { session } } = await supabase.auth.getSession()
    return session?.access_token || ''
  }

  const fetchAnnouncements = async () => {
    const token = await getAccessToken()
    if (!token) return
    setAnnouncementLoading(true)
    const response = await fetch('/api/announcements?admin=1', {
      cache: 'no-store',
      headers: { Authorization: `Bearer ${token}` }
    }).catch(() => null)
    const data = await response?.json().catch(() => null)
    if (response?.ok && data?.ok) {
      setAnnouncements(data.announcements || [])
    } else if (data?.error) {
      setActionMessage(data.error)
    }
    setAnnouncementLoading(false)
  }

  const publishAnnouncement = async () => {
    const title = announcementTitle.trim()
    const message = announcementMessage.trim()
    if (title.length < 3 || message.length < 5 || announcementLoading) return

    const token = await getAccessToken()
    if (!token) return
    setAnnouncementLoading(true)
    setActionMessage('')
    const response = await fetch('/api/announcements', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`
      },
      body: JSON.stringify({ title, message })
    }).catch(() => null)
    const data = await response?.json().catch(() => null)

    if (response?.ok && data?.ok) {
      setAnnouncementTitle('')
      setAnnouncementMessage('')
      setActionMessage('Annuncio pubblicato. Gli utenti lo vedranno al prossimo accesso.')
      await fetchAnnouncements()
    } else {
      setActionMessage(data?.error || 'Non sono riuscito a pubblicare l annuncio.')
      setAnnouncementLoading(false)
    }
  }

  const withdrawAnnouncement = async (announcementId: string) => {
    const token = await getAccessToken()
    if (!token) return
    setAnnouncementBusyId(announcementId)
    const response = await fetch('/api/announcements', {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`
      },
      body: JSON.stringify({ announcementId, action: 'withdraw' })
    }).catch(() => null)
    const data = await response?.json().catch(() => null)
    setActionMessage(response?.ok ? 'Annuncio ritirato: non verra mostrato ad altri utenti.' : data?.error || 'Ritiro non riuscito.')
    setAnnouncementBusyId('')
    if (response?.ok) await fetchAnnouncements()
  }

  const deleteAnnouncement = async (announcementId: string) => {
    if (!window.confirm('Eliminare definitivamente questo annuncio e le relative conferme di lettura?')) return
    const token = await getAccessToken()
    if (!token) return
    setAnnouncementBusyId(announcementId)
    const response = await fetch(`/api/announcements?id=${encodeURIComponent(announcementId)}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` }
    }).catch(() => null)
    const data = await response?.json().catch(() => null)
    setActionMessage(response?.ok ? 'Annuncio eliminato.' : data?.error || 'Eliminazione non riuscita.')
    setAnnouncementBusyId('')
    if (response?.ok) await fetchAnnouncements()
  }

  const fetchSystemHealth = async () => {
    const token = await getAccessToken()
    if (!token) return

    setSystemHealthLoading(true)
    const res = await fetch('/api/admin/system-health', {
      headers: { Authorization: `Bearer ${token}` }
    }).catch(() => null)
    const data = await res?.json().catch(() => null)
    setSystemHealth(data?.ok ? data : { ok: false, error: data?.error || 'Salute sistema non disponibile.' })
    setSystemHealthLoading(false)
  }

  const fetchBugReports = async () => {
    const token = await getAccessToken()
    if (!token) return

    const res = await fetch('/api/bug-reports', {
      headers: { Authorization: `Bearer ${token}` }
    }).catch(() => null)
    const data = await res?.json().catch(() => null)
    if (data?.ok && Array.isArray(data.reports)) {
      setBugReports(data.reports)
    }
  }

  const selectedAnalyticsRange = analyticsRanges.find(range => range.key === analyticsRange) || analyticsRanges[1]
  const analyticsChartSeries = useMemo(() => {
    const source = analytics?.daySeries || []
    if (source.length === 0) return []

    if (selectedAnalyticsRange.key === '24h' || chartGranularity === 'daily') {
      if (selectedAnalyticsRange.key === '24h') {
        return [{
          label: '24H',
          pageViews: analytics?.totals?.pageViews || 0,
          searches: (analytics?.totals?.manualSearches || 0) + (analytics?.totals?.deckSearches || 0),
          scans: analytics?.totals?.scans || 0,
          activeUsers: analytics?.totals?.activeToday || 0,
        }]
      }
      return source.map(day => ({
        label: new Date(day.day).toLocaleDateString('it-IT', { day: '2-digit', month: 'short' }),
        pageViews: day.pageViews,
        searches: day.searches,
        scans: day.scans,
        activeUsers: day.activeUsers,
      }))
    }

    if (chartGranularity === 'yearly') {
      return [{
        label: 'Anno',
        pageViews: analytics?.totals?.pageViews || 0,
        searches: (analytics?.totals?.manualSearches || 0) + (analytics?.totals?.deckSearches || 0),
        scans: analytics?.totals?.scans || 0,
        activeUsers: Math.max(...source.map(day => day.activeUsers), analytics?.totals?.activeToday || 0),
      }]
    }

    const grouped = new Map<string, {
      label: string
      pageViews: number
      searches: number
      scans: number
      activeUsers: number
    }>()

    source.forEach(day => {
      const date = new Date(day.day)
      const key = chartGranularity === 'monthly'
        ? `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`
        : `W${Math.ceil(date.getUTCDate() / 7)}-${date.getUTCFullYear()}-${date.getUTCMonth()}`
      const label = chartGranularity === 'monthly'
        ? date.toLocaleDateString('it-IT', { month: 'short', year: '2-digit' })
        : `Sett. ${Math.ceil(date.getUTCDate() / 7)} ${date.toLocaleDateString('it-IT', { month: 'short' })}`
      const current = grouped.get(key) || { label, pageViews: 0, searches: 0, scans: 0, activeUsers: 0 }
      current.pageViews += day.pageViews
      current.searches += day.searches
      current.scans += day.scans
      current.activeUsers = Math.max(current.activeUsers, day.activeUsers)
      grouped.set(key, current)
    })

    return [...grouped.values()]
  }, [analytics, selectedAnalyticsRange.key, chartGranularity])

  const chartMaxValue = Math.max(
    ...analyticsChartSeries.map(item => Math.max(item.pageViews, item.searches, item.scans, item.activeUsers)),
    1
  )

  const chartWidth = 720
  const chartHeight = 280
  const chartPadding = { top: 18, right: 18, bottom: 44, left: 46 }
  const chartInnerWidth = chartWidth - chartPadding.left - chartPadding.right
  const chartInnerHeight = chartHeight - chartPadding.top - chartPadding.bottom
  const chartX = (index: number) =>
    chartPadding.left + (analyticsChartSeries.length <= 1 ? chartInnerWidth / 2 : (index / (analyticsChartSeries.length - 1)) * chartInnerWidth)
  const chartY = (value: number) =>
    chartPadding.top + chartInnerHeight - (Number(value || 0) / chartMaxValue) * chartInnerHeight
  const chartPath = (key: 'pageViews' | 'searches' | 'scans' | 'activeUsers') =>
    analyticsChartSeries
      .map((item, index) => `${index === 0 ? 'M' : 'L'} ${chartX(index).toFixed(1)} ${chartY(Number(item[key] || 0)).toFixed(1)}`)
      .join(' ')
  const chartLines = [
    { key: 'pageViews' as const, label: 'Pagine', color: '#67e8f9' },
    { key: 'searches' as const, label: 'Ricerche', color: '#6ee7b7' },
    { key: 'scans' as const, label: 'Scan', color: '#fbbf24' },
    { key: 'activeUsers' as const, label: 'Utenti', color: '#fda4af' },
  ]

  const fetchAnalytics = async (rangeKey: AnalyticsRangeKey = analyticsRange) => {
    const token = await getAccessToken()
    if (!token) return

    const range = analyticsRanges.find(item => item.key === rangeKey) || analyticsRanges[1]
    setAnalyticsLoading(true)
    const res = await fetch(`/api/admin/analytics?days=${range.days}`, {
      headers: { Authorization: `Bearer ${token}` }
    }).catch(() => null)
    const data = await res?.json().catch(() => null)
    if (data?.ok) {
      setAnalytics(data)
    } else {
      setAnalytics({
        ok: false,
        analyticsReady: false,
        analyticsError: data?.error || 'Statistiche non disponibili.'
      })
    }
    setAnalyticsLoading(false)
  }

  const toggleAnalytics = async () => {
    const nextOpen = !analyticsOpen
    setAnalyticsOpen(nextOpen)
    if (nextOpen && !analytics) await fetchAnalytics()
  }

  const changeAnalyticsRange = async (rangeKey: AnalyticsRangeKey) => {
    setAnalyticsRange(rangeKey)
    await fetchAnalytics(rangeKey)
  }

  const fetchProfiles = async () => {
    console.log('🔍 [ADMIN] Fetching profiles...')
    // Prima prova con tutte le colonne, se fallisce usa solo le colonne base
    const query = supabase.from('profiles').select('id, username, username_locked, username_changed_at, username_change_credits, is_blocked, is_premium, is_vip, vip_note, vip_since')

    const { data, error } = await query

    if (error) {
      console.warn('❌ [ADMIN] fetchProfiles error with all columns:', error)
      // Riprova con solo le colonne base
      console.log('🔄 [ADMIN] Retrying with basic columns...')
      const { data: basicData, error: basicError } = await supabase
        .from('profiles')
        .select('id, username')

      if (basicError) {
        console.error('❌ [ADMIN] fetchProfiles error with basic columns:', basicError)
        setActionMessage(`Errore caricamento profili: ${basicError.message}`)
        setProfiles([])
        return
      }

      // Aggiungi le colonne mancanti con valori di default
      const enrichedData = (basicData || []).map(profile => ({
        ...profile,
        username_locked: false,
        username_changed_at: null,
        username_change_credits: 0,
        is_blocked: false,
        is_premium: false,
        is_vip: false
      }))

      setProfiles(enrichedData)
      console.log('✅ [ADMIN] Profiles loaded (basic):', enrichedData.length, 'profiles')
      return
    }

    setProfiles(data || [])
    console.log('✅ [ADMIN] Profiles loaded (full):', data?.length || 0, 'profiles')
  }

  const fetchRequests = async () => {
    console.log('🔍 [ADMIN] Fetching requests...')
    const { data, error } = await supabase
      .from('missing_card_reports')
      .select(`
        id,
        card_name,
        card_op,
        card_number,
        card_code,
        card_variant,
        description,
        status,
        reported_by,
        created_at,
        profiles!missing_card_reports_reported_by_fkey (
          username
        )
      `)
      .order('created_at', { ascending: false })

    if (error) {
      console.warn('❌ [ADMIN] fetchRequests error', error)
      // Riprova con solo le colonne base
      console.log('🔄 [ADMIN] Retrying with basic columns...')
      const { data: basicData, error: basicError } = await supabase
        .from('missing_card_reports')
        .select('id, card_name, card_op, card_number, reported_by, created_at')
        .order('created_at', { ascending: false })

      if (basicError) {
        console.error('❌ [ADMIN] fetchRequests error with basic columns:', basicError)
        setRequests([])
        return
      }

      // Aggiungi le colonne mancanti con valori di default
      const enrichedData = (basicData || []).map((request: any) => ({
        ...request,
        status: 'new', // default status
        reporter_username: 'sconosciuto' // default username
      }))

      console.log('✅ [ADMIN] Requests loaded (basic):', enrichedData.length, 'requests')
      setRequests(enrichedData)
      return
    }

    // Transform the data to include reporter_username
    const transformedData = (data || []).map((request: any) => ({
      ...request,
      reporter_username: request.profiles?.username || null
    }))

    console.log('✅ [ADMIN] Requests loaded:', transformedData.length, 'requests')
    setRequests(transformedData)
  }

  useEffect(() => {
    const init = async () => {
      console.log('🔐 [ADMIN] Initializing admin page...')
      const { data } = await supabase.auth.getSession()
      const user = data?.session?.user

      console.log('🔐 [ADMIN] Current user:', user?.id, 'Expected admin:', ADMIN_ACCOUNT.id)

      if (!user) {
        console.log('❌ [ADMIN] No user session, redirecting to /')
        router.replace('/')
        return
      }

      const { data: adminProfile } = await supabase
        .from('profiles')
        .select('username')
        .eq('id', user.id)
        .maybeSingle()

      if (!isAdminAccount(user, adminProfile)) {
        console.log('❌ [ADMIN] User is not admin, redirecting to /dashboard')
        router.replace('/dashboard')
        return
      }

      console.log('✅ [ADMIN] User is admin, loading data...')
      setLoading(false)
      void refreshData()
    }

    init()
  }, [router])

  const toggleBlockUser = async (profile: ProfileItem) => {
    if (!profile.id) return
    const nextBlocked = !profile.is_blocked
    setBusy(true)
    const { error } = await supabase
      .from('profiles')
      .update({ is_blocked: nextBlocked })
      .eq('id', profile.id)

    if (error) {
      setActionMessage('Errore durante il blocco/sblocco utente.')
      console.error(error)
    } else {
      setActionMessage(`Utente ${profile.username || profile.id} aggiornato.`)
      await fetchProfiles()
    }
    setBusy(false)
  }

  const toggleVipUser = async (profile: ProfileItem) => {
    if (!profile.id || profile.id === ADMIN_ACCOUNT.id) return

    const nextVip = !profile.is_vip
    setBusy(true)
    const { error } = await supabase
      .from('profiles')
      .update({
        is_vip: nextVip,
        vip_since: nextVip ? new Date().toISOString() : null,
        vip_granted_by: nextVip ? ADMIN_ACCOUNT.id : null,
        vip_note: nextVip ? 'VIP assegnato da admin' : null
      })
      .eq('id', profile.id)

    if (error) {
      setActionMessage(`Errore VIP: ${error.message}. Se manca la colonna, esegui premium.sql su Supabase.`)
    } else {
      setActionMessage(nextVip ? `VIP attivato per ${profile.username || profile.id}.` : `VIP rimosso da ${profile.username || profile.id}.`)
      await fetchProfiles()
    }
    setBusy(false)
  }

  const deleteUser = async (profile: ProfileItem) => {
    if (!profile.id) return
    if (!confirm(`Sei sicuro di eliminare ${profile.username || profile.id}? Questa azione rimuove il profilo e la collezione.`)) {
      return
    }

    setBusy(true)
    const { error: cardsError } = await supabase
      .from('user_cards')
      .delete()
      .eq('user_id', profile.id)

    const { error: profileError } = await supabase
      .from('profiles')
      .delete()
      .eq('id', profile.id)

    if (cardsError || profileError) {
      setActionMessage('Errore durante l\'eliminazione utente.')
      console.error(cardsError || profileError)
    } else {
      setActionMessage(`Utente ${profile.username || profile.id} eliminato.`)
      await refreshData()
    }
    setBusy(false)
  }

  const markRequestResolved = async (requestId: number) => {
    console.log('✅ [ADMIN] Marking request as resolved:', requestId)
    setBusy(true)

    try {
      // Prima prova ad aggiornare lo status
      const { error: updateError } = await supabase
        .from('missing_card_reports')
        .update({ status: 'resolved' })
        .eq('id', requestId)

      if (updateError) {
        console.warn('⚠️ [ADMIN] Could not update status (column might not exist):', updateError)
        // Anche se non riusciamo ad aggiornare lo status, consideriamo l'operazione riuscita
        // perché l'utente può comunque cancellare la richiesta
      }

      setActionMessage('Richiesta marcata come risolta.')
      await fetchRequests()
    } catch (err) {
      console.error('❌ [ADMIN] Mark resolved exception:', err)
      setActionMessage('Errore nell\'aggiornamento della richiesta.')
    } finally {
      setBusy(false)
    }
  }

  const deleteResolvedRequest = async (requestId: number) => {
    if (!confirm('Sei sicuro di voler eliminare questa richiesta risolta?')) {
      return
    }

    console.log('🗑️ [ADMIN] Deleting request:', requestId)
    setBusy(true)

    try {
      const { error } = await supabase
        .from('missing_card_reports')
        .delete()
        .eq('id', requestId)

      if (error) {
        console.error('❌ [ADMIN] Delete request error:', error)
        setActionMessage(`Errore nell'eliminazione: ${error.message}`)
      } else {
        console.log('✅ [ADMIN] Request deleted successfully')
        setActionMessage('Richiesta eliminata con successo.')
        await fetchRequests()
      }
    } catch (err) {
      console.error('❌ [ADMIN] Delete request exception:', err)
      setActionMessage('Errore imprevisto nell\'eliminazione.')
    } finally {
      setBusy(false)
    }
  }

  const deleteBugReport = async (id: string) => {
    if (!confirm('Eliminare definitivamente questa segnalazione bug dal database?')) return

    const token = await getAccessToken()
    if (!token) return

    setBusy(true)
    const res = await fetch(`/api/bug-reports?id=${encodeURIComponent(id)}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` }
    })
    const data = await res.json().catch(() => null)
    setActionMessage(res.ok && data?.ok ? 'Bug eliminato dal database.' : data?.error || 'Errore eliminazione bug.')
    await fetchBugReports()
    setBusy(false)
  }

  const updateNicknameAsAdmin = async (profile: ProfileItem) => {
    if (busy) return
    const nickname = window.prompt('Nuovo nickname', profile.username || '')?.trim()
    if (!nickname || nickname === profile.username) return

    const token = await getAccessToken()
    if (!token) return
    setBusy(true)
    const response = await fetch('/api/profile/nickname', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ action: 'rename', userId: profile.id, nickname }),
    })
    const result = await response.json().catch(() => null)
    setActionMessage(response.ok && result?.ok ? `Nickname aggiornato in ${nickname}.` : result?.error || 'Modifica non riuscita.')
    await fetchProfiles()
    setBusy(false)
  }

  const grantNicknameCredit = async (profile: ProfileItem) => {
    if (busy || !confirm(`Aggiungere una modifica nickname extra a ${profile.username || profile.id}?`)) return
    const token = await getAccessToken()
    if (!token) return
    setBusy(true)
    const response = await fetch('/api/profile/nickname', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ action: 'grant-credit', userId: profile.id }),
    })
    const result = await response.json().catch(() => null)
    setActionMessage(response.ok && result?.ok
      ? `${profile.username || 'Utente'} ha ora ${result.credits} modifica extra.`
      : result?.error || 'Credito non assegnato.')
    await fetchProfiles()
    setBusy(false)
  }

  const deleteAllBugReports = async () => {
    if (bugReports.length === 0) return
    if (!confirm(`Eliminare definitivamente tutte le ${bugReports.length} segnalazioni bug?`)) return

    const token = await getAccessToken()
    if (!token) return

    setBusy(true)
    const results = await Promise.all(bugReports.map(report =>
      fetch(`/api/bug-reports?id=${encodeURIComponent(report.id)}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` }
      }).then(res => res.ok).catch(() => false)
    ))
    const deleted = results.filter(Boolean).length
    setActionMessage(`Segnalazioni eliminate: ${deleted}/${bugReports.length}.`)
    await fetchBugReports()
    setBusy(false)
  }

  const runCleanup = async (action: CleanupAction) => {
    if (cleanupBusyKey || cleanupConfirmation !== 'SVUOTA') return
    if (action.needsUser && !cleanupUserId) {
      setActionMessage('Seleziona prima un utente.')
      return
    }

    const targetUser = profiles.find(profile => profile.id === cleanupUserId)
    const targetLabel = action.needsUser ? ` per ${targetUser?.username || cleanupUserId}` : ''
    if (!window.confirm(`${action.title}${targetLabel}? L'operazione non può essere annullata.`)) return

    setCleanupBusyKey(action.key)
    setActionMessage('Operazione in corso...')
    try {
      const token = await getAccessToken()
      const res = await fetch('/api/admin/cleanup', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {})
        },
        body: JSON.stringify({
          action: action.key,
          userId: action.needsUser ? cleanupUserId : undefined,
          confirmation: cleanupConfirmation
        })
      })
      const data = await res.json().catch(() => null)
      if (!res.ok || !data?.ok) {
        setActionMessage(data?.error || 'Svuotamento non riuscito.')
      } else {
        const detail = data.details
          ? ` Chat: ${data.details.chats || 0}, analytics: ${data.details.analytics || 0}.`
          : ''
        setActionMessage(`${action.title} completato. Elementi eliminati: ${data.deleted || 0}.${detail}`)
        setCleanupConfirmation('')
        await refreshData()
      }
    } catch {
      setActionMessage('Impossibile completare lo svuotamento.')
    }
    setCleanupBusyKey('')
  }

  const sectionTitle: Record<AdminSection, string> = {
    home: 'Impostazioni Admin',
    announcements: 'Popup e annunci',
    reports: 'Segnalazioni',
    catalog: 'Catalogo carte',
    binderKits: 'Kit raccoglitori',
    data: 'Gestione dati',
    analytics: 'Statistiche',
    services: 'Servizi',
    status: 'Status',
    users: 'Gestione utenti',
    cleanup: 'Svuotamenti',
    info: 'Info sistema',
  }

  const adminSections = [
    { key: 'announcements' as const, title: 'Popup e annunci', description: 'Pubblica aggiornamenti visibili una sola volta', icon: Megaphone, count: announcements.filter(item => item.is_active).length, tone: 'text-amber-100 bg-amber-300/10' },
    { key: 'reports' as const, title: 'Segnalazioni', description: 'Bug e carte mancanti', icon: Bug, count: bugReports.length + requests.length, tone: 'text-rose-200 bg-rose-300/10' },
    { key: 'catalog' as const, title: 'Catalogo carte', description: 'Importa varianti tramite link Cardmarket', icon: Database, tone: 'text-cyan-100 bg-cyan-300/10' },
    { key: 'binderKits' as const, title: 'Kit raccoglitori', description: 'Crea, modifica ed elimina copertine', icon: BookOpen, tone: 'text-violet-100 bg-violet-300/10' },
    { key: 'data' as const, title: 'Gestione dati', description: 'Tabelle Supabase, utenti e file Cloudflare', icon: Database, tone: 'text-emerald-100 bg-emerald-300/10' },
    { key: 'analytics' as const, title: 'Statistiche', description: 'Utenti, pagine, scan e ricerche', icon: BarChart3, tone: 'text-cyan-100 bg-cyan-300/10' },
    { key: 'services' as const, title: 'Servizi', description: 'Catalogo, immagini, Vision e prezzi', icon: Wrench, tone: 'text-amber-100 bg-amber-300/10' },
    { key: 'status' as const, title: 'Status', description: 'Stato API, database, hosting e storage', icon: Activity, tone: 'text-emerald-100 bg-emerald-300/10' },
    { key: 'users' as const, title: 'Utenti', description: `${profiles.length} profili, VIP e blocchi`, icon: Users, count: profiles.length, tone: 'text-violet-100 bg-violet-300/10' },
    { key: 'cleanup' as const, title: 'Svuotamenti', description: 'Pulizia controllata del database', icon: Eraser, tone: 'text-rose-100 bg-rose-400/10' },
    { key: 'info' as const, title: 'Info', description: 'Database, cron e configurazione', icon: Info, tone: 'text-emerald-100 bg-emerald-300/10' },
  ]

  if (loading) {
    return (
      <div className="min-h-screen text-white onepiece-wave-bg onepiece-clouds flex items-center justify-center">
        <div className="rounded-3xl border border-teal-800/30 bg-slate-900/80 px-6 py-5 text-slate-100">Caricamento admin...</div>
      </div>
    )
  }

  return (
    <div className="min-h-screen text-white onepiece-wave-bg onepiece-clouds px-4 py-8 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-7xl rounded-[2rem] border border-teal-800/30 bg-slate-950/90 shadow-2xl shadow-slate-950/40 p-6">
        <div className="flex items-center justify-between gap-3 mb-6">
          <button
            onClick={() => activeSection === 'home' ? router.push('/dashboard') : setActiveSection('home')}
            className="p-2 rounded-2xl bg-slate-800/70 border border-teal-800/30 hover:scale-105 transition"
            aria-label={activeSection === 'home' ? 'Torna alla collezione' : 'Torna alle impostazioni admin'}
          >
            <ArrowLeft />
          </button>
          <div className="flex-1 text-center">
            <h1 className="text-3xl font-extrabold text-white">{sectionTitle[activeSection]}</h1>
          </div>
          <button
            type="button"
            onClick={refreshData}
            disabled={busy || systemHealthLoading}
            className="grid h-10 w-10 place-items-center rounded-2xl border border-teal-800/30 bg-slate-800/70 text-slate-200 transition active:scale-90 disabled:opacity-50"
            aria-label="Aggiorna dati admin"
          >
            <RotateCcw size={17} />
          </button>
        </div>

        {actionMessage && (
          <div className="mt-5 rounded-3xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-200">
            {actionMessage}
          </div>
        )}

        {activeSection === 'home' ? (
          <div className="mt-6">
            <div className="mb-4 flex items-center gap-2 text-sm font-bold text-slate-300">
              <Settings size={17} className="text-cyan-100" />
              Seleziona una sezione
            </div>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {adminSections.map(section => {
                const Icon = section.icon
                return (
                  <button
                    key={section.key}
                    type="button"
                    onClick={() => openSection(section.key)}
                    className="group flex min-h-28 items-center gap-4 rounded-[1.5rem] border border-white/10 bg-slate-900/80 p-4 text-left transition hover:border-cyan-300/30 hover:bg-slate-900 active:scale-[0.985]"
                  >
                    <span className={`grid h-12 w-12 shrink-0 place-items-center rounded-2xl ${section.tone}`}>
                      <Icon size={22} />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-2">
                        <span className="text-base font-black text-white">{section.title}</span>
                        {'count' in section && typeof section.count === 'number' ? (
                          <span className="rounded-full bg-white/[0.07] px-2 py-0.5 text-[10px] font-black text-slate-300">{section.count}</span>
                        ) : null}
                      </span>
                      <span className="mt-1 block text-xs leading-5 text-slate-400">{section.description}</span>
                    </span>
                    <ChevronRight size={18} className="shrink-0 text-slate-600 transition group-hover:translate-x-0.5 group-hover:text-cyan-100" />
                  </button>
                )
              })}
            </div>
          </div>
        ) : null}

        {activeSection === 'announcements' ? (
          <div className="mt-6 space-y-4">
            <section className="rounded-[1.75rem] border border-amber-200/20 bg-slate-900/90 p-5">
              <div className="flex items-start gap-3">
                <span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-amber-300/10 text-amber-100">
                  <Megaphone size={20} />
                </span>
                <div>
                  <h2 className="text-xl font-black text-white">Nuovo popup</h2>
                  <p className="mt-1 text-sm leading-6 text-slate-400">
                    Il nuovo annuncio sostituisce quello attivo e viene mostrato una sola volta a ogni account.
                  </p>
                </div>
              </div>

              <div className="mt-5 space-y-3">
                <label className="block">
                  <span className="mb-1.5 flex items-center justify-between text-[10px] font-black uppercase tracking-[0.18em] text-slate-500">
                    <span>Titolo</span>
                    <span>{announcementTitle.length}/100</span>
                  </span>
                  <input
                    value={announcementTitle}
                    onChange={event => setAnnouncementTitle(event.target.value.slice(0, 100))}
                    placeholder="Esempio: Nuovo aggiornamento disponibile"
                    className="w-full rounded-2xl border border-slate-700 bg-slate-950/80 px-4 py-3 text-base font-bold text-white outline-none transition focus:border-amber-200"
                  />
                </label>
                <label className="block">
                  <span className="mb-1.5 flex items-center justify-between text-[10px] font-black uppercase tracking-[0.18em] text-slate-500">
                    <span>Descrizione</span>
                    <span>{announcementMessage.length}/2000</span>
                  </span>
                  <textarea
                    value={announcementMessage}
                    onChange={event => setAnnouncementMessage(event.target.value.slice(0, 2000))}
                    placeholder={'Scrivi le novita, le modifiche oppure le informazioni sull evento.\nPuoi andare a capo per creare una lista ordinata.'}
                    rows={8}
                    className="w-full resize-y rounded-2xl border border-slate-700 bg-slate-950/80 px-4 py-3 text-base leading-7 text-white outline-none transition focus:border-amber-200"
                  />
                </label>
              </div>

              <button
                type="button"
                onClick={() => void publishAnnouncement()}
                disabled={announcementLoading || announcementTitle.trim().length < 3 || announcementMessage.trim().length < 5}
                className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-2xl border border-amber-100/30 bg-amber-300 px-4 py-3.5 text-sm font-black text-slate-950 shadow-lg shadow-amber-950/20 transition hover:bg-amber-200 active:scale-[0.985] disabled:cursor-not-allowed disabled:opacity-40 sm:w-auto"
              >
                <Send size={17} />
                {announcementLoading ? 'Pubblico...' : 'Pubblica popup'}
              </button>
            </section>

            <section className="rounded-[1.75rem] border border-white/10 bg-slate-900/90 p-5">
              <div className="flex items-center justify-between gap-3">
                <h2 className="text-xl font-black text-white">Ultimi annunci</h2>
                <button
                  type="button"
                  onClick={() => void fetchAnnouncements()}
                  disabled={announcementLoading}
                  className="grid h-10 w-10 place-items-center rounded-2xl border border-slate-700 bg-slate-950/70 text-slate-300 transition active:scale-90 disabled:opacity-50"
                  aria-label="Aggiorna annunci"
                >
                  <RotateCcw size={16} />
                </button>
              </div>

              <div className="mt-4 space-y-3">
                {announcementLoading && announcements.length === 0 ? (
                  <p className="rounded-2xl border border-dashed border-slate-700 p-4 text-sm text-slate-400">Carico gli annunci...</p>
                ) : announcements.length === 0 ? (
                  <p className="rounded-2xl border border-dashed border-slate-700 p-4 text-sm text-slate-400">Non hai ancora pubblicato popup.</p>
                ) : announcements.map(item => (
                  <article key={item.id} className={`rounded-3xl border p-4 ${item.is_active ? 'border-emerald-300/25 bg-emerald-300/[0.055]' : 'border-slate-800 bg-slate-950/70'}`}>
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <h3 className="break-words font-black text-white">{item.title}</h3>
                          <span className={`rounded-full px-2 py-1 text-[9px] font-black uppercase tracking-[0.14em] ${item.is_active ? 'bg-emerald-300/15 text-emerald-100' : 'bg-slate-800 text-slate-400'}`}>
                            {item.is_active ? 'Attivo' : 'Ritirato'}
                          </span>
                        </div>
                        <p className="mt-2 whitespace-pre-wrap break-words text-sm leading-6 text-slate-300">{item.message}</p>
                        <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-[11px] font-bold text-slate-500">
                          <span>{new Date(item.published_at).toLocaleString('it-IT')}</span>
                          <span>Letto da {item.read_count} utenti</span>
                        </div>
                      </div>
                      <div className="flex shrink-0 gap-2">
                        {item.is_active ? (
                          <button
                            type="button"
                            onClick={() => void withdrawAnnouncement(item.id)}
                            disabled={Boolean(announcementBusyId)}
                            className="rounded-2xl border border-amber-300/25 bg-amber-300/10 px-3 py-2 text-xs font-black text-amber-100 transition active:scale-95 disabled:opacity-40"
                          >
                            {announcementBusyId === item.id ? 'Attendi...' : 'Ritira'}
                          </button>
                        ) : null}
                        <button
                          type="button"
                          onClick={() => void deleteAnnouncement(item.id)}
                          disabled={Boolean(announcementBusyId)}
                          className="grid h-9 w-9 place-items-center rounded-2xl border border-rose-300/20 bg-rose-400/10 text-rose-100 transition active:scale-90 disabled:opacity-40"
                          aria-label={`Elimina ${item.title}`}
                        >
                          <Trash2 size={15} />
                        </button>
                      </div>
                    </div>
                  </article>
                ))}
              </div>
            </section>
          </div>
        ) : null}

        {activeSection === 'catalog' ? (
          <div className="mt-6">
            <CatalogCardManager />
          </div>
        ) : null}

        {activeSection === 'binderKits' ? <BinderKitManager /> : null}

        {activeSection === 'data' ? <AdminDatabaseManager /> : null}

        <div className={activeSection === 'reports' ? 'mt-6' : 'hidden'}>
        <section className="rounded-[1.75rem] border border-cyan-300/20 bg-slate-900/90 p-5">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h2 className="text-xl font-semibold text-white">Bug</h2>
            </div>
            <div className="flex items-center gap-2">
              {bugReports.length > 0 ? (
                <button
                  type="button"
                  onClick={deleteAllBugReports}
                  disabled={busy}
                  className="inline-flex items-center gap-2 rounded-2xl border border-red-500/20 bg-red-500/10 px-3 py-2 text-xs font-semibold text-red-200 disabled:opacity-60"
                >
                  <Trash2 size={14} />
                  Elimina tutte
                </button>
              ) : null}
              <div className="relative">
                <Bug className="text-cyan-200" />
                {bugReports.length > 0 ? (
                  <span className="absolute -right-2 -top-2 grid h-5 min-w-5 place-items-center rounded-full bg-rose-400 px-1 text-[10px] font-black text-white">
                    {bugReports.length}
                  </span>
                ) : null}
              </div>
            </div>
          </div>

          <div className="mt-5 space-y-3">
            {bugReports.length === 0 ? (
              <div className="rounded-3xl border border-slate-800/70 bg-slate-950/80 p-4 text-sm text-slate-400">
                Nessuna segnalazione bug.
              </div>
            ) : bugReports.map(report => (
              <div key={report.id} className="rounded-3xl border border-slate-800/70 bg-slate-950/80 p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-white">{report.title || 'Bug senza titolo'}</p>
                    <p className="mt-1 text-xs text-slate-500">
                      {new Date(report.created_at).toLocaleString('it-IT')} · {report.page_path || 'pagina non indicata'}
                    </p>
                  </div>
                  <button
                    onClick={() => deleteBugReport(report.id)}
                    disabled={busy}
                    className="inline-flex shrink-0 items-center gap-2 rounded-2xl border border-red-500/20 bg-red-500/10 px-3 py-2 text-xs font-semibold text-red-200 disabled:opacity-60"
                  >
                    <Trash2 size={14} />
                    Elimina
                  </button>
                </div>
                <p className="mt-3 whitespace-pre-wrap text-sm leading-6 text-slate-300">{report.message}</p>
                <div className="mt-3 rounded-2xl border border-white/10 bg-white/[0.04] px-3 py-2 text-xs text-slate-400">
                  <p>Segnalato da: <span className="text-slate-200">{report.reporter_username || report.reporter_email || 'sconosciuto'}</span></p>
                </div>
              </div>
            ))}
          </div>
        </section>

        </div>

        <div className={activeSection === 'reports' ? 'mt-6' : 'hidden'}>
        <section className="rounded-[1.75rem] border border-slate-800/70 bg-slate-900/90 p-5">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h2 className="text-xl font-semibold text-white">Carte mancanti</h2>
            </div>
            <ShieldCheck className="text-amber-400" />
          </div>

          <div className="mt-6 space-y-3">
            {requests.length === 0 ? (
              <div className="rounded-3xl border border-slate-800/70 bg-slate-950/80 p-4 text-sm text-slate-400">
                Nessuna richiesta nuova al momento.
              </div>
            ) : (
              requests.map((request) => (
                <div key={request.id} className="rounded-3xl border border-slate-800/70 bg-slate-950/80 p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-sm font-semibold text-white">{request.card_code || `${request.card_op}-${request.card_number}`}</p>
                      <p className="mt-1 text-xs text-slate-300">{request.card_variant || request.card_name}</p>
                      {request.description ? <p className="mt-2 whitespace-pre-wrap text-xs leading-5 text-slate-400">{request.description}</p> : null}
                    </div>
                    <span className="rounded-full bg-amber-400/10 px-2 py-1 text-[10px] uppercase tracking-[0.18em] text-amber-200">
                      {request.status === 'resolved' ? 'Risolto' : 'Nuova'}
                    </span>
                  </div>
                  <div className="mt-3 flex items-center justify-between gap-2">
                    <p className="text-xs text-slate-500">Segnalata da {request.reporter_username || 'sconosciuto'}</p>
                    <div className="flex gap-2">
                      {request.status !== 'resolved' && (
                        <button
                          onClick={() => markRequestResolved(request.id)}
                          disabled={busy}
                          className="rounded-2xl bg-emerald-500/10 px-3 py-2 text-xs font-semibold text-emerald-200 border border-emerald-500/20 hover:bg-emerald-500/20"
                        >
                          Risolvi
                        </button>
                      )}
                      {(request.status === 'resolved' || !request.status) && (
                        <button
                          onClick={() => deleteResolvedRequest(request.id)}
                          disabled={busy}
                          className="rounded-2xl bg-red-500/10 px-3 py-2 text-xs font-semibold text-red-200 border border-red-500/20 hover:bg-red-500/20"
                        >
                          Cancella
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </section>

        </div>

        <div className={activeSection === 'analytics' ? 'mt-6 rounded-[1.75rem] border border-cyan-300/25 bg-slate-900/90 p-5' : 'hidden'}>
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="text-xl font-semibold text-white">Utilizzo sito</h2>
              <p className="mt-1 text-sm text-slate-400">
                Abbonamenti, VIP, free, pagine usate, ricerche manuali e scan per periodo selezionato.
              </p>
            </div>
            <button
              onClick={toggleAnalytics}
              disabled={analyticsLoading}
              className="inline-flex items-center justify-center gap-2 rounded-2xl border border-cyan-200/40 bg-cyan-300 px-4 py-3 text-sm font-black text-slate-950 shadow-lg shadow-cyan-950/20 transition hover:bg-cyan-200 disabled:opacity-60"
            >
              <BarChart3 size={17} />
              {analyticsLoading ? 'Carico...' : analyticsOpen ? 'Nascondi statistiche' : 'Apri statistiche'}
            </button>
          </div>

          {analyticsOpen ? (
            <div className="mt-5 space-y-5">
              <div className="flex flex-wrap gap-2">
                {analyticsRanges.map(range => (
                  <button
                    key={range.key}
                    type="button"
                    onClick={() => void changeAnalyticsRange(range.key)}
                    disabled={analyticsLoading}
                    className={`rounded-2xl border px-3 py-2 text-xs font-black uppercase tracking-[0.12em] transition active:scale-95 disabled:opacity-60 ${
                      analyticsRange === range.key
                        ? 'border-cyan-200 bg-cyan-300 text-slate-950'
                        : 'border-slate-700 bg-slate-950/70 text-slate-300 hover:border-cyan-300/40'
                    }`}
                    title={range.description}
                  >
                    {range.label}
                  </button>
                ))}
              </div>

              {analytics?.analyticsReady === false ? (
                <div className="rounded-3xl border border-amber-300/25 bg-amber-300/10 p-4 text-sm text-amber-100">
                  Tracking non ancora attivo su Supabase: esegui `analytics.sql`. I dati abbonati e scan possono comunque funzionare, ma pagine e ricerche partono solo dopo la creazione della tabella.
                  {analytics.analyticsError ? <span className="mt-1 block text-xs text-amber-100/75">{analytics.analyticsError}</span> : null}
                </div>
              ) : null}

              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                {[
                  ['Utenti', analytics?.totals?.users ?? profiles.length],
                  ['Premium', analytics?.totals?.premium ?? profiles.filter(profile => profile.is_premium).length],
                  ['VIP', analytics?.totals?.vip ?? profiles.filter(profile => profile.is_vip).length],
                  ['Free', analytics?.totals?.free ?? profiles.filter(profile => !profile.is_premium && !profile.is_vip).length],
                  ['Attivi oggi', analytics?.totals?.activeToday ?? 0],
                  ['Scan', analytics?.totals?.scans ?? 0],
                  ['Ricerche manuali', analytics?.totals?.manualSearches ?? 0],
                  ['Ricerche deck', analytics?.totals?.deckSearches ?? 0],
                ].map(([label, value]) => (
                  <div key={label} className="rounded-3xl border border-slate-800 bg-slate-950/75 p-4">
                    <p className="text-xs uppercase tracking-[0.2em] text-slate-500">{label}</p>
                    <p className="mt-2 text-2xl font-black text-cyan-100">{value}</p>
                  </div>
                ))}
              </div>

              <div className="grid gap-4 xl:grid-cols-[1.2fr_0.8fr]">
                <section className="rounded-3xl border border-slate-800 bg-slate-950/75 p-4">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div>
                      <div className="flex items-center gap-2">
                        <Activity size={16} className="text-cyan-100" />
                        <h3 className="text-sm font-black text-white">Grafico utilizzo</h3>
                      </div>
                      <p className="mt-1 text-xs text-slate-500">Periodo: {selectedAnalyticsRange.description}</p>
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {chartGranularities.map(item => (
                        <button
                          key={item.key}
                          type="button"
                          onClick={() => setChartGranularity(item.key)}
                          className={`rounded-xl border px-2.5 py-1.5 text-[10px] font-black uppercase tracking-[0.1em] transition active:scale-95 ${
                            chartGranularity === item.key
                              ? 'border-cyan-200 bg-cyan-300 text-slate-950'
                              : 'border-slate-700 bg-slate-900 text-slate-400 hover:text-slate-100'
                          }`}
                        >
                          {item.label}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="mt-4 overflow-hidden rounded-3xl border border-slate-800 bg-slate-900/50 p-3">
                    <div className="mb-3 flex flex-wrap gap-3">
                      {chartLines.map(line => (
                        <span key={line.key} className="inline-flex items-center gap-1.5 text-[10px] font-black uppercase tracking-[0.12em] text-slate-300">
                          <span className="h-2 w-2 rounded-full" style={{ backgroundColor: line.color }} />
                          {line.label}
                        </span>
                      ))}
                    </div>
                    {analyticsChartSeries.length > 0 ? (
                      <div className="overflow-x-auto">
                        <svg viewBox={`0 0 ${chartWidth} ${chartHeight}`} className="min-w-[620px] w-full">
                          {[0, 0.25, 0.5, 0.75, 1].map(step => {
                            const y = chartPadding.top + chartInnerHeight - step * chartInnerHeight
                            const value = Math.round(chartMaxValue * step)
                            return (
                              <g key={step}>
                                <line x1={chartPadding.left} y1={y} x2={chartWidth - chartPadding.right} y2={y} stroke="rgba(148,163,184,0.18)" strokeWidth="1" />
                                <text x={chartPadding.left - 10} y={y + 4} textAnchor="end" className="fill-slate-500 text-[10px] font-bold">{value}</text>
                              </g>
                            )
                          })}
                          <line x1={chartPadding.left} y1={chartPadding.top} x2={chartPadding.left} y2={chartHeight - chartPadding.bottom} stroke="rgba(148,163,184,0.35)" strokeWidth="1.5" />
                          <line x1={chartPadding.left} y1={chartHeight - chartPadding.bottom} x2={chartWidth - chartPadding.right} y2={chartHeight - chartPadding.bottom} stroke="rgba(148,163,184,0.35)" strokeWidth="1.5" />
                          {analyticsChartSeries.map((item, index) => (
                            <g key={`${item.label}-${index}`}>
                              <line x1={chartX(index)} y1={chartPadding.top} x2={chartX(index)} y2={chartHeight - chartPadding.bottom} stroke="rgba(148,163,184,0.08)" strokeWidth="1" />
                              <text x={chartX(index)} y={chartHeight - 16} textAnchor="middle" className="fill-slate-400 text-[10px] font-bold">{item.label}</text>
                            </g>
                          ))}
                          {chartLines.map(line => (
                            <g key={line.key}>
                              <path d={chartPath(line.key)} fill="none" stroke={line.color} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
                              {analyticsChartSeries.map((item, index) => (
                                <circle key={`${line.key}-${index}`} cx={chartX(index)} cy={chartY(Number(item[line.key] || 0))} r="4" fill={line.color}>
                                  <title>{`${line.label} - ${item.label}: ${item[line.key]}`}</title>
                                </circle>
                              ))}
                            </g>
                          ))}
                        </svg>
                      </div>
                    ) : null}
                    {analyticsChartSeries.length === 0 ? (
                      <p className="rounded-2xl border border-dashed border-slate-700 p-4 text-sm text-slate-400">Nessun evento ancora registrato.</p>
                    ) : null}
                  </div>
                </section>

                <section className="rounded-3xl border border-slate-800 bg-slate-950/75 p-4">
                  <h3 className="text-sm font-black text-white">Pagine più usate</h3>
                  <div className="mt-4 space-y-2">
                    {(analytics?.topPages || []).map(page => {
                      const maxPage = Math.max(...(analytics?.topPages || []).map(item => item.count), 1)
                      return (
                        <div key={page.page} className="rounded-2xl border border-slate-800 bg-slate-900/70 p-3">
                          <div className="flex items-center justify-between gap-3 text-xs">
                            <span className="truncate font-bold text-slate-200">{page.page}</span>
                            <span className="font-black text-cyan-100">{page.count}</span>
                          </div>
                          <div className="mt-2 h-2 overflow-hidden rounded-full bg-slate-800">
                            <div className="h-full rounded-full bg-cyan-300" style={{ width: `${Math.max(5, (page.count / maxPage) * 100)}%` }} />
                          </div>
                        </div>
                      )
                    })}
                    {(analytics?.topPages || []).length === 0 ? (
                      <p className="rounded-2xl border border-dashed border-slate-700 p-4 text-sm text-slate-400">Le pagine compariranno dopo aver eseguito `analytics.sql` e usato il sito.</p>
                    ) : null}
                  </div>
                </section>
              </div>

              <section className="rounded-3xl border border-slate-800 bg-slate-950/75 p-4">
                <h3 className="text-sm font-black text-white">Utenti più attivi</h3>
                <div className="mt-4 overflow-x-auto">
                  <table className="w-full min-w-[760px] text-left text-xs">
                    <thead className="text-slate-500">
                      <tr>
                        <th className="py-2 pr-3">Utente</th>
                        <th className="py-2 pr-3">Piano</th>
                        <th className="py-2 pr-3">Pagine</th>
                        <th className="py-2 pr-3">Ricerche</th>
                        <th className="py-2 pr-3">Scan</th>
                        <th className="py-2 pr-3">Pagina top</th>
                        <th className="py-2 pr-3">Ultimo accesso</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800 text-slate-300">
                      {(analytics?.topUsers || []).map(user => (
                        <tr key={user.userId}>
                          <td className="py-2 pr-3 font-black text-white">{user.username}</td>
                          <td className="py-2 pr-3 uppercase">{user.tier}</td>
                          <td className="py-2 pr-3">{user.pageViews}</td>
                          <td className="py-2 pr-3">{user.searches}</td>
                          <td className="py-2 pr-3">{user.scans}</td>
                          <td className="py-2 pr-3">{user.topPage}</td>
                          <td className="py-2 pr-3">{user.lastSeen ? new Date(user.lastSeen).toLocaleString('it-IT') : '-'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {(analytics?.topUsers || []).length === 0 ? (
                    <p className="rounded-2xl border border-dashed border-slate-700 p-4 text-sm text-slate-400">Nessun dettaglio utente ancora disponibile.</p>
                  ) : null}
                </div>
              </section>
            </div>
          ) : null}
        </div>

        <div className={activeSection === 'services' ? 'mt-6 rounded-[1.75rem] border border-amber-400/25 bg-slate-900/90 p-5' : 'hidden'}>
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="text-xl font-semibold text-white">Google Vision</h2>
              <p className="mt-1 text-sm text-slate-400">
                {scanUsage?.month ? `Mese ${scanUsage.month}` : 'Mese corrente'} · limite globale prima del blocco automatico.
              </p>
              {scanUsage?.error ? (
                <p className="mt-2 text-sm text-red-300">{scanUsage.error}</p>
              ) : null}
            </div>
            <div className="min-w-[220px] rounded-3xl border border-slate-800 bg-slate-950/80 p-4">
              <div className="flex items-end justify-between gap-4">
                <div>
                  <p className="text-3xl font-extrabold text-amber-300">{scanUsage?.scansUsed ?? 0}</p>
                  <p className="text-xs uppercase tracking-[0.2em] text-slate-500">usate</p>
                </div>
                <div className="text-right">
                  <p className="text-lg font-bold text-slate-200">{scanUsage?.scansLimit ?? 1000}</p>
                  <p className="text-xs uppercase tracking-[0.2em] text-slate-500">limite</p>
                </div>
              </div>
              <div className="mt-4 h-2 overflow-hidden rounded-full bg-slate-800">
                <div
                  className="h-full rounded-full bg-amber-400"
                  style={{
                    width: `${Math.min(100, ((scanUsage?.scansUsed ?? 0) / Math.max(scanUsage?.scansLimit ?? 1000, 1)) * 100)}%`
                  }}
                />
              </div>
              <p className="mt-2 text-xs text-slate-400">
                Rimaste {Math.max((scanUsage?.scansLimit ?? 1000) - (scanUsage?.scansUsed ?? 0), 0)}
              </p>
            </div>
          </div>
        </div>

        <div className={activeSection === 'services' ? 'mt-6 rounded-[1.75rem] border border-violet-300/25 bg-slate-900/90 p-5' : 'hidden'}>
          <div className="flex flex-col gap-5">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
              <div>
                <h2 className="text-xl font-semibold text-white">Catalogo OPV e immagini</h2>
                <p className="mt-1 max-w-2xl text-sm leading-6 text-slate-400">
                  Ricerca, scanner e deck leggono il catalogo Supabase. Le immagini vengono compresse e archiviate nel bucket Cloudflare R2.
                </p>
                {catalogSyncResult?.error ? <p className="mt-2 text-sm text-red-300">{catalogSyncResult.error}</p> : null}
                {systemHealth?.catalog?.last_error ? <p className="mt-2 text-xs text-amber-200">Ultimo avviso: {systemHealth.catalog.last_error}</p> : null}
              </div>
              <div className="flex flex-col gap-2 sm:flex-row">
                <button
                  type="button"
                  onClick={() => syncCatalogNow('catalog')}
                  disabled={Boolean(catalogSyncing)}
                  className="rounded-2xl border border-violet-200/40 bg-violet-300 px-4 py-3 text-sm font-black text-slate-950 transition active:scale-95 disabled:opacity-60"
                >
                  {catalogSyncing === 'catalog' ? 'Sincronizzo...' : 'Aggiorna catalogo'}
                </button>
                <button
                  type="button"
                  onClick={() => syncCatalogNow('images')}
                  disabled={Boolean(catalogSyncing) || (systemHealth?.catalog?.image_pending ?? 1) === 0}
                  className="rounded-2xl border border-cyan-200/40 bg-cyan-300 px-4 py-3 text-sm font-black text-slate-950 transition active:scale-95 disabled:opacity-60"
                >
                  {catalogSyncing === 'images' ? 'Copio...' : 'Copia prossimo lotto'}
                </button>
                <button
                  type="button"
                  onClick={() => syncCatalogNow('images', true)}
                  disabled={Boolean(catalogSyncing) || (systemHealth?.catalog?.image_pending ?? 1) === 0}
                  className="rounded-2xl border border-emerald-200/40 bg-emerald-300 px-4 py-3 text-sm font-black text-slate-950 transition active:scale-95 disabled:opacity-60"
                >
                  {catalogSyncing === 'images' ? 'Migrazione attiva...' : 'Migra tutte'}
                </button>
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {[
                ['Righe sorgente', systemHealth?.catalog?.source_rows ?? systemHealth?.tables?.catalogSources?.count ?? '-'],
                ['Carte catalogo', systemHealth?.catalog?.catalog_rows ?? systemHealth?.tables?.catalogCards?.count ?? '-'],
                ['Immagini R2', systemHealth?.catalog?.image_ready ?? systemHealth?.r2?.objects ?? '-'],
                ['Da copiare', systemHealth?.catalog?.image_pending ?? '-'],
              ].map(([label, value]) => (
                <div key={label} className="rounded-2xl border border-slate-800 bg-slate-950/75 p-3">
                  <p className="text-[9px] font-black uppercase tracking-[0.18em] text-slate-500">{label}</p>
                  <p className="mt-1 text-xl font-black text-violet-100">{value}</p>
                </div>
              ))}
            </div>

            <div className="rounded-2xl border border-slate-800 bg-slate-950/75 p-4">
              <div className="flex items-center justify-between gap-3 text-xs font-bold">
                <span className="text-slate-300">Cloudflare R2: {formatBytes(systemHealth?.r2?.bytes)}</span>
                <span className="text-slate-400">Blocco OPV a {formatBytes(systemHealth?.r2?.limitBytes || 9_000_000_000)}</span>
              </div>
              <div className="mt-3 h-2.5 overflow-hidden rounded-full bg-slate-800">
                <div
                  className="h-full rounded-full bg-cyan-300 transition-all"
                  style={{ width: `${Math.min(100, ((systemHealth?.r2?.bytes || 0) / Math.max(systemHealth?.r2?.limitBytes || 9_000_000_000, 1)) * 100)}%` }}
                />
              </div>
              <p className="mt-2 text-[11px] text-slate-500">Il caricamento si ferma automaticamente prima dei 10 GB inclusi nel piano R2.</p>
            </div>
          </div>
        </div>

        <div className={activeSection === 'status' ? 'mt-6 rounded-[1.75rem] border border-emerald-300/25 bg-slate-900/90 p-5' : 'hidden'}>
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="text-xl font-semibold text-white">Stato servizi</h2>
              <p className="mt-1 text-sm text-slate-400">
                Controllo reale di API, database, deploy, repository e storage con latenza e ultimo aggiornamento.
              </p>
              {systemHealth?.error ? <p className="mt-2 text-sm text-red-300">{systemHealth.error}</p> : null}
            </div>
            <button
              onClick={fetchSystemHealth}
              disabled={systemHealthLoading}
              className="inline-flex items-center justify-center gap-2 rounded-2xl border border-emerald-200/40 bg-emerald-300 px-4 py-3 text-sm font-black text-slate-950 shadow-lg shadow-emerald-950/20 transition hover:bg-emerald-200 disabled:opacity-60"
            >
              <Database size={17} />
              {systemHealthLoading ? 'Controllo...' : 'Aggiorna stato'}
            </button>
          </div>

          <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {(systemHealth?.services || []).map(service => {
              const tone = service.status === 'online'
                ? 'border-emerald-300/25 bg-emerald-300/[0.06] text-emerald-200'
                : service.status === 'degraded'
                  ? 'border-amber-300/25 bg-amber-300/[0.06] text-amber-200'
                  : 'border-rose-300/25 bg-rose-300/[0.06] text-rose-200'
              return (
                <div key={service.key} className={`rounded-2xl border p-4 ${tone}`}>
                  <div className="flex items-center justify-between gap-3">
                    <p className="font-black text-white">{service.label}</p>
                    <span className="inline-flex items-center gap-1.5 text-[9px] font-black uppercase tracking-[0.16em]">
                      <span className="h-2 w-2 rounded-full bg-current shadow-[0_0_10px_currentColor]" />
                      {service.status === 'online' ? 'Online' : service.status === 'degraded' ? 'Attenzione' : 'Offline'}
                    </span>
                  </div>
                  <p className="mt-2 min-h-10 text-xs leading-5 text-slate-300">{service.message}</p>
                  <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[10px] text-slate-500">
                    {service.latencyMs != null ? <span>{service.latencyMs} ms</span> : null}
                    {service.updatedAt ? <span>{service.updatedAt.includes('T') ? new Date(service.updatedAt).toLocaleString('it-IT') : service.updatedAt}</span> : null}
                  </div>
                </div>
              )
            })}
            {!systemHealthLoading && (systemHealth?.services || []).length === 0 ? (
              <p className="rounded-2xl border border-dashed border-slate-700 p-4 text-sm text-slate-400">Premi Aggiorna stato per eseguire i controlli.</p>
            ) : null}
          </div>

          <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {[
              ['Utenti', systemHealth?.tables?.profiles?.count ?? profiles.length],
              ['Carte salvate', systemHealth?.tables?.userCards?.count ?? '-'],
              ['Deck salvati', systemHealth?.tables?.userDecks?.count ?? '-'],
              ['Analytics rows', systemHealth?.tables?.analyticsEvents?.count ?? '-'],
              ['Chat 24H', systemHealth?.tables?.chatMessages?.count ?? '-'],
              ['Push device', systemHealth?.tables?.pushSubscriptions?.count ?? '-'],
              ['Annunci', systemHealth?.tables?.boardPosts?.count ?? '-'],
              ['Prezzi CM', systemHealth?.tables?.cardmarketPrices?.count ?? '-'],
              ['Catalogo', systemHealth?.tables?.catalogCards?.count ?? '-'],
              ['Righe sorgente', systemHealth?.tables?.catalogSources?.count ?? '-'],
            ].map(([label, value]) => (
              <div key={label} className="rounded-3xl border border-slate-800 bg-slate-950/75 p-4">
                <p className="text-xs uppercase tracking-[0.18em] text-slate-500">{label}</p>
                <p className="mt-2 text-2xl font-black text-emerald-100">{value}</p>
              </div>
            ))}
          </div>

          <div className="mt-4 grid gap-3 lg:grid-cols-4">
            <div className="rounded-3xl border border-slate-800 bg-slate-950/75 p-4">
              <p className="text-xs uppercase tracking-[0.18em] text-slate-500">Cloudflare R2</p>
              <p className="mt-2 text-sm font-black text-white">
                {systemHealth?.r2 ? `${formatBytes(systemHealth.r2.bytes)} / ${formatBytes(systemHealth.r2.limitBytes)}` : 'Dato non caricato'}
              </p>
            </div>
            <div className="rounded-3xl border border-slate-800 bg-slate-950/75 p-4">
              <p className="text-xs uppercase tracking-[0.18em] text-slate-500">Google Vision</p>
              <p className="mt-2 text-sm font-black text-white">
                {systemHealth?.scans ? `${systemHealth.scans.used}/${systemHealth.scans.limit} scan mese` : 'Dato non caricato'}
              </p>
            </div>
            <div className="rounded-3xl border border-slate-800 bg-slate-950/75 p-4">
              <p className="text-xs uppercase tracking-[0.18em] text-slate-500">Prezzi</p>
              <p className="mt-2 text-sm font-black text-white">
                {systemHealth?.prices?.latestSync ? new Date(systemHealth.prices.latestSync).toLocaleString('it-IT') : 'Nessun sync trovato'}
              </p>
            </div>
            <div className="rounded-3xl border border-slate-800 bg-slate-950/75 p-4">
              <p className="text-xs uppercase tracking-[0.18em] text-slate-500">Cron e retention</p>
              <div className="mt-2 space-y-1 text-xs font-bold text-slate-300">
                <p>CRON_SECRET: {systemHealth?.config?.cronSecretConfigured ? 'OK' : 'manca'}</p>
                <p>CARDMARKET_SYNC_SECRET: {systemHealth?.config?.cardmarketSyncSecretConfigured ? 'OK' : 'manca'}</p>
                <p>MAINTENANCE_SECRET: {systemHealth?.config?.maintenanceSecretConfigured ? 'OK' : 'manca'}</p>
                <p>Analytics retention: {systemHealth?.config?.analyticsRetentionDays ?? 180} giorni</p>
              </div>
            </div>
          </div>
        </div>

        <div className={activeSection === 'services' ? 'mt-6 rounded-[1.75rem] border border-cyan-300/25 bg-slate-900/90 p-5' : 'hidden'}>
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="text-xl font-semibold text-white">Aggiorna prezzi</h2>
              <p className="mt-1 text-sm text-slate-400">
                Il cron automatico gira 1 volta al giorno. Da qui puoi aggiornare manualmente quando vuoi.
              </p>
              {priceSyncResult ? (
                <p className={`mt-2 text-sm ${priceSyncResult.ok ? 'text-emerald-200' : 'text-red-300'}`}>
                  {priceSyncResult.ok
                    ? `Ultimo sync: ${priceSyncResult.updated ?? 0} prezzi aggiornati${priceSyncResult.syncedAt ? ` · ${new Date(priceSyncResult.syncedAt).toLocaleString('it-IT')}` : ''}`
                    : priceSyncResult.error || 'Sync fallito'}
                </p>
              ) : null}
            </div>
            <button
              onClick={syncPricesNow}
              disabled={priceSyncing}
              className="rounded-2xl border border-cyan-200/40 bg-cyan-300 px-4 py-3 text-sm font-black text-slate-950 shadow-lg shadow-cyan-950/20 transition hover:bg-cyan-200 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {priceSyncing ? 'Aggiorno...' : 'Aggiorna prezzi ora'}
            </button>
          </div>
        </div>

        {activeSection === 'cleanup' ? (
          <div className="mt-6 space-y-4">
            <section className="rounded-[1.75rem] border border-rose-300/20 bg-slate-900/90 p-5">
              <div className="flex items-start gap-3">
                <div className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-rose-400/10 text-rose-100">
                  <Eraser size={20} />
                </div>
                <div>
                  <h2 className="text-xl font-black text-white">Pulizia database</h2>
                  <p className="mt-1 text-sm leading-6 text-slate-400">
                    Le eliminazioni sono definitive. Per abilitare i pulsanti scrivi <strong className="text-rose-200">SVUOTA</strong> nel campo di conferma.
                  </p>
                </div>
              </div>

              <div className="mt-5 grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
                <label className="block">
                  <span className="mb-1.5 block text-[10px] font-black uppercase tracking-[0.2em] text-slate-500">Conferma operazioni</span>
                  <input
                    value={cleanupConfirmation}
                    onChange={event => setCleanupConfirmation(event.target.value.toUpperCase())}
                    placeholder="Scrivi SVUOTA"
                    className="w-full rounded-2xl border border-slate-700 bg-slate-950/80 px-4 py-3 text-base font-black text-white outline-none focus:border-rose-300"
                  />
                </label>
                <label className="block">
                  <span className="mb-1.5 block text-[10px] font-black uppercase tracking-[0.2em] text-slate-500">Utente per operazioni mirate</span>
                  <select
                    value={cleanupUserId}
                    onChange={event => setCleanupUserId(event.target.value)}
                    className="w-full rounded-2xl border border-slate-700 bg-slate-950/80 px-4 py-3 text-base text-white outline-none focus:border-cyan-300"
                  >
                    <option value="">Seleziona utente</option>
                    {profiles.map(profile => (
                      <option key={profile.id} value={profile.id}>{profile.username || profile.id}</option>
                    ))}
                  </select>
                </label>
              </div>
            </section>

            <div className="grid gap-3 sm:grid-cols-2">
              {cleanupActions.map(action => {
                const needsSelectedUser = action.needsUser && !cleanupUserId
                const isRunning = cleanupBusyKey === action.key
                const Icon = action.key.includes('chat') ? MessageCircle : action.key.includes('board') ? Database : Trash2
                return (
                  <section key={action.key} className={`rounded-[1.5rem] border p-4 ${action.tone === 'warning' ? 'border-amber-300/20 bg-amber-300/[0.055]' : 'border-rose-300/20 bg-rose-400/[0.055]'}`}>
                    <div className="flex items-start gap-3">
                      <span className={`grid h-10 w-10 shrink-0 place-items-center rounded-xl ${action.tone === 'warning' ? 'bg-amber-300/10 text-amber-100' : 'bg-rose-400/10 text-rose-100'}`}>
                        <Icon size={18} />
                      </span>
                      <div className="min-w-0">
                        <h3 className="font-black text-white">{action.title}</h3>
                        <p className="mt-1 text-xs leading-5 text-slate-400">{action.description}</p>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => void runCleanup(action)}
                      disabled={cleanupConfirmation !== 'SVUOTA' || needsSelectedUser || Boolean(cleanupBusyKey)}
                      className={`mt-4 w-full rounded-2xl border px-3 py-2.5 text-xs font-black transition active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-35 ${action.tone === 'warning' ? 'border-amber-300/25 bg-amber-300/10 text-amber-100' : 'border-rose-300/25 bg-rose-400/10 text-rose-100'}`}
                    >
                      {isRunning ? 'Operazione in corso...' : action.title}
                    </button>
                  </section>
                )
              })}
            </div>

            <div className="rounded-3xl border border-cyan-300/15 bg-cyan-300/[0.05] p-4 text-xs leading-5 text-slate-300">
              Il contatore mensile Google Vision non viene azzerato da questa pagina: deve restare allineato al consumo reale per proteggere il budget.
            </div>
          </div>
        ) : null}

        {activeSection === 'info' ? (
          <section className="mt-4 rounded-[1.75rem] border border-white/10 bg-slate-900/90 p-5">
            <div className="flex items-center gap-3">
              <Info size={20} className="text-cyan-100" />
              <div>
                <h2 className="text-lg font-black text-white">Informazioni operative</h2>
                <p className="mt-1 text-xs text-slate-400">Riepilogo della configurazione che mantiene attiva l’app.</p>
              </div>
            </div>
            <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {[
                ['Ambiente', 'Produzione Vercel'],
                ['Database', 'Supabase PostgreSQL'],
                ['Autenticazione', 'Supabase Auth + Google'],
                ['OCR', 'Google Cloud Vision'],
                ['Prezzi', 'Catalogo Cardmarket sincronizzato'],
                ['Carte', 'Catalogo OPV su Supabase'],
                ['Immagini', 'Cloudflare R2 con blocco a 9 GB'],
                ['Chat', 'Conservazione 24 ore'],
              ].map(([label, value]) => (
                <div key={label} className="rounded-2xl border border-slate-800 bg-slate-950/70 p-3">
                  <p className="text-[9px] font-black uppercase tracking-[0.18em] text-slate-500">{label}</p>
                  <p className="mt-1 text-sm font-bold text-slate-200">{value}</p>
                </div>
              ))}
            </div>
          </section>
        ) : null}

        <div className={activeSection === 'users' ? 'mt-8 grid gap-6' : 'hidden'}>
          <section className="rounded-[1.75rem] border border-slate-800/70 bg-slate-900/90 p-5">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h2 className="text-xl font-semibold text-white">Utenti</h2>
              </div>
              <div className="rounded-full bg-slate-800/80 px-3 py-1 text-xs uppercase tracking-[0.18em] text-slate-300">Totale {profiles.length}</div>
            </div>

            <label className="relative mt-4 block">
              <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" size={16} />
              <input
                value={userSearch}
                onChange={event => setUserSearch(event.target.value)}
                placeholder="Cerca utente per nickname o ID"
                className="w-full rounded-2xl border border-slate-700 bg-slate-950/75 py-3 pl-10 pr-3 text-base text-white outline-none focus:border-cyan-300"
              />
            </label>

            <div className="mt-6 space-y-3">
              {filteredProfiles.length === 0 ? (
                <div className="rounded-3xl border border-amber-500/30 bg-amber-500/10 p-6 text-center">
                  <p className="text-amber-200 font-semibold mb-2">{userSearch ? 'Nessun utente corrisponde alla ricerca' : 'Nessun profilo trovato'}</p>
                  <p className="text-sm text-amber-300/80 mb-4">
                    Gli utenti potrebbero non aver completato la registrazione o le policies RLS non sono configurate correttamente.
                  </p>
                  <div className="flex gap-2 justify-center">
                    <button
                      onClick={refreshData}
                      className="px-4 py-2 bg-amber-500/20 text-amber-200 border border-amber-500/30 rounded-lg hover:bg-amber-500/30"
                    >
                      Riprova
                    </button>
                  </div>
                </div>
              ) : (
                filteredProfiles.map((profile) => (
                <div key={profile.id} className="rounded-3xl border border-slate-800/80 bg-slate-950/80 p-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0">
                    <p className="font-semibold text-white truncate">{profile.username || 'Utente anonimo'}</p>
                    <p className="text-xs text-slate-500">ID: {profile.id}</p>
                    <div className="mt-1 flex flex-wrap gap-2 text-xs">
                      <span className="text-slate-400">
                        {Number(profile.username_change_credits || 0) > 0
                          ? `${profile.username_change_credits} modifiche extra`
                          : profile.username_changed_at
                            ? `Ultima modifica ${new Date(profile.username_changed_at).toLocaleDateString('it-IT')}`
                            : 'Modifica mensile disponibile'}
                      </span>
                      {profile.id === ADMIN_ACCOUNT.id ? (
                        <span className="rounded-full bg-rose-300/15 px-2 py-0.5 font-black text-rose-100">Admin</span>
                      ) : profile.is_vip || getDailyRewardVipUntil(profile.vip_note) ? (
                        <span className="rounded-full bg-amber-300/15 px-2 py-0.5 font-black text-amber-100">VIP</span>
                      ) : profile.is_premium ? (
                        <span className="rounded-full bg-cyan-300/15 px-2 py-0.5 font-black text-cyan-100">Premium</span>
                      ) : null}
                    </div>
                  </div>

                  <div className="flex flex-wrap gap-2">
                    <button
                      onClick={() => updateNicknameAsAdmin(profile)}
                      disabled={busy}
                      className="rounded-2xl border border-cyan-200/20 bg-cyan-300/10 px-3 py-2 text-xs font-semibold text-cyan-100 transition hover:bg-cyan-300/20 disabled:opacity-40"
                    >
                      Modifica nickname
                    </button>
                    <button
                      onClick={() => grantNicknameCredit(profile)}
                      disabled={busy}
                      className="rounded-2xl border border-violet-200/20 bg-violet-300/10 px-3 py-2 text-xs font-semibold text-violet-100 transition hover:bg-violet-300/20 disabled:opacity-40"
                    >
                      +1 modifica
                    </button>
                    <button
                      onClick={() => toggleVipUser(profile)}
                      disabled={busy || profile.id === ADMIN_ACCOUNT.id}
                      className={`rounded-2xl px-3 py-2 text-xs font-semibold transition ${profile.is_vip ? 'bg-slate-700 text-slate-200 border border-slate-600 hover:bg-slate-600' : 'bg-amber-300/15 text-amber-100 border border-amber-200/25 hover:bg-amber-300/25'} disabled:opacity-50`}
                    >
                      {profile.is_vip ? 'Togli VIP' : 'Dai VIP'}
                    </button>
                    <button
                      onClick={() => toggleBlockUser(profile)}
                      disabled={busy}
                      className={`rounded-2xl px-3 py-2 text-xs font-semibold transition ${profile.is_blocked ? 'bg-green-500/15 text-emerald-200 border border-emerald-500/20 hover:bg-green-500/20' : 'bg-amber-400/10 text-amber-200 border border-amber-300/20 hover:bg-amber-400/20'}`}
                    >
                      {profile.is_blocked ? 'Sblocca' : 'Blocca'}
                    </button>
                    <button
                      onClick={() => deleteUser(profile)}
                      disabled={busy || profile.id === ADMIN_ACCOUNT.id}
                      className="rounded-2xl bg-red-500/10 px-3 py-2 text-xs font-semibold text-red-200 border border-red-500/20 hover:bg-red-500/20 disabled:opacity-50"
                    >
                      Elimina
                    </button>
                  </div>
                </div>
              )))}
            </div>
          </section>

        </div>
      </div>
    </div>
  )
}
