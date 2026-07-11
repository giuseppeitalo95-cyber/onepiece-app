'use client'

import { useEffect, useState } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import {
  emptyProgressSummary,
  evaluateProgress,
  type ProgressSummary,
} from '@/lib/progression'
import AchievementToasts from './AchievementToasts'
import AppLogo from './AppLogo'

export default function Topbar() {
  const router = useRouter()
  const pathname = usePathname()

  const [username, setUsername] = useState('')
  const [avatarUrl, setAvatarUrl] = useState('')
  const [loading, setLoading] = useState(true)
  const [progress, setProgress] = useState<ProgressSummary>(
    emptyProgressSummary()
  )

  useEffect(() => {
    const loadProfile = async () => {
      const {
        data: { session },
      } = await supabase.auth.getSession()

      if (!session?.user) {
        setLoading(false)
        return
      }

      const { data } = await supabase
        .from('profiles')
        .select('username, avatar_url')
        .eq('id', session.user.id)
        .maybeSingle()

      if (!data?.username && pathname !== '/complete-profile') {
        router.replace('/complete-profile')
        return
      }

      const { data: cardData } = await supabase
        .from('user_cards')
        .select(
          'card_id, quantity, name, rarity, card_color, card_type, card_cost, card_power, market_price, inventory_price'
        )
        .eq('user_id', session.user.id)

      setProgress(
        evaluateProgress(session.user.id, cardData || [], {
          claimDaily: true,
        })
      )

      setUsername(data?.username || 'Utente')
      setAvatarUrl(data?.avatar_url || '')
      setLoading(false)
    }

    loadProfile()
  }, [pathname, router])

  return (
    <>
      <AchievementToasts />

      <div className="fixed left-0 right-0 top-0 z-40 flex h-14 items-center justify-end border-b border-white/12 bg-[#173842]/88 px-3 shadow-[0_14px_34px_rgba(0,0,0,0.22)] backdrop-blur-2xl sm:px-5">
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

            <span className="hidden max-w-[130px] truncate pr-1 text-xs font-bold text-cyan-50 sm:block">
              {loading ? '...' : username}
            </span>
          </button>
        </div>
      </div>
    </>
  )
}