'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Bell, BookOpen, Megaphone, Search, Send, Trash2, X } from 'lucide-react'
import Sidebar from '@/app/components/Sidebar'
import Topbar from '@/app/components/Topbar'
import CardImage from '@/app/components/CardImage'
import BinderCover from '@/app/components/BinderCover'
import { supabase } from '@/lib/supabase'
import { normalizeBinder, type BinderRecord } from '@/lib/binders'
import { isAdminAccount } from '@/lib/admin'
import { trackAnalyticsEvent } from '@/lib/analytics'
import { getRarityLabel } from '@/lib/rarity'
import { validateUserText } from '@/lib/textModeration'
import {
  FREE_BOARD_DAILY_POST_LIMIT,
  FREE_BOARD_POST_DAYS,
  FREE_BOARD_WEEKLY_POST_LIMIT,
  PREMIUM_BOARD_POST_DAYS,
  getPremiumTier,
  premiumClassName,
  premiumLabel
} from '@/lib/premium'

type ProfileItem = {
  id: string
  username: string | null
  avatar_url: string | null
  is_premium?: boolean | null
  premium_until?: string | null
  is_vip?: boolean | null
  vip_note?: string | null
}

type BoardPost = {
  id: string
  user_id: string
  type: 'announcement' | 'looking' | 'trade' | 'binder'
  title: string
  message: string | null
  card_id: string | null
  card_name: string | null
  card_code: string | null
  card_image_url: string | null
  card_rarity: string | null
  binder_id: string | null
  created_at: string
  binder?: BinderRecord | null
  binder_group?: Array<{
    id: string
    binder_id: string | null
    title: string
    card_image_url: string | null
    created_at: string
    binder?: BinderRecord | null
  }>
}

type CatalogCard = {
  id: string
  name: string
  image_url: string | null
  rarity: string | null
}

type BoardCardDetail = {
  id: string
  name: string
  image_url: string | null
  rarity: string | null
}

type LivePriceResult = {
  marketPrice?: number | null
  midPrice?: number | null
  lowPrice?: number | null
  directLowPrice?: number | null
}

const BOARD_MAX_POSTS = 30
const BOARD_FETCH_POSTS = 80
const BOARD_RETENTION_DAYS = PREMIUM_BOARD_POST_DAYS
const FREE_DUPLICATE_BLOCK_DAYS = 7

const groupConsecutiveBinderPosts = (items: BoardPost[]) => {
  const grouped: BoardPost[] = []

  for (const post of items) {
    const previous = grouped[grouped.length - 1]
    if (post.type === 'binder' && previous?.type === 'binder' && previous.user_id === post.user_id) {
      const currentGroup = previous.binder_group || [{
        id: previous.id,
        binder_id: previous.binder_id,
        title: previous.title,
        card_image_url: previous.card_image_url,
        created_at: previous.created_at,
        binder: previous.binder,
      }]
      previous.binder_group = [...currentGroup, {
        id: post.id,
        binder_id: post.binder_id,
        title: post.title,
        card_image_url: post.card_image_url,
        created_at: post.created_at,
        binder: post.binder,
      }]
      continue
    }
    grouped.push({ ...post })
  }

  return grouped
}

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
  const [postType, setPostType] = useState<'looking' | 'trade'>('looking')
  const [boardSearch, setBoardSearch] = useState('')
  const [cardQuery, setCardQuery] = useState('')
  const [cardResults, setCardResults] = useState<CatalogCard[]>([])
  const [selectedPostCard, setSelectedPostCard] = useState<CatalogCard | null>(null)
  const [cardSearchLoading, setCardSearchLoading] = useState(false)
  const cardSearchRunRef = useRef(0)
  const [status, setStatus] = useState('')
  const [isAdmin, setIsAdmin] = useState(false)
  const [deletingPostId, setDeletingPostId] = useState('')
  const [selectedBoardCard, setSelectedBoardCard] = useState<BoardCardDetail | null>(null)
  const [selectedBoardCardPrice, setSelectedBoardCardPrice] = useState<number | null>(null)
  const [selectedBoardCardPriceLoading, setSelectedBoardCardPriceLoading] = useState(false)

  const visibleUserIds = useMemo(() => userId ? [userId, ...friendIds] : [], [userId, friendIds])
  const filteredPosts = useMemo(() => {
    const query = boardSearch.trim().toLocaleLowerCase('it-IT')
    if (!query) return posts
    return posts.filter(post => [post.card_name, post.card_code, post.title, post.message, post.binder_group?.map(item => item.title).join(' ')]
      .some(value => value?.toLocaleLowerCase('it-IT').includes(query)))
  }, [boardSearch, posts])

  const getAvatarPublicUrl = async (avatarPath: string | null) => {
    if (!avatarPath) return ''
    if (avatarPath.startsWith('http')) return avatarPath

    const { data } = supabase.storage
      .from('avatars')
      .getPublicUrl(avatarPath)

    return data?.publicUrl ?? ''
  }

  const resolveProfiles = async (ids: string[]) => {
    const uniqueIds = [...new Set(ids)].filter(Boolean)
    if (uniqueIds.length === 0) return {}

    const { data: profileData } = await supabase
      .from('profiles')
      .select('id, username, avatar_url, is_premium, premium_until, is_vip, vip_note')
      .in('id', uniqueIds)

    let safeProfileData: ProfileItem[] = (profileData || []) as ProfileItem[]
    if (!profileData) {
      const fallback = await supabase
        .from('profiles')
        .select('id, username, avatar_url')
        .in('id', uniqueIds)
      safeProfileData = (fallback.data || []) as ProfileItem[]
    }

    const resolvedProfiles = await Promise.all(
      safeProfileData.map(async (profile: ProfileItem) => ({
        ...profile,
        avatar_url: await getAvatarPublicUrl(profile.avatar_url)
      }))
    )

    return Object.fromEntries(resolvedProfiles.map((profile: ProfileItem) => [profile.id, profile])) as Record<string, ProfileItem>
  }

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
        const profileMap = await resolveProfiles(allIds)
        setProfiles(profileMap)
        setIsAdmin(isAdminAccount(session.user, profileMap[uid]))
        await loadPosts(allIds, profileMap)
      } else {
        await loadPosts(allIds, {})
      }

      setLoading(false)
    }

    load()
  }, [router])

  useEffect(() => {
    const query = cardQuery.trim()
    if (query.length < 2 || selectedPostCard) {
      cardSearchRunRef.current += 1
      setCardResults([])
      setCardSearchLoading(false)
      return
    }

    const timer = window.setTimeout(async () => {
      const runId = ++cardSearchRunRef.current
      setCardSearchLoading(true)
      try {
        const res = await fetch(`/api/cards/search?q=${encodeURIComponent(query)}`)
        const data = await res.json()
        if (runId !== cardSearchRunRef.current) return
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
        if (runId !== cardSearchRunRef.current) return
        setCardResults([])
      }
      if (runId !== cardSearchRunRef.current) return
      setCardSearchLoading(false)
    }, 220)

    return () => window.clearTimeout(timer)
  }, [cardQuery, selectedPostCard])

  const loadPosts = async (ids: string[], profileMap = profiles) => {
    if (ids.length === 0) return

    const cutoff = new Date()
    cutoff.setDate(cutoff.getDate() - BOARD_RETENTION_DAYS)

    const primary = await supabase
      .from('board_posts')
      .select('id, user_id, type, title, message, card_id, card_name, card_code, card_image_url, card_rarity, binder_id, created_at')
      .gte('created_at', cutoff.toISOString())
      .order('created_at', { ascending: false })
      .limit(BOARD_FETCH_POSTS)

    let boardError = primary.error
    let boardRows: unknown[] = primary.data || []
    if (primary.error) {
      const fallback = await supabase
        .from('board_posts')
        .select('id, user_id, type, title, message, card_id, card_name, card_code, card_image_url, card_rarity, created_at')
        .gte('created_at', cutoff.toISOString())
        .order('created_at', { ascending: false })
        .limit(BOARD_FETCH_POSTS)
      boardError = fallback.error
      boardRows = (fallback.data || []).map(row => ({ ...row, binder_id: null }))
    }

    if (boardError) {
      setBoardReady(false)
      setPosts([])
      return
    }

    const loadedPosts = boardRows as BoardPost[]
    const missingProfileIds = loadedPosts
      .map(post => post.user_id)
      .filter(id => id && !profileMap[id])
    const extraProfiles = await resolveProfiles(missingProfileIds)
    const fullProfileMap = { ...profileMap, ...extraProfiles }
    setProfiles(current => ({ ...current, ...fullProfileMap }))

    const visibleSet = new Set(ids)
    setBoardReady(true)
    const visiblePosts = loadedPosts.filter(post => {
      const profile = fullProfileMap[post.user_id]
      const tier = getPremiumTier(profile, { id: post.user_id })
      const days = tier === 'free' ? FREE_BOARD_POST_DAYS : PREMIUM_BOARD_POST_DAYS
      const cutoffForPost = new Date()
      cutoffForPost.setDate(cutoffForPost.getDate() - days)
      const stillVisible = new Date(post.created_at).getTime() >= cutoffForPost.getTime()
      const isVisibleToViewer = post.type === 'binder'
        ? visibleSet.has(post.user_id)
        : visibleSet.has(post.user_id) || tier !== 'free'
      return stillVisible && isVisibleToViewer
    })
    const binderIds = Array.from(new Set(visiblePosts
      .filter(post => post.type === 'binder' && post.binder_id)
      .map(post => post.binder_id as string)))
    const binderMap = new Map<string, BinderRecord>()

    if (binderIds.length > 0) {
      const { data: binderRows } = await supabase
        .from('binders')
        .select('*')
        .in('id', binderIds)

      for (const row of binderRows || []) {
        const binder = normalizeBinder(row)
        if (binder.id) binderMap.set(binder.id, binder)
      }
    }

    const enrichedPosts = visiblePosts.map(post => ({
      ...post,
      binder: post.binder_id ? binderMap.get(post.binder_id) || null : null,
    }))
    setPosts(groupConsecutiveBinderPosts(enrichedPosts).slice(0, BOARD_MAX_POSTS))
  }

  const cleanupOwnPosts = async (uid: string) => {
    const tier = getPremiumTier(profiles[uid], { id: uid })
    const days = tier === 'free' ? FREE_BOARD_POST_DAYS : PREMIUM_BOARD_POST_DAYS
    const cutoff = new Date()
    cutoff.setDate(cutoff.getDate() - days)

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

    const moderation = validateUserText(cleanMessage)
    if (!moderation.ok) {
      setStatus(moderation.message)
      return
    }

    setPosting(true)
    setStatus('')

    const fallbackTitle = `${postType === 'trade' ? 'Vendo' : 'Cerco'} ${selectedPostCard.name}`
    const ownTier = getPremiumTier(profiles[userId], { id: userId })

    if (ownTier === 'free') {
      const dayCutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
      const weekCutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()

      const { count: todayCount, error: todayError } = await supabase
        .from('board_posts')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', userId)
        .gte('created_at', dayCutoff)

      const { count: weekCount, error: weekError } = await supabase
        .from('board_posts')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', userId)
        .gte('created_at', weekCutoff)

      if (todayError || weekError) {
        setPosting(false)
        setStatus('Non riesco a controllare il limite annunci. Riprova tra poco.')
        return
      }

      if ((todayCount || 0) >= FREE_BOARD_DAILY_POST_LIMIT) {
        setPosting(false)
        setStatus(`Con il piano Free puoi pubblicare ${FREE_BOARD_DAILY_POST_LIMIT} annuncio al giorno.`)
        return
      }

      if ((weekCount || 0) >= FREE_BOARD_WEEKLY_POST_LIMIT) {
        setPosting(false)
        setStatus(`Con il piano Free puoi pubblicare massimo ${FREE_BOARD_WEEKLY_POST_LIMIT} annunci a settimana.`)
        return
      }

      const duplicateCutoff = new Date(Date.now() - FREE_DUPLICATE_BLOCK_DAYS * 24 * 60 * 60 * 1000).toISOString()
      const { data: recentSimilar, error: duplicateError } = await supabase
        .from('board_posts')
        .select('id')
        .eq('user_id', userId)
        .eq('type', postType)
        .or(`card_id.eq.${selectedPostCard.id},card_code.eq.${displayCardId(selectedPostCard.id)}`)
        .gte('created_at', duplicateCutoff)
        .limit(1)

      if (duplicateError) {
        setPosting(false)
        setStatus('Non riesco a controllare i duplicati. Riprova tra poco.')
        return
      }

      if ((recentSimilar || []).length > 0) {
        setPosting(false)
        setStatus(`Hai gia pubblicato un annuncio per questa carta negli ultimi ${FREE_DUPLICATE_BLOCK_DAYS} giorni.`)
        return
      }
    }

    const { error } = await supabase
      .from('board_posts')
      .insert({
        user_id: userId,
        type: postType,
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
    setPostType('looking')
    setCardQuery('')
    setCardResults([])
    setSelectedPostCard(null)
    setStatus('Annuncio pubblicato in bacheca.')
    void trackAnalyticsEvent('board_post', { cardId: selectedPostCard.id }, '/bacheca')
    await cleanupOwnPosts(userId)
    await loadPosts(visibleUserIds)
  }

  const openBoardProfile = (profileId: string) => {
    router.push(profileId === userId ? '/profile' : `/friends?profile=${profileId}`)
  }

  const contactPostOwner = (post: BoardPost) => {
    if (!userId || post.user_id === userId) return
    router.push(`/chat?user=${encodeURIComponent(post.user_id)}&post=${encodeURIComponent(post.id)}`)
  }

  const formatPrice = (value?: number | null) =>
    value == null ? '---' : new Intl.NumberFormat('it-IT', { style: 'currency', currency: 'EUR' }).format(value)

  const getLivePriceNumber = (price?: LivePriceResult | null) => {
    if (!price) return null
    return price.marketPrice ?? price.midPrice ?? price.directLowPrice ?? price.lowPrice ?? null
  }

  const openBoardCard = async (card: BoardCardDetail) => {
    setSelectedBoardCard(card)
    setSelectedBoardCardPrice(null)
    setSelectedBoardCardPriceLoading(true)

    try {
      const params = new URLSearchParams()
      params.set('cardId', card.id)
      params.set('name', card.name)
      const res = await fetch(`/api/cards/price?${params.toString()}`)
      const data = await res.json()
      setSelectedBoardCardPrice(getLivePriceNumber(data?.price))
    } catch {
      setSelectedBoardCardPrice(null)
    }

    setSelectedBoardCardPriceLoading(false)
  }

  const canDeletePost = (post: BoardPost) =>
    Boolean(userId && (post.user_id === userId || isAdmin))

  const deletePost = async (post: BoardPost) => {
    if (!userId || deletingPostId || !canDeletePost(post)) return

    const confirmed = window.confirm(
      post.user_id === userId
        ? 'Vuoi cancellare questo annuncio dalla bacheca?'
        : 'Vuoi cancellare questo annuncio come admin?'
    )
    if (!confirmed) return

    setDeletingPostId(post.id)
    setStatus('')

    const groupedIds = post.binder_group?.map(item => item.id) || [post.id]
    let query = supabase
      .from('board_posts')
      .delete()
      .in('id', groupedIds)

    if (!isAdmin) {
      query = query.eq('user_id', userId)
    }

    const { error } = await query

    setDeletingPostId('')

    if (error) {
      setStatus(isAdmin
        ? 'Non sono riuscito a cancellare il post. Se era di un altro utente, serve abilitare la policy admin su Supabase.'
        : 'Non sono riuscito a cancellare questo annuncio.')
      return
    }

    setPosts(current => current.filter(item => item.id !== post.id))
    setStatus('Annuncio cancellato.')
  }

  return (
    <div className="min-h-screen overflow-x-hidden pt-14 text-white onepiece-wave-bg onepiece-clouds">
      <Sidebar activePage="bacheca" />
      <Topbar />

      <main className="mx-auto max-w-7xl px-3 pb-32 pt-4 sm:px-6 lg:px-8">
        <h1 className="px-1 text-2xl font-black text-white sm:text-3xl">Bacheca</h1>

        <section className="mt-3 rounded-[1.6rem] border border-white/10 bg-slate-900/75 p-3 backdrop-blur-xl sm:p-4">
          <div className="flex items-center gap-2 text-sm font-black text-white">
            <Megaphone size={15} />
            Pubblica annuncio
          </div>
          <div className="mt-3 space-y-2">
            <div className="grid grid-cols-2 gap-2 rounded-2xl border border-slate-700 bg-slate-950/60 p-1.5">
              {(['looking', 'trade'] as const).map(type => (
                <button
                  key={type}
                  type="button"
                  onClick={() => setPostType(type)}
                  className={`rounded-xl px-3 py-2.5 text-sm font-black transition active:scale-[0.97] ${postType === type
                    ? type === 'trade'
                      ? 'bg-emerald-300 text-slate-950 shadow-lg shadow-emerald-950/20'
                      : 'bg-cyan-300 text-slate-950 shadow-lg shadow-cyan-950/20'
                    : 'text-slate-400 hover:bg-white/[0.06] hover:text-white'}`}
                >
                  {type === 'trade' ? 'Vendo' : 'Cerco'}
                </button>
              ))}
            </div>
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
                  {getRarityLabel(selectedPostCard) && <p className="mt-1 text-[10px] font-black text-cyan-100">{getRarityLabel(selectedPostCard)}</p>}
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
                          <span className="mt-1 block text-[10px] font-black text-cyan-100">{getRarityLabel(card) || 'Carta'}</span>
                        </span>
                      </button>
                    ))}
                  </div>
                ) : cardQuery.trim().length >= 2 ? (
                  <p className="rounded-2xl border border-slate-700 bg-slate-950/50 p-3 text-sm text-slate-400">Nessuna carta trovata.</p>
                ) : null}
              </div>
            )}
            <textarea value={message} onChange={event => setMessage(event.target.value)} placeholder={postType === 'trade' ? 'Esempio: vendo x2 copie, contattatemi.' : 'Esempio: cerco x2 copie, contattatemi.'} rows={4} className="w-full resize-none rounded-2xl border border-slate-700 bg-slate-950/70 px-3 py-3 text-sm text-white outline-none focus:border-cyan-300" />
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
              <p className="text-xl font-black text-white">Annunci</p>
            </div>
            <Bell className="text-cyan-100" size={22} />
          </div>

          <label className="relative mt-3 block">
            <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" size={16} />
            <input
              value={boardSearch}
              onChange={event => setBoardSearch(event.target.value)}
              placeholder="Cerca annunci per carta"
              className="w-full rounded-2xl border border-slate-700 bg-slate-950/70 py-3 pl-10 pr-10 text-base text-white outline-none focus:border-cyan-300"
            />
            {boardSearch ? (
              <button type="button" onClick={() => setBoardSearch('')} className="absolute right-2 top-1/2 grid h-8 w-8 -translate-y-1/2 place-items-center rounded-lg text-slate-400 active:scale-90" aria-label="Cancella ricerca">
                <X size={16} />
              </button>
            ) : null}
          </label>

          {!boardReady && (
            <div className="mt-3 rounded-2xl border border-amber-300/25 bg-amber-300/10 p-3 text-sm text-amber-100">
              Bacheca temporaneamente non disponibile.
            </div>
          )}

          {loading ? (
            <p className="mt-3 rounded-2xl border border-slate-700 p-4 text-sm text-slate-400">Carico bacheca...</p>
          ) : filteredPosts.length === 0 ? (
            <div className="mt-3 rounded-3xl border border-dashed border-slate-700 bg-slate-950/55 p-5 text-center">
              <p className="text-lg font-black text-white">{boardSearch ? 'Nessun annuncio trovato' : 'Ancora nessun annuncio'}</p>
              <p className="mt-2 text-sm text-slate-400">{boardSearch ? 'Prova con un altro nome o codice carta.' : 'Pubblica una carta che cerchi o vuoi vendere.'}</p>
            </div>
          ) : (
            <div className="mt-3 space-y-2">
              {filteredPosts.map(post => {
                const profile = profiles[post.user_id]
                const tier = getPremiumTier(profile, { id: post.user_id })
                const label = premiumLabel(tier)
                return (
                  <article key={post.id} className="rounded-3xl border border-slate-700 bg-slate-950/65 p-3">
                    <div className="flex gap-3">
                      <button
                        type="button"
                        onClick={() => openBoardProfile(post.user_id)}
                        className="grid h-11 w-11 shrink-0 place-items-center overflow-hidden rounded-full border border-cyan-300/25 bg-slate-800 text-sm font-black text-cyan-100 transition hover:border-cyan-200 hover:brightness-110 active:scale-95"
                        aria-label={`Apri profilo di ${profile?.username || 'Giocatore'}`}
                      >
                        {profile?.avatar_url ? <img src={profile.avatar_url} alt={profile.username || 'Avatar'} className="h-full w-full object-cover" /> : avatarInitial(profile)}
                      </button>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <button
                            type="button"
                            onClick={() => openBoardProfile(post.user_id)}
                            className={`text-sm font-black text-white transition hover:text-cyan-100 active:scale-[0.98] ${premiumClassName(tier)}`}
                          >
                            {profile?.username || 'Giocatore'}
                          </button>
                          {label ? (
                            <span className={`rounded-full border px-2 py-1 text-[9px] font-black uppercase tracking-[0.14em] ${
                              tier === 'admin'
                                ? 'border-rose-200/35 bg-rose-300/12 text-rose-100'
                                : tier === 'vip'
                                ? 'border-amber-200/35 bg-amber-300/12 text-amber-100'
                                : 'border-cyan-200/35 bg-cyan-300/12 text-cyan-100'
                            }`}>
                              {label}
                            </span>
                          ) : null}
                          <span className="text-[10px] text-slate-500">{timeLabel(post.created_at)}</span>
                          {canDeletePost(post) ? (
                            <button
                              type="button"
                              onClick={() => deletePost(post)}
                              disabled={deletingPostId === post.id}
                              className="ml-auto inline-flex items-center gap-1 rounded-full border border-rose-300/25 bg-rose-400/10 px-2 py-1 text-[9px] font-black uppercase tracking-[0.12em] text-rose-100 transition hover:bg-rose-400/18 disabled:opacity-50"
                              aria-label="Cancella annuncio"
                            >
                              <Trash2 size={11} />
                              {deletingPostId === post.id ? '...' : 'Elimina'}
                            </button>
                          ) : null}
                        </div>
                        <div className="mt-2 flex items-center gap-2">
                          <span className={`rounded-full px-2 py-1 text-[9px] font-black uppercase tracking-[0.14em] ${post.type === 'trade' ? 'bg-emerald-300/15 text-emerald-200' : post.type === 'binder' ? 'bg-amber-300/15 text-amber-100' : 'bg-cyan-300/15 text-cyan-100'}`}>
                            {post.type === 'trade' ? 'Vendo' : post.type === 'binder' ? 'Raccoglitore' : 'Cerco'}
                          </span>
                          <p className="min-w-0 flex-1 text-sm font-black leading-5 text-white sm:text-base">{post.type === 'binder' ? post.binder_group && post.binder_group.length > 1 ? `Ha creato ${post.binder_group.length} raccoglitori personalizzati` : post.message || 'Ha creato un raccoglitore personalizzato' : post.card_name || post.title}</p>
                        </div>
                        {post.type === 'binder' ? (
                          <div className="mt-2 space-y-2">
                            {(post.binder_group || [{ id: post.id, binder_id: post.binder_id, title: post.title, card_image_url: post.card_image_url, created_at: post.created_at, binder: post.binder }]).map(item => item.binder_id ? (
                              <button
                                key={item.id}
                                type="button"
                                onClick={() => router.push(`/binders/${item.binder_id}`)}
                                className="flex w-full items-center gap-3 rounded-2xl border border-amber-200/20 bg-amber-300/[0.07] p-3 text-left transition hover:border-amber-200/45 hover:bg-amber-300/[0.11] active:scale-[0.99]"
                              >
                                <span className="grid h-14 w-11 shrink-0 place-items-center overflow-hidden rounded-md border border-amber-100/20 bg-gradient-to-br from-cyan-900 to-slate-950 text-amber-100 shadow-lg">
                                  {item.binder ? (
                                    <BinderCover binder={item.binder} compact className="h-full w-full border-0 shadow-none" />
                                  ) : item.card_image_url ? (
                                    <img src={item.card_image_url} alt="" className="h-full w-full object-cover" />
                                  ) : (
                                    <BookOpen size={18} />
                                  )}
                                </span>
                                <span className="min-w-0 flex-1">
                                  <span className="block truncate text-sm font-black text-white">{`"${item.title}"`}</span>
                                  <span className="mt-1 block text-xs leading-5 text-slate-300">Vai a vederlo e lascia un like.</span>
                                </span>
                              </button>
                            ) : null)}
                          </div>
                        ) : null}
                        {(post.card_name || post.card_code) && (
                          <button
                            type="button"
                            onClick={() => openBoardCard({
                              id: post.card_id || post.card_code || '',
                              name: post.card_name || 'Carta',
                              image_url: post.card_image_url,
                              rarity: post.card_rarity
                            })}
                            className="mt-2 grid w-full grid-cols-[58px_minmax(0,1fr)] gap-3 rounded-2xl border border-cyan-300/15 bg-cyan-300/[0.06] p-2 text-left transition hover:border-cyan-200/45 hover:bg-cyan-300/[0.1] active:scale-[0.99]"
                          >
                            <CardImage
                              src={post.card_image_url}
                              cardId={post.card_id || post.card_code || ''}
                              alt={post.card_name || post.card_code || 'Carta'}
                              className="aspect-[3/4] overflow-hidden rounded-xl bg-slate-950"
                            />
                            <div className="min-w-0">
                              <p className="line-clamp-2 text-sm font-black text-cyan-50">{post.card_name || 'Carta'}</p>
                              <p className="mt-1 text-[10px] uppercase tracking-[0.18em] text-slate-500">{post.card_code}</p>
                              {getRarityLabel({ rarity: post.card_rarity, card_id: post.card_id, name: post.card_name }) && <p className="mt-1 text-[10px] font-black text-cyan-100">{getRarityLabel({ rarity: post.card_rarity, card_id: post.card_id, name: post.card_name })}</p>}
                            </div>
                          </button>
                        )}
                        {post.message && post.type !== 'binder' && <p className="mt-2 text-sm leading-6 text-slate-300">{post.message}</p>}
                        {post.user_id !== userId && post.type !== 'binder' ? (
                          <button
                            type="button"
                            onClick={() => contactPostOwner(post)}
                            className="mt-3 inline-flex w-full items-center justify-center gap-2 rounded-2xl border border-cyan-200/40 bg-cyan-300 px-4 py-3 text-sm font-black text-slate-950 shadow-lg shadow-cyan-950/20 transition hover:bg-cyan-200 active:scale-[0.99] sm:w-auto"
                          >
                            <Send size={15} />
                            Contatta
                          </button>
                        ) : null}
                      </div>
                    </div>
                  </article>
                )
              })}
            </div>
          )}
        </section>
      </main>

      {selectedBoardCard ? (
        <div
          className="fixed inset-0 z-[80] flex items-end justify-center bg-black/74 p-2 backdrop-blur-md sm:items-center sm:p-4"
          onClick={() => {
            setSelectedBoardCard(null)
            setSelectedBoardCardPrice(null)
          }}
        >
          <div className="w-full max-w-3xl overflow-hidden rounded-[1.75rem] border border-slate-700 bg-slate-950/97 shadow-2xl lg:max-w-5xl" onClick={event => event.stopPropagation()}>
            <div className="flex items-center justify-between border-b border-slate-800 p-3">
              <h3 className="min-w-0 truncate text-lg font-black text-white">{selectedBoardCard.name}</h3>
              <button
                onClick={() => {
                  setSelectedBoardCard(null)
                  setSelectedBoardCardPrice(null)
                }}
                className="grid h-10 w-10 place-items-center rounded-2xl border border-slate-700 bg-slate-800 text-slate-100"
                aria-label="Chiudi carta"
              >
                <X size={18} />
              </button>
            </div>
            <div className="grid max-h-[82dvh] gap-4 overflow-y-auto p-3 sm:grid-cols-[240px_1fr] lg:grid-cols-[360px_1fr] lg:gap-6 lg:p-5 xl:grid-cols-[420px_1fr]">
              <CardImage
                src={selectedBoardCard.image_url}
                cardId={selectedBoardCard.id}
                alt={selectedBoardCard.name}
                className="aspect-[3/4] overflow-hidden rounded-3xl bg-slate-950 lg:max-h-[70vh]"
              />
              <div className="space-y-3">
                <div>
                  <p className="text-2xl font-black text-white">{selectedBoardCard.name}</p>
                  <p className="mt-1 text-sm font-bold text-cyan-100">{displayCardId(selectedBoardCard.id)}</p>
                </div>
                <div className="grid grid-cols-2 gap-2 lg:gap-3">
                  {[
                    ['Rarita', getRarityLabel(selectedBoardCard) || '-'],
                    ['Prezzo Medio', selectedBoardCardPriceLoading ? '...' : formatPrice(selectedBoardCardPrice)],
                  ].map(([label, value]) => (
                    <div key={label} className="rounded-2xl border border-white/10 bg-white/[0.055] p-3">
                      <p className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-400">{label}</p>
                      <p className="mt-1 text-sm font-black text-white">{value}</p>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}
