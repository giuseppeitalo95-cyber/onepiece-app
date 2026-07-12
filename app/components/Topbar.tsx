'use client'

import { useEffect, useState } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import {
  emptyProgressSummary,
  evaluateProgressSynced,
  type ProgressSummary,
} from '@/lib/progression'
import { Crown, MessageCircle, ShieldCheck, Sparkle } from 'lucide-react'
import AchievementToasts from './AchievementToasts'
import AppLogo from './AppLogo'
import { getPremiumTier, premiumClassName, premiumLabel, type PremiumTier } from '@/lib/premium'

export default function Topbar() {
  const router = useRouter()
  const pathname = usePathname()

  const [username, setUsername] = useState('')
  const [avatarUrl, setAvatarUrl] = useState('')
  const [premiumTier, setPremiumTier] = useState<PremiumTier>('free')
  const [chatUnread, setChatUnread] = useState(0)
  const [loading, setLoading] = useState(true)
  const [progress, setProgress] = useState<ProgressSummary>(
    emptyProgressSummary()
  )
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
    let cancelled = false

    const loadProfile = async () => {
      const {
        data: { session },
      } = await supabase.auth.getSession()

      if (!session?.user) {
        if (!cancelled) setLoading(false)
        return
      }

      let { data, error } = await supabase
        .from('profiles')
        .select('username, avatar_url, is_premium, premium_until, is_vip')
        .eq('id', session.user.id)
        .maybeSingle()
      let profileData = data as any

      if (error) {
        const fallback = await supabase
          .from('profiles')
          .select('username, avatar_url')
          .eq('id', session.user.id)
          .maybeSingle()
        profileData = fallback.data as any
      }

      if (!profileData?.username && pathname !== '/complete-profile') {
        router.replace('/complete-profile')
        return
      }

      const { data: cardData } = await supabase
        .from('user_cards')
        .select(
          'card_id, quantity, name, rarity, card_color, card_type, card_cost, card_power, market_price, inventory_price'
        )
        .eq('user_id', session.user.id)

      await touchLastSeen(session.user.id)

      if (cancelled) return

      setProgress(
        await evaluateProgressSynced(session.user.id, cardData || [], {
          claimDaily: true,
        })
      )

      setUsername(profileData?.username || 'Utente')
      setAvatarUrl(profileData?.avatar_url || '')
      setPremiumTier(getPremiumTier(profileData, session.user))
      await loadChatUnread(session.user.id)
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

    const touchLastSeen = async (uid: string) => {
      await supabase
        .from('profiles')
        .update({ last_seen_at: new Date().toISOString() })
        .eq('id', uid)
    }

    loadProfile()

    const timer = window.setInterval(async () => {
      const { data: { session } } = await supabase.auth.getSession()
      if (session?.user) {
        await Promise.all([
          loadChatUnread(session.user.id),
          touchLastSeen(session.user.id),
        ])
      }
    }, 30000)

    const onChatChanged = async () => {
      const { data: { session } } = await supabase.auth.getSession()
      if (session?.user) await loadChatUnread(session.user.id)
    }

    window.addEventListener('opv:chat-unread-changed', onChatChanged)

    return () => {
      cancelled = true
      window.clearInterval(timer)
      window.removeEventListener('opv:chat-unread-changed', onChatChanged)
    }
  }, [pathname, router])

  return (
    <>
      <AchievementToasts />

      <div className="fixed left-0 right-0 top-0 z-40 flex h-14 items-center justify-between border-b border-white/12 bg-[#173842]/88 px-3 shadow-[0_14px_34px_rgba(0,0,0,0.22)] backdrop-blur-2xl sm:px-5">
        <div className="relative z-10 flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => router.push(premiumTier === 'admin' ? '/admin' : '/premium')}
            className={`op-premium-topbar flex h-10 items-center gap-1 rounded-full border px-2 text-[10px] font-black uppercase tracking-[0.12em] transition active:scale-95 sm:px-3 ${
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

            <span
              className="relative ml-1 grid h-10 w-10 shrink-0 place-items-center rounded-full p-[2px] sm:ml-0"
              style={{
                background: `conic-gradient(#facc15 ${
                  progress.progressPercent * 3.6
                }deg, rgba(255,255,255,0.12) 0deg)`,
              }}
              aria-label={`Livello ${progress.level}, ${Math.round(
                progress.progressPercent
              )} percento`}
            >
              <span className="grid h-full w-full place-items-center rounded-full border border-amber-100/30 bg-[#173842] text-[10px] font-black leading-none text-amber-100 shadow-[0_0_18px_rgba(250,204,21,0.24)]">
                LV
                <br />
                {progress.level}
              </span>
            </span>

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
    </>
  )
}
