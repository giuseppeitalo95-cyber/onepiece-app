'use client'

import { useEffect, useRef, useState } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { Crown, HelpCircle, MessageCircle, ShieldCheck, Sparkle, X } from 'lucide-react'
import AppLogo from './AppLogo'
import PushNotificationPrompt from './PushNotificationPrompt'
import { getPremiumTier, premiumClassName, premiumLabel, type PremiumProfile, type PremiumTier } from '@/lib/premium'
import { trackAnalyticsEvent } from '@/lib/analytics'
import { validateUserText } from '@/lib/textModeration'

type AdminNotice = {
  status?: string
  created_at?: string
  reporter_username?: string
  reporter_email?: string
  title?: string
  message?: string
  card_code?: string
  card_op?: string
  card_variant?: string
  card_name?: string
  kind: 'bug' | 'card'
}

type TopbarProfile = PremiumProfile & {
  username?: string | null
  avatar_url?: string | null
}

type CachedTopbarProfile = {
  userId: string
  expiresAt: number
  profile: TopbarProfile
}

const PROFILE_CACHE_KEY = 'opv:topbar-profile'
const PROFILE_CACHE_MS = 5 * 60 * 1000
const ACTIVITY_THROTTLE_MS = 10 * 60 * 1000
const UNREAD_FALLBACK_MS = 5 * 60 * 1000
const ADMIN_FALLBACK_MS = 60 * 1000

const readAdminNotices = (payload: unknown, kind: AdminNotice['kind']) => {
  if (!payload || typeof payload !== 'object') return []
  const reports = (payload as { reports?: unknown }).reports
  if (!Array.isArray(reports)) return []

  return reports.flatMap((item): AdminNotice[] => {
    if (!item || typeof item !== 'object') return []
    const report = item as Omit<AdminNotice, 'kind'>
    return report.status === 'resolved' ? [] : [{ ...report, kind }]
  })
}

export default function Topbar() {
  const router = useRouter()
  const pathname = usePathname()

  const [username, setUsername] = useState('')
  const [avatarUrl, setAvatarUrl] = useState('')
  const [premiumTier, setPremiumTier] = useState<PremiumTier>('free')
  const [chatUnread, setChatUnread] = useState(0)
  const [bugUnread, setBugUnread] = useState(0)
  const [bugOpen, setBugOpen] = useState(false)
  const [bugTitle, setBugTitle] = useState('')
  const [bugMessage, setBugMessage] = useState('')
  const [bugStatus, setBugStatus] = useState('')
  const [bugSending, setBugSending] = useState(false)
  const [loading, setLoading] = useState(true)
  const bugUnreadRef = useRef<number | null>(null)
  const isAdminRef = useRef(false)
  const tierLabel =
    premiumTier === 'admin'
      ? 'Admin'
      : premiumTier === 'vip'
      ? 'VIP'
      : premiumTier === 'premium'
      ? 'Premium'
      : 'Free'
  const TierIcon = premiumTier === 'admin' ? ShieldCheck : premiumTier === 'free' ? Sparkle : Crown

  useEffect(() => {
    if (!pathname || pathname === '/') return
    void trackAnalyticsEvent('page_view', {}, pathname)
  }, [pathname])

  const showBrowserNotification = async (title: string, body: string, url = '/admin') => {
    if (typeof window === 'undefined' || !('Notification' in window)) return
    if (Notification.permission !== 'granted') return

    try {
      if ('serviceWorker' in navigator) {
        const registration = await navigator.serviceWorker.ready
        await registration.showNotification(title, {
          body,
          icon: '/icon-192.png',
          badge: '/icon-192.png',
          data: { url }
        })
        return
      }

      new Notification(title, {
        body,
        icon: '/icon-192.png'
      })
    } catch {
      // Remote push remains the fallback when local display is blocked.
    }
  }

  useEffect(() => {
    let cancelled = false

    const readCachedProfile = (userId: string) => {
      try {
        const raw = window.sessionStorage.getItem(PROFILE_CACHE_KEY)
        if (!raw) return null
        const cached = JSON.parse(raw) as CachedTopbarProfile
        return cached.userId === userId && cached.expiresAt > Date.now()
          ? cached.profile
          : null
      } catch {
        return null
      }
    }

    const cacheProfile = (userId: string, profile: TopbarProfile) => {
      try {
        window.sessionStorage.setItem(PROFILE_CACHE_KEY, JSON.stringify({
          userId,
          expiresAt: Date.now() + PROFILE_CACHE_MS,
          profile,
        } satisfies CachedTopbarProfile))
      } catch {
      }
    }

    const touchActivity = async (uid: string) => {
      const key = `opv:last-activity:${uid}`
      try {
        const lastTouch = Number(window.localStorage.getItem(key) || 0)
        if (Date.now() - lastTouch < ACTIVITY_THROTTLE_MS) return
        window.localStorage.setItem(key, String(Date.now()))
      } catch {
      }

      await supabase
        .from('profiles')
        .update({ last_seen_at: new Date().toISOString() })
        .eq('id', uid)
    }

    const loadProfile = async () => {
      const {
        data: { session },
      } = await supabase.auth.getSession()

      if (!session?.user) {
        if (!cancelled) setLoading(false)
        return
      }

      let profileData = readCachedProfile(session.user.id)
      if (!profileData) {
        const { data, error } = await supabase
          .from('profiles')
          .select('username, avatar_url, is_premium, premium_until, is_vip, vip_note')
          .eq('id', session.user.id)
          .maybeSingle()
        profileData = data as TopbarProfile | null

        if (error) {
          const fallback = await supabase
            .from('profiles')
            .select('username, avatar_url')
            .eq('id', session.user.id)
            .maybeSingle()
          profileData = fallback.data as TopbarProfile | null
        }
        if (profileData) cacheProfile(session.user.id, profileData)
      }

      if (!profileData?.username && pathname !== '/complete-profile') {
        router.replace('/complete-profile')
        return
      }

      void touchActivity(session.user.id)

      if (cancelled) return

      setUsername(profileData?.username || 'Utente')
      setAvatarUrl(profileData?.avatar_url || '')
      const nextTier = getPremiumTier(profileData, session.user)
      setPremiumTier(nextTier)
      isAdminRef.current = nextTier === 'admin'
      await loadChatUnread(session.user.id)
      if (nextTier === 'admin') {
        await loadBugUnread()
      } else {
        bugUnreadRef.current = null
      }
      setLoading(false)
    }

    const loadChatUnread = async (uid: string) => {
      const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
      const { count } = await supabase
        .from('chat_messages')
        .select('id', { count: 'exact', head: true })
        .eq('receiver_id', uid)
        .is('read_at', null)
        .gte('created_at', cutoff)

      if (!cancelled) setChatUnread(count || 0)
    }

    const loadBugUnread = async () => {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session?.access_token) return

      const headers = { Authorization: `Bearer ${session.access_token}` }
      const [bugResponse, cardResponse] = await Promise.all([
        fetch('/api/bug-reports', { headers }).catch(() => null),
        fetch('/api/cards/report-missing', { headers }).catch(() => null),
      ])
      const [bugData, cardData] = await Promise.all([
        bugResponse?.json().catch(() => null),
        cardResponse?.json().catch(() => null),
      ])
      const bugPayload = bugData as { ok?: boolean } | null | undefined
      const cardPayload = cardData as { ok?: boolean } | null | undefined
      if (!cancelled && (bugPayload?.ok || cardPayload?.ok)) {
        const unresolvedBugs = readAdminNotices(bugData, 'bug')
        const unresolvedCards = readAdminNotices(cardData, 'card')
        const unresolvedReports = [...unresolvedBugs, ...unresolvedCards]
          .sort((a, b) => new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime())
        const nextCount = unresolvedReports.length
        const previousCount = bugUnreadRef.current
        setBugUnread(nextCount)
        bugUnreadRef.current = nextCount

        if (previousCount !== null && nextCount > previousCount) {
          const latest = unresolvedReports[0]
          const isCardError = latest?.kind === 'bug' && /^Errore carta\b/i.test(latest?.title || '')
          void showBrowserNotification(
            latest?.kind === 'card'
              ? 'Nuova carta assente'
              : isCardError ? 'Errore segnalato su una carta' : 'Nuova segnalazione bug',
            latest?.kind === 'card'
              ? `${latest?.card_code || latest?.card_op || 'Carta'} · ${latest?.card_variant || latest?.card_name || 'Variante non indicata'}`
              : `${latest?.reporter_username || latest?.reporter_email || 'Utente'}: ${latest?.title || latest?.message || 'Nuovo bug'}`,
            '/admin'
          )
        }
      }
    }

    loadProfile()

    const refreshVisibleState = async () => {
      if (document.visibilityState !== 'visible') return
      const { data: { session } } = await supabase.auth.getSession()
      if (session?.user) {
        await loadChatUnread(session.user.id)
        void touchActivity(session.user.id)
      }
    }

    const unreadTimer = window.setInterval(refreshVisibleState, UNREAD_FALLBACK_MS)
    const bugTimer = window.setInterval(() => {
      if (document.visibilityState === 'visible' && isAdminRef.current) void loadBugUnread()
    }, ADMIN_FALLBACK_MS)

    const onChatChanged = async () => {
      const { data: { session } } = await supabase.auth.getSession()
      if (session?.user) await loadChatUnread(session.user.id)
    }

    const onVisibilityChanged = () => {
      if (document.visibilityState === 'visible') void refreshVisibleState()
    }

    window.addEventListener('opv:chat-unread-changed', onChatChanged)
    window.addEventListener('focus', refreshVisibleState)
    document.addEventListener('visibilitychange', onVisibilityChanged)

    const onServiceWorkerMessage = (event: MessageEvent) => {
      if (event.data?.type === 'opv:navigate' && event.data?.url) {
        router.push(event.data.url)
        return
      }
      if (event.data?.type === 'opv:push') {
        const url = String(event.data?.url || '')
        if (url.startsWith('/chat')) void onChatChanged()
        if (url.startsWith('/admin') && isAdminRef.current) void loadBugUnread()
      }
    }
    navigator.serviceWorker?.addEventListener('message', onServiceWorkerMessage)

    return () => {
      cancelled = true
      window.clearInterval(unreadTimer)
      window.clearInterval(bugTimer)
      window.removeEventListener('opv:chat-unread-changed', onChatChanged)
      window.removeEventListener('focus', refreshVisibleState)
      document.removeEventListener('visibilitychange', onVisibilityChanged)
      navigator.serviceWorker?.removeEventListener('message', onServiceWorkerMessage)
    }
  }, [pathname, router])

  const showLocalBugNotification = async (title: string, message: string) => {
    if (premiumTier !== 'admin') return
    await showBrowserNotification(
      'Nuova segnalazione bug',
      `${username || 'Admin'}: ${title || message.slice(0, 80)}`,
      '/admin'
    )
  }

  const submitBugReport = async () => {
    if (bugSending) return
    setBugStatus('')

    if (bugMessage.trim().length < 5) {
      setBugStatus('Scrivi almeno una breve descrizione.')
      return
    }

    const moderation = validateUserText(`${bugTitle} ${bugMessage}`)
    if (!moderation.ok) {
      setBugStatus(moderation.message)
      return
    }

    setBugSending(true)
    const { data: { session } } = await supabase.auth.getSession()
    if (!session?.access_token) {
      setBugStatus('Sessione scaduta. Accedi di nuovo.')
      setBugSending(false)
      return
    }

    const res = await fetch('/api/bug-reports', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${session.access_token}`
      },
      body: JSON.stringify({
        title: bugTitle,
        message: bugMessage,
        pagePath: pathname
      })
    })
    const data = await res.json().catch(() => null)

    if (!res.ok || !data?.ok) {
      setBugStatus(data?.error || 'Invio segnalazione fallito.')
      setBugSending(false)
      return
    }

    if (premiumTier === 'admin') {
      setBugUnread(current => current + 1)
      void showLocalBugNotification(bugTitle, bugMessage)
    }

    setBugTitle('')
    setBugMessage('')
    setBugStatus('Segnalazione inviata.')
    setBugSending(false)
    window.setTimeout(() => {
      setBugOpen(false)
      setBugStatus('')
    }, 900)
  }

  return (
    <>
      <PushNotificationPrompt silent />
      <div className="fixed left-0 right-0 top-0 z-40 flex h-14 items-center justify-between border-b border-white/12 bg-[#173842]/88 px-3 shadow-[0_14px_34px_rgba(0,0,0,0.22)] backdrop-blur-2xl sm:px-5">
        <div className="relative z-10 flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => router.push(premiumTier === 'admin' ? '/admin' : '/premium')}
            className={`op-premium-topbar relative flex h-10 items-center gap-1 rounded-full border px-2 text-[10px] font-black uppercase tracking-[0.12em] transition active:scale-95 sm:px-3 ${
              premiumTier === 'admin'
                ? 'border-amber-200/35 bg-amber-300/15 text-amber-100 shadow-[0_0_18px_rgba(251,191,36,0.22)] hover:border-amber-100/60 hover:bg-amber-300/22'
                : premiumTier === 'vip'
                ? 'border-amber-200/40 bg-amber-300/12 text-amber-100 shadow-[0_0_18px_rgba(251,191,36,0.18)]'
                : premiumTier === 'premium'
                ? 'border-cyan-200/45 bg-cyan-300/18 text-cyan-50 shadow-[0_0_22px_rgba(103,232,249,0.32)]'
                : 'border-white/10 bg-white/[0.035] text-slate-500 hover:border-cyan-300/25 hover:text-slate-300'
            }`}
            aria-label={tierLabel}
          >
            <TierIcon size={15} />
            <span className="hidden min-[380px]:inline">{tierLabel}</span>
            {premiumTier === 'admin' && bugUnread > 0 ? (
              <span className="absolute -right-1 -top-1 grid h-5 min-w-5 place-items-center rounded-full bg-rose-400 px-1 text-[10px] font-black leading-none text-white shadow-[0_0_16px_rgba(251,113,133,0.65)] ring-2 ring-[#173842]">
                {bugUnread > 9 ? '9+' : bugUnread}
              </span>
            ) : null}
          </button>
          <button
            type="button"
            onClick={() => router.push('/chat')}
            className="relative grid h-10 w-10 place-items-center rounded-full border border-white/10 bg-white/[0.06] text-slate-300 transition hover:border-cyan-300/40 hover:bg-cyan-300/10 hover:text-cyan-50 active:scale-95"
            aria-label="Chat"
          >
            <MessageCircle size={17} />
            {chatUnread > 0 ? (
              <span className="absolute -right-1 -top-1 grid h-5 min-w-5 place-items-center rounded-full bg-rose-400 px-1 text-[10px] font-black leading-none text-white shadow-[0_0_16px_rgba(251,113,133,0.65)] ring-2 ring-[#173842]">
                {chatUnread > 9 ? '9+' : chatUnread}
              </span>
            ) : null}
          </button>
        </div>

        <div className="pointer-events-none absolute left-1/2 top-1/2 flex -translate-x-1/2 -translate-y-1/2 flex-col items-center justify-center">
          <AppLogo compact />
        </div>

        <div className="flex min-w-0 shrink-0 items-center justify-end">
          <button
            type="button"
            onClick={() => setBugOpen(true)}
            className="mr-1 grid h-9 w-9 place-items-center rounded-full border border-white/10 bg-white/[0.045] text-slate-300 transition hover:border-cyan-300/40 hover:bg-cyan-300/10 hover:text-cyan-50 active:scale-95 sm:mr-2 sm:h-10 sm:w-10"
            aria-label="Segnala bug"
          >
            <HelpCircle size={16} />
          </button>
          <button
            type="button"
            onClick={() => router.push('/profile')}
            className="flex min-w-0 items-center rounded-full border border-white/10 bg-white/[0.06] p-1 shadow-inner shadow-white/5 transition hover:border-cyan-300/40 hover:bg-cyan-300/10 sm:gap-2 sm:px-2"
            aria-label="Apri profilo"
          >
            <div className="h-8 w-8 shrink-0 overflow-hidden rounded-full border border-cyan-300/35 bg-gradient-to-br from-cyan-200 to-rose-200 sm:h-9 sm:w-9">
              {avatarUrl ? (
                <img
                  src={avatarUrl}
                  alt="Avatar"
                  className="h-full w-full object-cover"
                />
              ) : (
                <div className="flex h-full w-full items-center justify-center text-sm font-black text-slate-950">
                  {(username || 'U').charAt(0).toUpperCase()}
                </div>
              )}
            </div>

            <span className={`hidden max-w-[130px] truncate pr-1 text-xs font-bold text-cyan-50 sm:block ${premiumClassName(premiumTier)}`}>
              {loading ? '...' : username}
            </span>
            {premiumTier !== 'free' && (
              <span className={`hidden rounded-full border px-2 py-1 text-[9px] font-black uppercase leading-none sm:inline-flex ${
                premiumTier === 'admin'
                  ? 'border-rose-200/40 bg-rose-300/15 text-rose-100'
                  : premiumTier === 'vip'
                  ? 'border-amber-200/40 bg-amber-300/15 text-amber-100'
                  : 'border-cyan-200/40 bg-cyan-300/15 text-cyan-100'
              }`}>
                {premiumLabel(premiumTier)}
              </span>
            )}
          </button>
        </div>
      </div>

      {bugOpen ? (
        <div
          className="fixed inset-0 z-[80] flex items-end justify-center bg-black/65 p-2 backdrop-blur-md sm:items-center sm:p-4"
          onClick={(event) => {
            if (event.target === event.currentTarget && !bugSending) setBugOpen(false)
          }}
        >
          <div
            className="w-full max-w-md rounded-[1.5rem] border border-slate-700 bg-slate-950/97 p-4 shadow-2xl shadow-black/50"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-[10px] font-black uppercase tracking-[0.24em] text-cyan-200">Supporto</p>
                <h2 className="mt-1 text-lg font-black text-white">Segnala bug</h2>
                <p className="mt-1 text-xs text-slate-400">{pathname}</p>
              </div>
              <button
                type="button"
                onClick={() => setBugOpen(false)}
                disabled={bugSending}
                className="grid h-9 w-9 place-items-center rounded-xl border border-slate-700 bg-slate-900 text-slate-200 disabled:opacity-50"
                aria-label="Chiudi"
              >
                <X size={17} />
              </button>
            </div>

            <div className="mt-4 space-y-2">
              <input
                value={bugTitle}
                onChange={(event) => setBugTitle(event.target.value)}
                placeholder="Titolo breve, opzionale"
                className="w-full rounded-2xl border border-slate-700 bg-slate-900 px-3 py-3 text-sm text-white outline-none focus:border-cyan-300"
              />
              <textarea
                value={bugMessage}
                onChange={(event) => setBugMessage(event.target.value)}
                rows={5}
                placeholder="Descrivi cosa succede e cosa stavi facendo."
                className="w-full resize-none rounded-2xl border border-slate-700 bg-slate-900 px-3 py-3 text-sm text-white outline-none focus:border-cyan-300"
              />
              {bugStatus ? (
                <p className="rounded-2xl border border-white/10 bg-white/[0.055] px-3 py-2 text-sm text-slate-300">{bugStatus}</p>
              ) : null}
              <button
                type="button"
                onClick={submitBugReport}
                disabled={bugSending}
                className="w-full rounded-2xl bg-cyan-300 px-4 py-3 text-sm font-black text-slate-950 transition active:scale-[0.98] disabled:opacity-60"
              >
                {bugSending ? 'Invio...' : 'Invia segnalazione'}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  )
}
