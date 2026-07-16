'use client'

import { useCallback, useEffect, useState } from 'react'
import { Heart } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import type { BinderRecord } from '@/lib/binders'

export default function BinderSocial({ binder }: { binder: BinderRecord }) {
  const [userId, setUserId] = useState('')
  const [liked, setLiked] = useState(false)
  const [likes, setLikes] = useState(0)
  const [busy, setBusy] = useState(false)

  const loadSocial = useCallback(async () => {
    const { data: { session } } = await supabase.auth.getSession()
    if (!session?.user) return
    setUserId(session.user.id)

    const { data: likeRows, count } = await supabase
      .from('binder_likes')
      .select('user_id', { count: 'exact' })
      .eq('binder_id', binder.id)

    setLikes(count || 0)
    setLiked((likeRows || []).some(row => row.user_id === session.user.id))
  }, [binder.id])

  useEffect(() => {
    const timer = window.setTimeout(() => { void loadSocial() }, 0)
    return () => window.clearTimeout(timer)
  }, [loadSocial])

  const toggleLike = async () => {
    if (!userId || busy || !binder.is_shared) return
    setBusy(true)
    if (liked) await supabase.from('binder_likes').delete().eq('binder_id', binder.id).eq('user_id', userId)
    else await supabase.from('binder_likes').insert({ binder_id: binder.id, user_id: userId })
    await loadSocial()
    setBusy(false)
  }

  if (!binder.is_shared) {
    return <div className="rounded-2xl border border-white/10 bg-slate-950/55 p-3 text-sm text-slate-400">Salva il raccoglitore per attivare i like.</div>
  }

  return (
    <section className="flex justify-center py-1">
      <button type="button" onClick={toggleLike} disabled={busy} className={`inline-flex items-center gap-2 rounded-full border px-4 py-2.5 text-sm font-black transition active:scale-95 disabled:opacity-50 ${liked ? 'border-rose-300/45 bg-rose-400/16 text-rose-100' : 'border-white/10 bg-slate-950/60 text-slate-300'}`}>
        <Heart size={18} fill={liked ? 'currentColor' : 'none'} /> {likes} Mi piace
      </button>
    </section>
  )
}
