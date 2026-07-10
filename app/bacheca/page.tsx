'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Bell, Megaphone, Search, Send, Sparkles, Users } from 'lucide-react'
import Sidebar from '@/app/components/Sidebar'
import Topbar from '@/app/components/Topbar'
import CardImage from '@/app/components/CardImage'
import { supabase } from '@/lib/supabase'

type ProfileItem = {
  id: string
  username: string | null
  avatar_url: string | null
}

type BoardPost = {
  id: string
  user_id: string
  type: 'announcement' | 'looking' | 'trade'
  title: string
  message: string | null
  card_id: string | null
  card_name: string | null
  card_code: string | null
  card_image_url: string | null
  card_rarity: string | null
  created_at: string
}

type CatalogCard = {
  id: string
  name: string
  image_url: string | null
  rarity: string | null
}

const BOARD_MAX_POSTS = 30
const BOARD_RETENTION_DAYS = 30

const displayCardId = (value?: string | null) =>
  (value || '')
    .replace(/_p\d+$/i, '')
    .replace(/^((?:OP|ST|EB|PRB|SP|EX|CP)\d{2}-\d{3}|P-\d{3}|DON-\d{3})p\d+$/i, '$1')

const timeLabel = (value?: string | null) => {
  if (!value) return 'Ora'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return 'Ora'
  return date.toLocaleDateString('it-IT', { day: '2-digit', month: 'short' })
}

const avatarInitial = (profile?: ProfileItem) =>
  (profile?.username || 'U').charAt(0).toUpperCase()

export default function BachecaPage() {
  const router = useRouter()
  const [userId, setUserId] = useState<string | null>(null)
  const [profiles, setProfiles] = useState<Record<string, ProfileItem>>({})
  const [friendIds, setFriendIds] = useState<string[]>([])
  const [posts, setPosts] = useState<BoardPost[]>([])
  const [loading, setLoading] = useState(true)
  const [boardReady, setBoardReady] = useState(true)
  const [posting, setPosting] = useState(false)
  const [message, setMessage] = useState('')
  const [cardQuery, setCardQuery] = useState('')
  const [cardResults, setCardResults] = useState<CatalogCard[]>([])
  const [selectedPostCard, setSelectedPostCard] = useState<CatalogCard | null>(null)
  const [cardSearchLoading, setCardSearchLoading] = useState(false)
  const [status, setStatus] = useState('')

  const visibleUserIds = useMemo(() => userId ? [userId, ...friendIds] : [], [userId, friendIds])

  useEffect(() => {
    const load = async () => {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session?.user) {
        router.push('/')
        return
      }

      const uid = session.user.id
      setUserId(uid)

      const { data: requests } = await supabase
        .from('friend_requests')
        .select('requester_id, receiver_id, status')
        .or(`requester_id.eq.${uid},receiver_id.eq.${uid}`)
        .eq('status', 'accepted')

      const friends = (requests || []).map((request: any) =>
        request.requester_id === uid ? request.receiver_id : request.requester_id
      )
      setFriendIds(friends)

      const allIds = [uid, ...friends]
      if (allIds.length > 0) {
        const { data: profileData } = await supabase
          .from('profiles')
          .select('id, username, avatar_url')
          .in('id', allIds)

        setProfiles(Object.fromEntries((profileData || []).map((profile: ProfileItem) => [profile.id, profile])))
      }

      await loadPosts(allIds)

      setLoading(false)
    }

    load()
  }, [router])

  useEffect(() => {
    const query = cardQuery.trim()
    if (query.length < 2 || selectedPostCard) {
      setCardResults([])
      setCardSearchLoading(false)
      return
    }

    const timer = window.setTimeout(async () => {
      setCardSearchLoading(true)
      try {
        const res = await fetch(`/api/cards/search?q=${encodeURIComponent(query)}`)
        const data = await res.json()
        const seen = new Set<string>()
        const cards = (Array.isArray(data) ? data : [])
          .map((card: any) => ({
            id: String(card.card_set_id ?? card.card_id ?? card.id ?? ''),
            name: card.card_name || card.name || 'Carta',
            image_url: card.card_image || card.image_url || null,
            rarity: card.rarity || null
          }))
          .filter((card: CatalogCard) => {
            if (!card.id || seen.has(card.id)) return false
            seen.add(card.id)
            return true
          })
          .slice(0, 10)
        setCardResults(cards)
      } catch {
        setCardResults([])
      }
      setCardSearchLoading(false)
    }, 220)

    return () => window.clearTimeout(timer)
  }, [cardQuery, selectedPostCard])

  const loadPosts = async (ids: string[]) => {
    if (ids.length === 0) return

    const cutoff = new Date()
    cutoff.setDate(cutoff.getDate() - BOARD_RETENTION_DAYS)

    const { data, error } = await supabase
      .from('board_posts')
      .select('id, user_id, type, title, message, card_id, card_name, card_code, card_image_url, card_rarity, created_at')
      .in('user_id', ids)
      .gte('created_at', cutoff.toISOString())
      .order('created_at', { ascending: false })
      .limit(BOARD_MAX_POSTS)

    if (error) {
      setBoardReady(false)
      setPosts([])
      return
    }

    setBoardReady(true)
    setPosts((data || []) as BoardPost[])
  }

  const cleanupOwnPosts = async (uid: string) => {
    const cutoff = new Date()
    cutoff.setDate(cutoff.getDate() - BOARD_RETENTION_DAYS)

    await supabase
      .from('board_posts')
      .delete()
      .eq('user_id', uid)
      .lt('created_at', cutoff.toISOString())

    const { data } = await supabase
      .from('board_posts')
      .select('id')
      .eq('user_id', uid)
      .order('created_at', { ascending: false })
      .range(BOARD_MAX_POSTS, BOARD_MAX_POSTS + 100)

    const staleIds = (data || []).map(post => post.id).filter(Boolean)
    if (staleIds.length > 0) {
      await supabase
        .from('board_posts')
        .delete()
        .eq('user_id', uid)
        .in('id', staleIds)
    }
  }

  const submitPost = async () => {
    if (!userId || posting) return

    const cleanMessage = message.trim()

    if (!selectedPostCard) {
      setStatus('Seleziona prima la carta dell\'annuncio.')
      return
    }

    if (cleanMessage.length < 6) {
      setStatus('Scrivi una descrizione, tipo cosa cerchi o cosa offri.')
      return
    }

    setPosting(true)
    setStatus('')

    const fallbackTitle = `Cerco ${selectedPostCard.name}`

    const { error } = await supabase
      .from('board_posts')
      .insert({
        user_id: userId,
        type: 'looking',
        title: fallbackTitle,
        message: cleanMessage || null,
        card_id: selectedPostCard.id,
        card_name: selectedPostCard.name,
        card_code: displayCardId(selectedPostCard.id),
        card_image_url: selectedPostCard.image_url,
        card_rarity: selectedPostCard.rarity
      })

    setPosting(false)

    if (error) {
      setBoardReady(false)
      setStatus('Per pubblicare annunci devi prima creare la tabella board_posts su Supabase.')
      return
    }

    setMessage('')
    setCardQuery('')
    setCardResults([])
    setSelectedPostCard(null)
    setStatus('Annuncio pubblicato in bacheca.')
    await cleanupOwnPosts(userId)
    await loadPosts(visibleUserIds)
  }

  const lookingPosts = posts.filter(post => post.type === 'looking').length
  const stats: Array<{ label: string; value: string; Icon: typeof Users }> = [
    { label: 'Amici', value: friendIds.length.toString(), Icon: Users },
    { label: 'Annunci', value: posts.length.toString(), Icon: Bell },
    { label: 'Cerco', value: lookingPosts.toString(), Icon: Search },
  ]

  return (
    <div className="min-h-screen overflow-x-hidden pt-14 text-white onepiece-wave-bg onepiece-clouds">
      <Sidebar activePage="bacheca" />
      <Topbar />

      <main className="mx-auto max-w-7xl px-3 pb-32 pt-4 sm:px-6 lg:px-8">
        <section className="overflow-hidden rounded-[1.8rem] border border-white/10 bg-slate-900/72 p-4 shadow-2xl shadow-black/20 backdrop-blur-xl sm:p-5">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <div className="inline-flex items-center gap-2 rounded-full border border-cyan-300/20 bg-cyan-300/10 px-3 py-2 text-[10px] font-black uppercase tracking-[0.24em] text-cyan-100">
                <Sparkles size={13} />
                Home
              </div>
              <h1 className="mt-3 text-3xl font-black text-white sm:text-4xl">Bacheca</h1>
              <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-300">
                Annunci, richieste, attivita amici e segnali utili dalla tua crew.
              </p>
              <p className="mt-1 text-xs font-semibold text-slate-500">
                Restano visibili gli ultimi {BOARD_MAX_POSTS} annunci degli ultimi {BOARD_RETENTION_DAYS} giorni.
              </p>
            </div>
            <div className="grid grid-cols-3 gap-2">
              {stats.map(({ label, value, Icon }) => {
                const StatIcon = Icon
                return (
                  <div key={String(label)} className="min-w-0 rounded-2xl border border-white/10 bg-white/[0.055] p-3">
                    <div className="flex items-center gap-1.5 text-cyan-100">
                      <StatIcon size={14} />
                      <span className="truncate text-[9px] font-black uppercase tracking-[0.16em]">{label}</span>
                    </div>
                    <p className="mt-1 truncate text-sm font-black text-white sm:text-base">{String(value)}</p>
                  </div>
                )
              })}
            </div>
          </div>
        </section>

        <section className="mt-4 rounded-[1.6rem] border border-white/10 bg-slate-900/75 p-3 backdrop-blur-xl sm:p-4">
          <div className="flex items-center gap-2 text-[10px] font-black uppercase tracking-[0.24em] text-cyan-200">
            <Megaphone size={15} />
            Nuovo annuncio
          </div>
          <div className="mt-3 rounded-2xl border border-cyan-300/20 bg-cyan-300/[0.08] px-3 py-2 text-xs font-black uppercase tracking-[0.18em] text-cyan-100">
            Cerco
          </div>
          <div className="mt-3 space-y-2">
            {selectedPostCard ? (
              <div className="grid grid-cols-[72px_minmax(0,1fr)] gap-3 rounded-2xl border border-cyan-300/20 bg-cyan-300/[0.07] p-2">
                <CardImage
                  src={selectedPostCard.image_url}
                  cardId={selectedPostCard.id}
                  alt={selectedPostCard.name}
                  className="aspect-[3/4] overflow-hidden rounded-xl bg-slate-950"
                />
                <div className="min-w-0 py-1">
                  <p className="line-clamp-2 text-sm font-black text-white">{selectedPostCard.name}</p>
                  <p className="mt-1 text-[10px] uppercase tracking-[0.18em] text-slate-400">{displayCardId(selectedPostCard.id)}</p>
                  {selectedPostCard.rarity && <p className="mt-1 text-[10px] font-black text-cyan-100">{selectedPostCard.rarity}</p>}
                  <button
                    type="button"
                    onClick={() => {
                      setSelectedPostCard(null)
                      setCardQuery('')
                    }}
                    className="mt-2 rounded-full border border-white/10 px-3 py-1 text-[10px] font-black text-slate-200"
                  >
                    Cambia carta
                  </button>
                </div>
              </div>
            ) : (
              <div className="space-y-2">
                <label className="relative block">
                  <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" size={16} />
                  <input
                    value={cardQuery}
                    onChange={event => setCardQuery(event.target.value)}
                    placeholder="Cerca carta per nome o codice"
                    className="w-full rounded-2xl border border-slate-700 bg-slate-950/70 py-3 pl-10 pr-3 text-sm text-white outline-none focus:border-cyan-300"
                  />
                </label>
                {cardSearchLoading ? (
                  <p className="rounded-2xl border border-slate-700 bg-slate-950/50 p-3 text-sm text-slate-400">Cerco carta...</p>
                ) : cardResults.length > 0 ? (
                  <div className="max-h-72 space-y-2 overflow-y-auto rounded-2xl border border-slate-700 bg-slate-950/65 p-2">
                    {cardResults.map(card => (
                      <button
                        key={card.id}
                        type="button"
                        onClick={() => {
                          setSelectedPostCard(card)
                          setCardQuery(card.name)
                          setCardResults([])
                        }}
                        className="grid w-full grid-cols-[48px_minmax(0,1fr)] gap-3 rounded-xl p-2 text-left transition hover:bg-white/[0.06]"
                      >
                        <CardImage src={card.image_url} cardId={card.id} alt={card.name} className="aspect-[3/4] overflow-hidden rounded-lg bg-slate-900" />
                        <span className="min-w-0">
                          <span className="block truncate text-sm font-black text-white">{card.name}</span>
                          <span className="mt-1 block text-[10px] uppercase tracking-[0.18em] text-slate-500">{displayCardId(card.id)}</span>
                          <span className="mt-1 block text-[10px] font-black text-cyan-100">{card.rarity || 'Carta'}</span>
                        </span>
                      </button>
                    ))}
                  </div>
                ) : cardQuery.trim().length >= 2 ? (
                  <p className="rounded-2xl border border-slate-700 bg-slate-950/50 p-3 text-sm text-slate-400">Nessuna carta trovata.</p>
                ) : null}
              </div>
            )}
            <textarea value={message} onChange={event => setMessage(event.target.value)} placeholder="Esempio: cerco x2 di questa carta, pago bene, contattatemi." rows={4} className="w-full resize-none rounded-2xl border border-slate-700 bg-slate-950/70 px-3 py-3 text-sm text-white outline-none focus:border-cyan-300" />
            <button onClick={submitPost} disabled={posting} className="flex w-full items-center justify-center gap-2 rounded-2xl bg-cyan-300 px-4 py-3 text-sm font-black text-slate-950 disabled:opacity-60">
              <Send size={16} />
              {posting ? 'Pubblico...' : 'Pubblica'}
            </button>
            {status && <p className="rounded-2xl border border-white/10 bg-white/[0.055] p-3 text-sm text-slate-300">{status}</p>}
          </div>
        </section>

        <section className="mt-4 rounded-[1.6rem] border border-white/10 bg-slate-900/75 p-3 backdrop-blur-xl sm:p-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-[10px] font-black uppercase tracking-[0.24em] text-cyan-200">Bacheca</p>
              <h2 className="mt-1 text-xl font-black text-white">Annunci</h2>
            </div>
            <Bell className="text-cyan-100" size={22} />
          </div>

          {!boardReady && (
            <div className="mt-3 rounded-2xl border border-amber-300/25 bg-amber-300/10 p-3 text-sm text-amber-100">
              Gli annunci sono pronti nel sito, ma manca la tabella Supabase. Esegui `board_posts.sql` per attivarli.
            </div>
          )}

          {loading ? (
            <p className="mt-3 rounded-2xl border border-slate-700 p-4 text-sm text-slate-400">Carico bacheca...</p>
          ) : posts.length === 0 ? (
            <div className="mt-3 rounded-3xl border border-dashed border-slate-700 bg-slate-950/55 p-5 text-center">
              <p className="text-lg font-black text-white">Ancora nessun annuncio</p>
              <p className="mt-2 text-sm text-slate-400">Pubblica una carta che stai cercando per farla vedere ai tuoi amici.</p>
            </div>
          ) : (
            <div className="mt-3 space-y-2">
              {posts.map(post => {
                const profile = profiles[post.user_id]
                return (
                  <article key={post.id} className="rounded-3xl border border-slate-700 bg-slate-950/65 p-3">
                    <div className="flex gap-3">
                      <div className="grid h-11 w-11 shrink-0 place-items-center overflow-hidden rounded-full border border-cyan-300/25 bg-slate-800 text-sm font-black text-cyan-100">
                        {profile?.avatar_url ? <img src={profile.avatar_url} alt={profile.username || 'Avatar'} className="h-full w-full object-cover" /> : avatarInitial(profile)}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-sm font-black text-white">{profile?.username || 'Giocatore'}</span>
                          <span className="rounded-full bg-cyan-300/12 px-2 py-1 text-[9px] font-black uppercase tracking-[0.16em] text-cyan-100">Cerca</span>
                          <span className="text-[10px] text-slate-500">{timeLabel(post.created_at)}</span>
                        </div>
                        <p className="mt-2 text-base font-black text-white">{post.title}</p>
                        {(post.card_name || post.card_code) && (
                          <div className="mt-2 grid grid-cols-[58px_minmax(0,1fr)] gap-3 rounded-2xl border border-cyan-300/15 bg-cyan-300/[0.06] p-2">
                            <CardImage
                              src={post.card_image_url}
                              cardId={post.card_id || post.card_code || ''}
                              alt={post.card_name || post.card_code || 'Carta'}
                              className="aspect-[3/4] overflow-hidden rounded-xl bg-slate-950"
                            />
                            <div className="min-w-0">
                              <p className="line-clamp-2 text-sm font-black text-cyan-50">{post.card_name || 'Carta'}</p>
                              <p className="mt-1 text-[10px] uppercase tracking-[0.18em] text-slate-500">{post.card_code}</p>
                              {post.card_rarity && <p className="mt-1 text-[10px] font-black text-cyan-100">{post.card_rarity}</p>}
                            </div>
                          </div>
                        )}
                        {post.message && <p className="mt-2 text-sm leading-6 text-slate-300">{post.message}</p>}
                      </div>
                    </div>
                  </article>
                )
              })}
            </div>
          )}
        </section>
      </main>
    </div>
  )
}
