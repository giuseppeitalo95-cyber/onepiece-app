'use client'

import { useCallback, useEffect, useState } from 'react'
import { Heart, Send, Trash2 } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { isAdminAccount } from '@/lib/admin'
import { validateUserText } from '@/lib/textModeration'
import type { BinderComment, BinderRecord } from '@/lib/binders'

export default function BinderSocial({ binder }: { binder: BinderRecord }) {
  const [userId, setUserId] = useState('')
  const [isAdmin, setIsAdmin] = useState(false)
  const [liked, setLiked] = useState(false)
  const [likes, setLikes] = useState(0)
  const [comments, setComments] = useState<BinderComment[]>([])
  const [message, setMessage] = useState('')
  const [status, setStatus] = useState('')
  const [busy, setBusy] = useState(false)

  const loadSocial = useCallback(async () => {
    const { data: { session } } = await supabase.auth.getSession()
    if (!session?.user) return
    setUserId(session.user.id)

    const [{ data: profile }, { data: likeRows, count }, { data: commentRows }] = await Promise.all([
      supabase.from('profiles').select('username').eq('id', session.user.id).maybeSingle(),
      supabase.from('binder_likes').select('user_id', { count: 'exact' }).eq('binder_id', binder.id),
      supabase.from('binder_comments').select('id, binder_id, user_id, message, created_at').eq('binder_id', binder.id).order('created_at', { ascending: true }).limit(100),
    ])

    setIsAdmin(isAdminAccount(session.user, profile))
    setLikes(count || 0)
    setLiked((likeRows || []).some(row => row.user_id === session.user.id))

    const rows = (commentRows || []) as BinderComment[]
    const ids = [...new Set(rows.map(row => row.user_id))]
    const { data: profiles } = ids.length
      ? await supabase.from('profiles').select('id, username, avatar_url').in('id', ids)
      : { data: [] as Array<{ id: string; username: string | null; avatar_url: string | null }> }
    const profileMap = new Map((profiles || []).map(item => [item.id, item]))
    setComments(rows.map(row => ({ ...row, ...profileMap.get(row.user_id) })))
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

  const addComment = async () => {
    const clean = message.trim()
    if (!userId || busy || !clean || !binder.is_shared) return
    const moderation = validateUserText(clean)
    if (!moderation.ok) {
      setStatus(moderation.message)
      return
    }
    setBusy(true)
    const { error } = await supabase.from('binder_comments').insert({ binder_id: binder.id, user_id: userId, message: clean })
    setStatus(error ? 'Commento non inviato.' : '')
    if (!error) setMessage('')
    await loadSocial()
    setBusy(false)
  }

  const deleteComment = async (comment: BinderComment) => {
    if (!userId || (comment.user_id !== userId && !isAdmin)) return
    await supabase.from('binder_comments').delete().eq('id', comment.id)
    await loadSocial()
  }

  if (!binder.is_shared) {
    return <div className="rounded-2xl border border-white/10 bg-slate-950/55 p-3 text-sm text-slate-400">Salva il raccoglitore per attivare like e commenti.</div>
  }

  return (
    <section className="rounded-[1.5rem] border border-white/10 bg-slate-950/68 p-3 sm:p-5">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-lg font-black text-white">Commenti</h2>
        <button type="button" onClick={toggleLike} disabled={busy} className={`inline-flex items-center gap-2 rounded-full border px-3 py-2 text-sm font-black transition active:scale-95 ${liked ? 'border-rose-300/45 bg-rose-400/16 text-rose-100' : 'border-white/10 bg-white/[0.05] text-slate-300'}`}>
          <Heart size={17} fill={liked ? 'currentColor' : 'none'} /> {likes}
        </button>
      </div>

      <div className="mt-3 flex gap-2">
        <input value={message} onChange={event => setMessage(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') void addComment() }} maxLength={400} placeholder="Scrivi un commento" className="min-w-0 flex-1 rounded-2xl border border-slate-700 bg-slate-900 px-3 py-3 text-base text-white outline-none focus:border-cyan-300" />
        <button type="button" onClick={addComment} disabled={busy || !message.trim()} className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-cyan-300 text-slate-950 disabled:opacity-40" aria-label="Invia commento"><Send size={18} /></button>
      </div>
      {status ? <p className="mt-2 text-xs text-rose-200">{status}</p> : null}

      <div className="mt-4 space-y-2">
        {comments.length === 0 ? <p className="rounded-2xl border border-dashed border-slate-700 p-4 text-sm text-slate-400">Ancora nessun commento.</p> : comments.map(comment => (
          <article key={comment.id} className="flex gap-3 rounded-2xl border border-white/8 bg-white/[0.04] p-3">
            <div className="grid h-9 w-9 shrink-0 place-items-center overflow-hidden rounded-full bg-slate-800 text-xs font-black text-cyan-100">
              {comment.avatar_url ? <img src={comment.avatar_url} alt="" className="h-full w-full object-cover" /> : (comment.username || 'U').charAt(0).toUpperCase()}
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <p className="text-xs font-black text-white">{comment.username || 'Utente'}</p>
                <span className="text-[10px] text-slate-500">{new Date(comment.created_at).toLocaleDateString('it-IT')}</span>
              </div>
              <p className="mt-1 whitespace-pre-wrap break-words text-sm text-slate-300">{comment.message}</p>
            </div>
            {(comment.user_id === userId || isAdmin) ? <button type="button" onClick={() => deleteComment(comment)} className="grid h-8 w-8 shrink-0 place-items-center rounded-xl text-rose-200 hover:bg-rose-400/10" aria-label="Elimina commento"><Trash2 size={14} /></button> : null}
          </article>
        ))}
      </div>
    </section>
  )
}
