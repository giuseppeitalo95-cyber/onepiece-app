'use client'

import { useEffect, useState } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { emptyProgressSummary, evaluateProgress, type ProgressSummary } from '@/lib/progression'

export default function Topbar() {
  const router = useRouter()
  const pathname = usePathname()
  const [username, setUsername] = useState('')
  const [avatarUrl, setAvatarUrl] = useState('')
  const [loading, setLoading] = useState(true)
  const [progress, setProgress] = useState<ProgressSummary>(emptyProgressSummary())

  useEffect(() => {
    const loadProfile = async () => {
      const { data: { session } } = await supabase.auth.getSession()
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
        .select('card_id, quantity, name, rarity, card_color, card_type, card_cost, card_power, market_price, inventory_price')
        .eq('user_id', session.user.id)

      setProgress(evaluateProgress(session.user.id, cardData || [], { claimDaily: true }))
      setUsername(data?.username || 'Utente')
      setAvatarUrl(data?.avatar_url || '')
      setLoading(false)
    }

    loadProfile()
  }, [pathname, router])

  return (
    <div className="fixed left-0 right-0 top-0 z-40 flex h-14 items-center justify-end border-b border-white/12 bg-[#173842]/88 px-3 shadow-[0_14px_34px_rgba(0,0,0,0.22)] backdrop-blur-2xl sm:px-5">
      <div className="pointer-events-none absolute left-1/2 top-1/2 flex h-11 -translate-x-1/2 -translate-y-1/2 items-center gap-2 rounded-full border border-cyan-200/15 bg-white/[0.045] px-3 shadow-inner shadow-white/5">
        <span className="absolute inset-0 rounded-full bg-cyan-300/10 blur-md" />
        <img
          src="/luffyhatlogo.webp"
          className="relative h-9 w-9 object-contain opacity-95 drop-shadow-[0_0_14px_rgba(110,231,249,0.28)]"
          alt="Logo Cap"
        />
        <span className="relative whitespace-nowrap bg-gradient-to-r from-cyan-50 via-cyan-300 to-rose-200 bg-clip-text text-xs font-black tracking-[0.28em] text-transparent sm:text-sm">
          OPV
        </span>
      </div>

      <div className="flex min-w-0 shrink-0 items-center justify-end">
        <button
          onClick={() => router.push('/profile')}
          className="flex min-w-0 items-center rounded-full border border-white/10 bg-white/[0.06] p-1 shadow-inner shadow-white/5 transition hover:border-cyan-300/40 hover:bg-cyan-300/10 sm:gap-2 sm:px-2"
          aria-label="Apri profilo"
        >
          <div className="h-8 w-8 shrink-0 overflow-hidden rounded-full border border-cyan-300/35 bg-gradient-to-br from-cyan-200 to-rose-200 sm:h-9 sm:w-9">
            {avatarUrl ? (
              <img src={avatarUrl} alt="Avatar" className="h-full w-full object-cover" />
            ) : (
              <div className="flex h-full w-full items-center justify-center text-sm font-black text-slate-950">
                {(username || 'U').charAt(0).toUpperCase()}
              </div>
            )}
          </div>
          <span className="ml-1 rounded-full border border-cyan-200/25 bg-cyan-200/12 px-2 py-1 text-[10px] font-black text-cyan-50 sm:ml-0">
            LV {progress.level}
          </span>
          <span className="hidden max-w-[130px] truncate pr-1 text-xs font-bold text-cyan-50 sm:block">
            {loading ? '...' : username}
          </span>
        </button>
      </div>
    </div>
  )
}
