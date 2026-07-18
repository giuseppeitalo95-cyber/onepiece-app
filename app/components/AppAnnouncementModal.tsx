'use client'

import { useEffect, useRef, useState } from 'react'
import { Megaphone } from 'lucide-react'
import { supabase } from '@/lib/supabase'

type Announcement = {
  id: string
  title: string
  message: string
  published_at: string
}

export default function AppAnnouncementModal() {
  const [announcement, setAnnouncement] = useState<Announcement | null>(null)
  const [closing, setClosing] = useState(false)
  const [error, setError] = useState('')
  const loadedForUser = useRef('')

  useEffect(() => {
    let cancelled = false

    const loadAnnouncement = async (force = false) => {
      const { data: { session } } = await supabase.auth.getSession()
      const userId = session?.user?.id || ''
      if (!session?.access_token || !userId) {
        loadedForUser.current = ''
        if (!cancelled) setAnnouncement(null)
        return
      }
      if (!force && loadedForUser.current === userId) return
      loadedForUser.current = userId

      const response = await fetch('/api/announcements', {
        cache: 'no-store',
        headers: { Authorization: `Bearer ${session.access_token}` }
      }).catch(() => null)
      const data = await response?.json().catch(() => null)
      if (!cancelled && response?.ok && data?.ok) {
        setAnnouncement(data.announcement || null)
      }
    }

    void loadAnnouncement()
    const { data: listener } = supabase.auth.onAuthStateChange(event => {
      if (event === 'SIGNED_IN') void loadAnnouncement(true)
      if (event === 'SIGNED_OUT') {
        loadedForUser.current = ''
        setAnnouncement(null)
      }
    })

    return () => {
      cancelled = true
      listener.subscription.unsubscribe()
    }
  }, [])

  const acknowledge = async () => {
    if (!announcement || closing) return
    setClosing(true)
    setError('')
    const { data: { session } } = await supabase.auth.getSession()
    const response = session?.access_token
      ? await fetch('/api/announcements', {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${session.access_token}`
          },
          body: JSON.stringify({ announcementId: announcement.id, action: 'acknowledge' })
        }).catch(() => null)
      : null

    if (response?.ok) {
      setAnnouncement(null)
    } else {
      setError('Non sono riuscito a salvare la conferma. Riprova.')
    }
    setClosing(false)
  }

  if (!announcement) return null

  return (
    <div className="fixed inset-0 z-[140] grid place-items-center overflow-y-auto bg-slate-950/78 px-4 py-8 backdrop-blur-md" role="dialog" aria-modal="true" aria-labelledby="opv-announcement-title">
      <div className="relative w-full max-w-lg overflow-hidden rounded-[1.75rem] border border-cyan-200/25 bg-slate-900 shadow-2xl shadow-black/50">
        <div className="h-1.5 bg-gradient-to-r from-cyan-300 via-amber-300 to-rose-300" />
        <div className="p-5 sm:p-7">
          <div className="flex items-start gap-4">
            <span className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl border border-amber-200/25 bg-amber-300/10 text-amber-100 shadow-lg shadow-amber-950/20">
              <Megaphone size={23} />
            </span>
            <div className="min-w-0">
              <p className="text-[10px] font-black uppercase tracking-[0.2em] text-cyan-200">Novita OPV</p>
              <h2 id="opv-announcement-title" className="mt-1 break-words text-2xl font-black leading-tight text-white sm:text-3xl">
                {announcement.title}
              </h2>
            </div>
          </div>

          <p className="mt-5 whitespace-pre-wrap break-words text-sm leading-7 text-slate-200 sm:text-base">
            {announcement.message}
          </p>
          {error ? <p className="mt-4 text-sm font-bold text-rose-200">{error}</p> : null}

          <button
            type="button"
            onClick={acknowledge}
            disabled={closing}
            className="mt-6 w-full rounded-2xl border border-cyan-100/30 bg-cyan-300 px-5 py-3.5 text-sm font-black text-slate-950 shadow-lg shadow-cyan-950/25 transition hover:bg-cyan-200 active:scale-[0.985] disabled:opacity-60"
          >
            {closing ? 'Salvo...' : 'Ho capito'}
          </button>
        </div>
      </div>
    </div>
  )
}
