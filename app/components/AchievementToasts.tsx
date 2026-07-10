'use client'

import { useEffect, useState } from 'react'
import { Trophy } from 'lucide-react'
import type { BadgeDefinition } from '@/lib/progression'

type ToastBadge = BadgeDefinition & {
  toastId: string
}

export default function AchievementToasts() {
  const [toasts, setToasts] = useState<ToastBadge[]>([])

  useEffect(() => {
    const onUnlocked = (event: Event) => {
      const badges = (event as CustomEvent<{ badges?: BadgeDefinition[] }>).detail?.badges || []
      if (badges.length === 0) return

      const nextToasts = badges.slice(0, 3).map((badge) => ({
        ...badge,
        toastId: `${badge.id}-${Date.now()}-${Math.random()}`
      }))

      setToasts(prev => [...nextToasts, ...prev].slice(0, 3))

      for (const toast of nextToasts) {
        window.setTimeout(() => {
          setToasts(prev => prev.filter(item => item.toastId !== toast.toastId))
        }, 5200)
      }
    }

    window.addEventListener('opv:badges-unlocked', onUnlocked)
    return () => window.removeEventListener('opv:badges-unlocked', onUnlocked)
  }, [])

  if (toasts.length === 0) return null

  return (
    <div className="pointer-events-none fixed right-3 top-16 z-[90] flex w-[min(calc(100vw-1.5rem),360px)] flex-col gap-2 sm:right-5">
      {toasts.map((badge) => (
        <div
          key={badge.toastId}
          className="op-achievement-toast pointer-events-auto overflow-hidden rounded-[1.35rem] border border-amber-200/55 bg-[#17313a]/95 p-3 text-white shadow-[0_22px_55px_rgba(0,0,0,0.35)] backdrop-blur-2xl"
        >
          <div className="flex items-center gap-3">
            <div className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl border border-amber-100/30 bg-gradient-to-br from-amber-200 to-cyan-200 text-sm font-black text-slate-950 shadow-[0_0_22px_rgba(251,191,36,0.28)]">
              {badge.code}
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5 text-[10px] font-black uppercase tracking-[0.2em] text-amber-200">
                <Trophy size={13} />
                Badge sbloccato
              </div>
              <p className="mt-1 truncate text-sm font-black text-white">{badge.title}</p>
              <p className="mt-0.5 line-clamp-2 text-xs leading-4 text-cyan-100/80">{badge.description}</p>
              <p className="mt-1 text-xs font-black text-amber-100">+{badge.xp} EXP</p>
            </div>
          </div>
        </div>
      ))}
    </div>
  )
}
