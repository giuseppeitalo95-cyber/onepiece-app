'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { BookOpen, House, Layers3, LibraryBig, ScanLine, User, Users } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useLanguage } from './LanguageProvider'

type NavItem = {
  label: string
  href: string
  key: string
  Icon: LucideIcon
}

const navItems: NavItem[] = [
  { label: 'Collezione', href: '/dashboard', key: 'collezione', Icon: Layers3 },
  { label: 'Scanner', href: '/scan', key: 'scan', Icon: ScanLine },
  { label: 'Deck', href: '/decks', key: 'decks', Icon: LibraryBig },
  { label: 'Bacheca', href: '/bacheca', key: 'bacheca', Icon: House },
  { label: 'Raccoglitori', href: '/binders', key: 'binders', Icon: BookOpen },
  { label: 'Amici', href: '/friends', key: 'amici', Icon: Users },
  { label: 'Profilo', href: '/profile', key: 'profilo', Icon: User },
]

const getPageKey = (pathname: string) => {
  if (pathname.startsWith('/reward')) return 'collezione'
  if (pathname.startsWith('/bacheca')) return 'bacheca'
  if (pathname.startsWith('/scan')) return 'scan'
  if (pathname.startsWith('/dashboard')) return 'collezione'
  if (pathname.startsWith('/decks')) return 'decks'
  if (pathname.startsWith('/binders')) return 'binders'
  if (pathname.startsWith('/friends')) return 'amici'
  if (pathname.startsWith('/chat')) return 'chat'
  if (pathname.startsWith('/profile')) return 'profilo'
  return 'bacheca'
}

const badgeLabel = (value: number) => value > 9 ? '9+' : String(value)
const BADGE_CACHE_MS = 60_000

type BadgeCache = {
  userId: string
  expiresAt: number
  badges: Record<string, number>
}

const readBadgeCache = (userId: string): BadgeCache | null => {
  try {
    const raw = window.sessionStorage.getItem('opv_nav_badges')
    const cached = raw ? JSON.parse(raw) as BadgeCache : null
    return cached?.userId === userId && cached.expiresAt > Date.now() ? cached : null
  } catch {
    return null
  }
}

const writeBadgeCache = (value: BadgeCache) => {
  try {
    window.sessionStorage.setItem('opv_nav_badges', JSON.stringify(value))
  } catch {
    // La navigazione resta operativa anche con storage disabilitato.
  }
}

export default function Sidebar({ activePage }: { activePage?: string }) {
  const pathname = usePathname()
  const { t } = useLanguage()
  const currentPage = getPageKey(pathname || '/dashboard') || activePage || 'collezione'
  const [badges, setBadges] = useState<Record<string, number>>({})

  useEffect(() => {
    let cancelled = false

    const loadBadges = async () => {
      const { data: { session } } = await supabase.auth.getSession()
      const uid = session?.user?.id
      if (!uid) {
        if (!cancelled) setBadges({})
        return
      }
      const cached = readBadgeCache(uid)
      if (cached) {
        if (!cancelled) setBadges(cached.badges)
        return
      }

      const { count: friendRequestsCount } = await supabase
        .from('friend_requests')
        .select('id', { count: 'exact', head: true })
        .eq('receiver_id', uid)
        .eq('status', 'pending')

      const lastSeenKey = `opv_bacheca_seen_${uid}`
      const now = new Date().toISOString()
      let lastSeen = typeof window !== 'undefined' ? window.localStorage.getItem(lastSeenKey) : null
      if (!lastSeen && typeof window !== 'undefined') {
        lastSeen = now
        window.localStorage.setItem(lastSeenKey, now)
      }

      let boardCount = 0
      const { data: requests } = await supabase
        .from('friend_requests')
        .select('requester_id, receiver_id, status')
        .or(`requester_id.eq.${uid},receiver_id.eq.${uid}`)
        .eq('status', 'accepted')

      const friendIds = (requests || []).map((request: { requester_id: string; receiver_id: string }) =>
        request.requester_id === uid ? request.receiver_id : request.requester_id
      )

      if (friendIds.length > 0 && lastSeen) {
        const { count } = await supabase
          .from('board_posts')
          .select('id', { count: 'exact', head: true })
          .in('user_id', friendIds)
          .gt('created_at', lastSeen)
        boardCount = count || 0
      }

      if (!cancelled) {
        const nextBadges = {
          amici: friendRequestsCount || 0,
          bacheca: boardCount
        }
        setBadges(nextBadges)
        writeBadgeCache({ userId: uid, expiresAt: Date.now() + BADGE_CACHE_MS, badges: nextBadges })
      }
    }

    loadBadges()

    return () => {
      cancelled = true
    }
  }, [pathname])

  useEffect(() => {
    if (currentPage !== 'bacheca') return

    const markBoardSeen = async () => {
      const { data: { session } } = await supabase.auth.getSession()
      const uid = session?.user?.id
      if (!uid || typeof window === 'undefined') return

      window.localStorage.setItem(`opv_bacheca_seen_${uid}`, new Date().toISOString())
      setBadges(current => ({ ...current, bacheca: 0 }))
      const cached = readBadgeCache(uid)
      if (cached) writeBadgeCache({ ...cached, badges: { ...cached.badges, bacheca: 0 } })
    }

    markBoardSeen()
  }, [currentPage])

  return (
    <nav
      className="op-bottom-nav fixed inset-x-0 z-50 mx-auto flex w-[min(calc(100%-0.4rem),680px)] items-center justify-between rounded-[1.55rem] border border-white/16 bg-[#1a414b]/90 p-1 shadow-[0_18px_38px_rgba(0,0,0,0.24)] backdrop-blur-2xl sm:p-1.5"
      style={{ bottom: 'max(0.5rem, env(safe-area-inset-bottom))' }}
    >
      {navItems.map(({ label, href, key, Icon }) => {
        const active = currentPage === key
        const badge = badges[key] || 0

        return (
          <Link
            key={key}
            href={href}
            prefetch
            className={`relative flex min-w-0 flex-1 flex-col items-center justify-center gap-0.5 rounded-[1.15rem] px-0.5 py-2 text-[8px] font-black leading-none transition min-[390px]:text-[9px] sm:flex-row sm:gap-1.5 sm:px-1.5 sm:text-xs ${active
              ? 'op-nav-active text-slate-950'
              : 'text-slate-300 hover:bg-white/[0.08] hover:text-cyan-50'}`}
            aria-label={t(label)}
          >
            {active && <span className="pointer-events-none absolute inset-0 rounded-[1.15rem] bg-gradient-to-r from-cyan-300 to-rose-300" />}
            <span className={`relative flex h-5 w-5 items-center justify-center rounded-full sm:h-6 sm:w-6 ${active ? 'op-nav-icon bg-white/30' : ''}`}>
              <Icon size={active ? 18 : 17} strokeWidth={active ? 2.9 : 2.2} />
              {badge > 0 && (
                <span className="absolute -right-2 -top-2 grid h-4 min-w-4 place-items-center rounded-full bg-rose-400 px-1 text-[9px] font-black leading-none text-white shadow-[0_0_16px_rgba(251,113,133,0.65)] ring-2 ring-[#1a414b]">
                  {badgeLabel(badge)}
                </span>
              )}
            </span>
            <span className={`relative block w-full max-w-full whitespace-nowrap text-center ${key === 'binders' ? 'text-[7px] min-[390px]:text-[8px] sm:text-xs' : ''}`}>
              {t(label)}
              {badge > 0 && <span className="sr-only">, {badge} {t('notifiche')}</span>}
            </span>
          </Link>
        )
      })}
    </nav>
  )
}
