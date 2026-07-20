'use client'

import { useCallback, useEffect, useState } from 'react'
import { Heart, Users, X } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import type { BinderRecord } from '@/lib/binders'

type BinderLike = {
  userId: string
  username: string
  avatarUrl: string | null
  createdAt: string
}

export default function BinderSocial({ binder }: { binder: BinderRecord }) {
  const router = useRouter()
  const [liked, setLiked] = useState(false)
  const [likes, setLikes] = useState(0)
  const [likeRows, setLikeRows] = useState<BinderLike[]>([])
  const [busy, setBusy] = useState(false)
  const [listOpen, setListOpen] = useState(false)
  const [error, setError] = useState('')

  const loadSocial = useCallback(async () => {
    const { data: { session } } = await supabase.auth.getSession()
    if (!session?.access_token) return

    const response = await fetch(`/api/binders/${encodeURIComponent(binder.id)}/likes`, {
      headers: { Authorization: `Bearer ${session.access_token}` },
      cache: 'no-store',
    })
    const data = await response.json().catch(() => null)
    if (!response.ok || !data?.ok) {
      setError(data?.error || 'Like non disponibili.')
      return
    }

    setLikes(Number(data.count || 0))
    setLiked(Boolean(data.liked))
    setLikeRows(Array.isArray(data.likes) ? data.likes : [])
    setError('')
  }, [binder.id])

  useEffect(() => {
    const timer = window.setTimeout(() => { void loadSocial() }, 0)
    return () => window.clearTimeout(timer)
  }, [loadSocial])

  const toggleLike = async () => {
    if (busy || !binder.is_shared) return
    setBusy(true)
    setError('')
    const { data: { session } } = await supabase.auth.getSession()
    if (!session?.access_token) {
      setError('Sessione scaduta.')
      setBusy(false)
      return
    }

    const response = await fetch(`/api/binders/${encodeURIComponent(binder.id)}/likes`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${session.access_token}` },
    })
    const data = await response.json().catch(() => null)
    if (!response.ok || !data?.ok) setError(data?.error || 'Operazione non riuscita.')
    else {
      setLiked(Boolean(data.liked))
      setLikes(Number(data.count || 0))
      await loadSocial()
    }
    setBusy(false)
  }

  if (!binder.is_shared) {
    return <div className="rounded-2xl border border-white/10 bg-slate-950/55 p-3 text-sm text-slate-400">Salva il raccoglitore per attivare i like.</div>
  }

  return (
    <>
      <section className="flex flex-col items-center gap-2 py-1">
        <div className="inline-flex overflow-hidden rounded-full border border-white/10 bg-slate-950/60 shadow-lg shadow-black/15">
          <button type="button" onClick={toggleLike} disabled={busy} className={`grid h-11 w-12 place-items-center border-r border-white/10 transition active:scale-90 disabled:opacity-50 ${liked ? 'bg-rose-400/16 text-rose-100' : 'text-slate-300 hover:bg-white/[0.05]'}`} aria-label={liked ? 'Togli Mi piace' : 'Metti Mi piace'}>
            <Heart size={19} fill={liked ? 'currentColor' : 'none'} />
          </button>
          <button type="button" onClick={() => setListOpen(true)} className="inline-flex h-11 items-center gap-2 px-4 text-sm font-black text-slate-200 transition hover:bg-white/[0.05] active:scale-95" aria-label="Vedi chi ha messo Mi piace">
            <Users size={16} className="text-cyan-200" /> {likes} Mi piace
          </button>
        </div>
        {error ? <p className="text-xs font-bold text-rose-200">{error}</p> : null}
      </section>

      {listOpen ? (
        <div className="fixed inset-0 z-[90] flex items-end justify-center bg-black/65 p-2 backdrop-blur-md sm:items-center sm:p-4" onClick={event => { if (event.target === event.currentTarget) setListOpen(false) }}>
          <section className="max-h-[72vh] w-full max-w-md overflow-hidden rounded-3xl border border-white/12 bg-[#102e37] shadow-2xl shadow-black/45">
            <header className="flex items-center justify-between border-b border-white/10 px-4 py-3">
              <div>
                <h2 className="text-base font-black text-white">Mi piace</h2>
                <p className="text-xs text-slate-400">{likes} {likes === 1 ? 'persona' : 'persone'}</p>
              </div>
              <button type="button" onClick={() => setListOpen(false)} className="grid h-9 w-9 place-items-center rounded-full border border-white/10 bg-white/[0.05] text-slate-200 transition active:scale-90" aria-label="Chiudi">
                <X size={18} />
              </button>
            </header>
            <div className="max-h-[58vh] overflow-y-auto p-2">
              {likeRows.length ? likeRows.map(person => (
                <button key={person.userId} type="button" onClick={() => { setListOpen(false); router.push(`/friends?profile=${encodeURIComponent(person.userId)}`) }} className="flex w-full items-center gap-3 rounded-2xl px-3 py-2.5 text-left transition hover:bg-white/[0.06] active:scale-[0.99]">
                  <span className="grid h-11 w-11 shrink-0 place-items-center overflow-hidden rounded-full border border-cyan-200/25 bg-slate-800 text-sm font-black text-cyan-100">
                    {person.avatarUrl ? <img src={person.avatarUrl} alt="" className="h-full w-full object-cover" /> : person.username.charAt(0).toUpperCase()}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-sm font-black text-white">{person.username}</span>
                </button>
              )) : (
                <div className="px-4 py-10 text-center">
                  <Heart className="mx-auto text-slate-600" size={28} />
                  <p className="mt-3 text-sm font-bold text-slate-400">Ancora nessun Mi piace.</p>
                </div>
              )}
            </div>
          </section>
        </div>
      ) : null}
    </>
  )
}
