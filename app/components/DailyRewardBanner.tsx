'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { ChevronRight, Sparkles } from 'lucide-react'
import { supabase } from '@/lib/supabase'

export default function DailyRewardBanner() {
  const router = useRouter()
  const [available, setAvailable] = useState(false)

  useEffect(() => {
    let cancelled = false

    const loadStatus = async () => {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session?.access_token) return

      try {
        const response = await fetch('/api/daily-reward', {
          headers: { Authorization: `Bearer ${session.access_token}` }
        })
        const data = await response.json()
        if (!cancelled) setAvailable(Boolean(response.ok && data?.available))
      } catch {
        if (!cancelled) setAvailable(false)
      }
    }

    void loadStatus()
    return () => { cancelled = true }
  }, [])

  if (!available) return null

  return (
    <button
      type="button"
      onClick={() => router.push('/reward')}
      className="group relative flex w-full items-center justify-between overflow-hidden rounded-2xl border border-amber-300/35 bg-[linear-gradient(110deg,rgba(120,82,14,0.3),rgba(251,191,36,0.14),rgba(120,82,14,0.3))] px-3 py-2.5 text-left shadow-[0_0_24px_rgba(251,191,36,0.12)] transition duration-300 hover:border-amber-200/60 hover:shadow-[0_0_32px_rgba(251,191,36,0.22)] active:scale-[0.985] sm:px-4"
    >
      <span className="pointer-events-none absolute inset-y-0 -left-1/3 w-1/3 skew-x-[-18deg] bg-gradient-to-r from-transparent via-white/25 to-transparent transition-transform duration-700 group-hover:translate-x-[430%]" />
      <span className="relative flex min-w-0 items-center gap-2.5">
        <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full border border-amber-200/40 bg-amber-300/15 text-amber-200 shadow-[0_0_18px_rgba(251,191,36,0.2)]">
          <Sparkles size={16} />
        </span>
        <span className="truncate text-xs font-black uppercase tracking-[0.08em] text-amber-100 sm:text-sm">
          Reward giornaliero disponibile, gioca ora
        </span>
      </span>
      <ChevronRight className="relative shrink-0 text-amber-200 transition-transform group-hover:translate-x-1" size={18} />
    </button>
  )
}

