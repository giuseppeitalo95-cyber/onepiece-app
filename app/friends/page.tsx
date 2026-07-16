'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { Check, Crown, Heart, Inbox, LibraryBig, MessageCircle, Search, UserPlus, Users, X } from 'lucide-react'
import Sidebar from '@/app/components/Sidebar'
import Topbar from '@/app/components/Topbar'
import CardImage from '@/app/components/CardImage'
import BinderCover from '@/app/components/BinderCover'
import { emptyProgressSummary, summarizeProgress, type ProgressSummary } from '@/lib/progression'
import { getPremiumTier, premiumClassName, premiumLabel } from '@/lib/premium'
import { isProfileOnline } from '@/lib/onlineStatus'
import { getRarityLabel } from '@/lib/rarity'
import { normalizeBinder, type BinderRecord } from '@/lib/binders'

type ProfileItem = {
  id: string
  username: string | null
  avatar_url: string | null
  is_premium?: boolean | null
  premium_until?: string | null
  is_vip?: boolean | null
  vip_note?: string | null
  last_seen_at?: string | null
}

type UserCard = {
  card_id: string
  name: string | null
  image_url: string | null
  rarity: string | null
  quantity: number
  card_color?: string | null
  card_type?: string | null
  card_cost?: number | null
  card_power?: number | null
  market_price?: number | null
  inventory_price?: number | null
}

type LivePriceResult = {
  marketPrice?: number | null
  midPrice?: number | null
  lowPrice?: number | null
  directLowPrice?: number | null
  originalCurrency?: string | null
}

type DeckCard = {
  card_id: string
  name: string | null
  image_url: string | null
  rarity: string | null
  quantity: number
  market_price?: number | null
  inventory_price?: number | null
}

type FriendDeck = {
  id: string
  name: string
  leader: DeckCard | null
  cards: DeckCard[]
  updated_at?: string | null
}

type FriendRequest = {
  id: string
  requester_id: string
  receiver_id: string
  status: string
  created_at: string
}

export default function FriendsPage() {
  const router = useRouter()
  const [userId, setUserId] = useState<string | null>(null)
  const [username, setUsername] = useState('')
  const [loading, setLoading] = useState(true)
  const [allProfiles, setAllProfiles] = useState<ProfileItem[]>([])
  const [requests, setRequests] = useState<FriendRequest[]>([])
  const [selectedProfile, setSelectedProfile] = useState<ProfileItem | null>(null)
  const [selectedCards, setSelectedCards] = useState<UserCard[]>([])
  const [selectedDecks, setSelectedDecks] = useState<FriendDeck[]>([])
  const [selectedBinders, setSelectedBinders] = useState<BinderRecord[]>([])
  const [selectedDeckValues, setSelectedDeckValues] = useState<Record<string, number | null>>({})
  const [selectedFriendDeck, setSelectedFriendDeck] = useState<FriendDeck | null>(null)
  const [selectedFriendCard, setSelectedFriendCard] = useState<(UserCard | DeckCard) | null>(null)
  const [selectedFriendCardPrice, setSelectedFriendCardPrice] = useState<number | null>(null)
  const [selectedFriendCardPriceLoading, setSelectedFriendCardPriceLoading] = useState(false)
  const [selectedProgress, setSelectedProgress] = useState<ProgressSummary>(emptyProgressSummary())
  const [searchTerm, setSearchTerm] = useState('')
  const [actionMessage, setActionMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const [openedProfileFromQuery, setOpenedProfileFromQuery] = useState('')

  useEffect(() => {
    const load = async () => {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session?.user) {
        router.push('/')
        return
      }

      const user = session.user
      setUserId(user.id)

      const [{ data: profileData }, { data: profileListData }, { data: requestData }] = await Promise.all([
        supabase
          .from('profiles')
          .select('username')
          .eq('id', user.id)
          .single(),
        supabase
          .from('profiles')
          .select('id, username, avatar_url, is_premium, premium_until, is_vip, vip_note, last_seen_at')
          .neq('id', user.id),
        supabase
          .from('friend_requests')
          .select('id, requester_id, receiver_id, status, created_at')
          .or(`requester_id.eq.${user.id},receiver_id.eq.${user.id}`)
          .order('created_at', { ascending: false })
      ])

      setUsername(profileData?.username ?? '')
      setRequests(requestData ?? [])

      let profiles: ProfileItem[] = (profileListData ?? []) as ProfileItem[]
      if (!profileListData) {
        const { data: fallbackProfiles } = await supabase
          .from('profiles')
          .select('id, username, avatar_url')
          .neq('id', user.id)
        profiles = (fallbackProfiles ?? []) as ProfileItem[]
      }
      const resolvedProfiles = await Promise.all(
        profiles.map(async (profile: ProfileItem) => {
          const resolved = await getAvatarPublicUrl(profile.avatar_url)
          return { ...profile, avatar_url: resolved }
        })
      )

      setAllProfiles(resolvedProfiles)
      setLoading(false)
    }

    load()
  }, [router])

  useEffect(() => {
    if (allProfiles.length === 0) return

    const refreshOnlineStatus = async () => {
      const ids = allProfiles.map(profile => profile.id)
      const { data, error } = await supabase
        .from('profiles')
        .select('id, last_seen_at')
        .in('id', ids)

      if (error || !data) return

      const lastSeenById = new Map((data as Array<{ id: string; last_seen_at?: string | null }>).map(profile => [profile.id, profile.last_seen_at ?? null]))
      setAllProfiles(current => current.map(profile => (
        lastSeenById.has(profile.id)
          ? { ...profile, last_seen_at: lastSeenById.get(profile.id) ?? null }
          : profile
      )))
      setSelectedProfile(current => (
        current && lastSeenById.has(current.id)
          ? { ...current, last_seen_at: lastSeenById.get(current.id) ?? null }
          : current
      ))
    }

    const timer = window.setInterval(refreshOnlineStatus, 30000)
    void refreshOnlineStatus()
    return () => window.clearInterval(timer)
  }, [allProfiles.length])

  const getAvatarPublicUrl = async (avatarPath: string | null) => {
    if (!avatarPath) return ''
    // If it's already a full URL, return it
    if (avatarPath.startsWith('http')) return avatarPath

    // If it's a relative path, get the public URL
    const { data: publicData } = supabase.storage
      .from('avatars')
      .getPublicUrl(avatarPath)

    return publicData?.publicUrl ?? ''
  }

  const resolvedRequests = useMemo(() => {
    const map = new Map<string, string>()
    requests.forEach((request) => {
      if (request.status === 'accepted') {
        const other = request.requester_id === userId ? request.receiver_id : request.requester_id
        map.set(other, 'friend')
      } else if (request.status === 'pending') {
        const other = request.requester_id === userId ? request.receiver_id : request.requester_id
        map.set(other, request.requester_id === userId ? 'sent' : 'incoming')
      }
    })
    return map
  }, [requests, userId])

  const friendIds = useMemo(() => {
    return requests
      .filter((request) => request.status === 'accepted')
      .map((request) => (request.requester_id === userId ? request.receiver_id : request.requester_id))
  }, [requests, userId])

  const incomingRequests = requests.filter(
    (request) => request.status === 'pending' && request.receiver_id === userId
  )

  const outgoingRequests = requests.filter(
    (request) => request.status === 'pending' && request.requester_id === userId
  )

  const friendProfiles = allProfiles.filter((profile) => friendIds.includes(profile.id))
  const peopleToShow = allProfiles.filter((profile) => {
    if (!searchTerm.trim()) return true
    return profile.username?.toLowerCase().includes(searchTerm.trim().toLowerCase())
  })

  useEffect(() => {
    const profileId = typeof window === 'undefined'
      ? ''
      : new URLSearchParams(window.location.search).get('profile') || ''
    if (!profileId || openedProfileFromQuery === profileId || allProfiles.length === 0) return

    const profile = allProfiles.find(item => item.id === profileId)
    if (!profile) return

    setOpenedProfileFromQuery(profileId)
    void openProfile(profile)
  }, [allProfiles, openedProfileFromQuery])

  const sendFriendRequest = async (profileId: string) => {
    if (!userId || busy) return
    setBusy(true)
    setActionMessage('Invio richiesta...')

    const existing = requests.find(
      (request) =>
        (request.requester_id === userId && request.receiver_id === profileId) ||
        (request.requester_id === profileId && request.receiver_id === userId)
    )

    if (existing) {
      setActionMessage('Hai già una richiesta in corso con questo giocatore.')
      setBusy(false)
      return
    }

    const { error } = await supabase
      .from('friend_requests')
      .insert([{ requester_id: userId, receiver_id: profileId, status: 'pending' }])

    if (error) {
      setActionMessage('Impossibile inviare la richiesta. Riprova.')
      setBusy(false)
      return
    }

    setActionMessage('Richiesta inviata! Aspetta la risposta.')
    await refreshRequests()
    setBusy(false)
  }

  const refreshRequests = async () => {
    if (!userId) return

    const { data: requestData } = await supabase
      .from('friend_requests')
      .select('id, requester_id, receiver_id, status, created_at')
      .or(`requester_id.eq.${userId},receiver_id.eq.${userId}`)
      .order('created_at', { ascending: false })

    setRequests(requestData ?? [])
  }

  const updateRequest = async (id: string, status: string) => {
    if (!userId || busy) return
    setBusy(true)
    setActionMessage('Aggiornamento in corso...')

    const { error } = await supabase
      .from('friend_requests')
      .update({ status })
      .eq('id', id)

    if (error) {
      setActionMessage('Errore durante l\'operazione. Riprova.')
      setBusy(false)
      return
    }

    setActionMessage(status === 'accepted' ? 'Hai accettato la richiesta!' : 'Richiesta rifiutata.')
    await refreshRequests()
    setBusy(false)
  }

  const openProfile = async (profile: ProfileItem) => {
    setSelectedProfile(profile)
    setSelectedDecks([])
    setSelectedBinders([])
    setSelectedDeckValues({})
    setSelectedFriendDeck(null)
    setSelectedFriendCard(null)
    setSelectedFriendCardPrice(null)
    if (!friendIds.includes(profile.id)) {
      setSelectedCards([])
      setSelectedProgress(emptyProgressSummary())
      return
    }

    const [{ data: cards }, { data: decks }, { data: binderRows }] = await Promise.all([
      supabase
        .from('user_cards')
        .select('card_id, name, image_url, rarity, quantity, card_color, card_type, card_cost, card_power, market_price, inventory_price')
        .eq('user_id', profile.id),
      supabase
        .from('user_decks')
        .select('id, name, leader, cards, updated_at')
        .eq('user_id', profile.id)
        .order('updated_at', { ascending: false }),
      supabase
        .from('binders')
        .select('*')
        .eq('user_id', profile.id)
        .eq('is_shared', true)
        .order('updated_at', { ascending: false })
    ])

    const baseCards = (cards ?? []).map(card => ({
      ...card,
      rarity: card.rarity === 'Unknown' ? null : card.rarity,
      card_color: card.card_color === 'Unknown' ? null : card.card_color,
      market_price: null,
      inventory_price: null
    }))
    setSelectedCards(baseCards)
    setSelectedProgress(summarizeProgress(baseCards))

    const friendDecks = (decks ?? []).map((deck: any) => ({
      id: String(deck.id),
      name: deck.name || 'Deck senza nome',
      leader: deck.leader || null,
      cards: Array.isArray(deck.cards) ? deck.cards : [],
      updated_at: deck.updated_at || null
    }))
    setSelectedDecks(friendDecks)
    setSelectedBinders((binderRows || []).map(normalizeBinder))
    void loadFriendDeckValues(friendDecks)

    const prices = await fetchLivePricesForCards(baseCards)
    const pricedCards = baseCards.map(card => {
      const price = getLivePriceNumber(prices[card.card_id])
      return price == null ? card : { ...card, market_price: price, inventory_price: null }
    })

    setSelectedCards(pricedCards)
    setSelectedProgress(summarizeProgress(pricedCards))
  }

  const closeModal = () => {
    setSelectedProfile(null)
    setSelectedCards([])
    setSelectedDecks([])
    setSelectedDeckValues({})
    setSelectedFriendDeck(null)
    setSelectedFriendCard(null)
    setSelectedFriendCardPrice(null)
    setSelectedProgress(emptyProgressSummary())
  }

  const isFriend = selectedProfile ? friendIds.includes(selectedProfile.id) : false
  const selectedRequest = selectedProfile
    ? requests.find(
        (request) =>
          (request.requester_id === userId && request.receiver_id === selectedProfile.id) ||
          (request.requester_id === selectedProfile.id && request.receiver_id === userId)
      )
    : null
  const getLivePriceNumber = (price?: LivePriceResult | null) => {
    if (!price) return null
    return price.marketPrice ?? price.midPrice ?? price.directLowPrice ?? price.lowPrice ?? null
  }
  const fetchLivePricesForCards = async (cardsToPrice: Array<{ card_id: string; name?: string | null }>) => {
    try {
      const res = await fetch('/api/cards/prices', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          cards: cardsToPrice.map(card => ({
            cardId: card.card_id,
            name: card.name
          }))
        })
      })
      const data = await res.json()
      return (data?.prices || {}) as Record<string, LivePriceResult | null>
    } catch {
      return {}
    }
  }
  const openFriendCard = async (card: UserCard | DeckCard) => {
    setSelectedFriendCard(card)
    setSelectedFriendCardPrice(null)
    setSelectedFriendCardPriceLoading(true)

    try {
      const params = new URLSearchParams()
      params.set('cardId', card.card_id)
      if (card.name) params.set('name', card.name)

      const res = await fetch(`/api/cards/price?${params.toString()}`)
      const data = await res.json()
      setSelectedFriendCardPrice(getLivePriceNumber(data?.price))
    } catch {
      setSelectedFriendCardPrice(null)
    }

    setSelectedFriendCardPriceLoading(false)
  }
  const loadFriendDeckValues = async (decks: FriendDeck[]) => {
    if (decks.length === 0) return

    const uniqueCards = new Map<string, DeckCard>()
    decks.forEach(deck => {
      if (deck.leader) uniqueCards.set(deck.leader.card_id, deck.leader)
      deck.cards.forEach(card => uniqueCards.set(card.card_id, card))
    })

    const prices = await fetchLivePricesForCards([...uniqueCards.values()])
    const values = Object.fromEntries(
      decks.map(deck => {
        const total = deck.cards.reduce((sum, card) => {
          const live = getLivePriceNumber(prices[card.card_id])
          const price = live ?? card.market_price ?? card.inventory_price ?? 0
          return sum + Number(price || 0) * Number(card.quantity || 0)
        }, 0)
        return [deck.id, total > 0 ? total : null]
      })
    )

    setSelectedDeckValues(values)
  }
  const friendTotalQuantity = selectedCards.reduce((sum, card) => sum + Number(card.quantity || 0), 0)
  const friendTotalValue = selectedCards.reduce((sum, card) => {
    const price = Number(card.market_price ?? card.inventory_price ?? 0)
    return sum + price * Number(card.quantity || 0)
  }, 0)
  const friendDuplicateCount = selectedCards.filter(card => Number(card.quantity || 0) > 1).length
  const friendTopCard = [...selectedCards].sort((a, b) =>
    Number(b.market_price ?? b.inventory_price ?? 0) - Number(a.market_price ?? a.inventory_price ?? 0)
  )[0]
  const formatPrice = (value: number) =>
    new Intl.NumberFormat('it-IT', { style: 'currency', currency: 'EUR' }).format(value)
  const formatOptionalPrice = (value?: number | null) =>
    value == null ? '---' : new Intl.NumberFormat('it-IT', { style: 'currency', currency: 'EUR' }).format(value)
  const displayCardId = (value?: string | null) =>
    (value || '')
      .replace(/_p\d+$/i, '')
      .replace(/^((?:OP|ST|EB|PRB|SP|EX|CP)\d{2}-\d{3}|P-\d{3}|DON-\d{3})p\d+$/i, '$1')
  const getFriendDeckValue = (deck: FriendDeck) => {
    const liveValue = selectedDeckValues[deck.id]
    if (liveValue != null) return liveValue
    const storedValue = deck.cards.reduce((sum, card) => {
      const price = Number(card.market_price ?? card.inventory_price ?? 0)
      return sum + price * Number(card.quantity || 0)
    }, 0)
    return storedValue > 0 ? storedValue : null
  }

  return (
    <div className="min-h-screen overflow-x-hidden pt-14 text-white onepiece-wave-bg onepiece-clouds">
      <Sidebar activePage="amici" />
      <Topbar />
      <div className="mx-3 mt-3 rounded-[1.5rem] border border-white/10 bg-slate-900/72 p-3 shadow-lg shadow-black/20 backdrop-blur-xl sm:mx-6 sm:p-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <h1 className="text-2xl font-black text-white">Amici</h1>
          <div className="grid grid-cols-3 gap-2">
            {[
              { label: 'Amici', value: friendProfiles.length, Icon: Users },
              { label: 'In arrivo', value: incomingRequests.length, Icon: Inbox },
              { label: 'Inviate', value: outgoingRequests.length, Icon: UserPlus },
            ].map(({ label, value, Icon }) => (
              <div key={label} className="min-w-[78px] rounded-2xl border border-white/10 bg-white/[0.055] px-3 py-2">
                <div className="flex items-center gap-1.5 text-cyan-200">
                  <Icon size={13} />
                  <span className="text-[9px] font-black uppercase tracking-[0.16em]">{label}</span>
                </div>
                <p className="mt-1 text-lg font-black text-white">{value}</p>
              </div>
            ))}
          </div>
        </div>
      </div>

      <main className="mx-auto max-w-6xl px-3 pb-32 pt-4 sm:px-6 sm:pb-36 sm:pt-8 lg:px-8">
        <div className="overflow-hidden rounded-[1.75rem] border border-white/10 bg-slate-900/72 p-3 shadow-2xl shadow-slate-950/30 backdrop-blur-xl sm:rounded-[2rem] sm:p-5">
          <div className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
            <section className="space-y-5">
              <div className="rounded-2xl border border-slate-800/80 bg-slate-950/90 p-4 sm:rounded-[1.75rem] sm:p-5">
                <div className="relative min-w-0">
                    <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
                    <input
                      value={searchTerm}
                      onChange={(event) => setSearchTerm(event.target.value)}
                      placeholder="Cerca per username"
                      className="w-full rounded-2xl border border-slate-700 bg-slate-900/90 px-10 py-3 text-sm text-white placeholder:text-slate-500 focus:border-amber-400 focus:outline-none focus:ring-2 focus:ring-amber-400/20"
                    />
                </div>
              </div>

              <div className="grid gap-4 lg:grid-cols-2">
                <div className="min-w-0 rounded-2xl border border-slate-800/80 bg-slate-950/90 p-4 sm:rounded-[1.75rem] sm:p-5">
                  <div className="flex items-center justify-between">
                    <h3 className="text-lg font-semibold text-white">Amici</h3>
                    <div className="inline-flex items-center gap-2 rounded-full bg-amber-400/10 px-3 py-1 text-xs uppercase tracking-[0.2em] text-amber-200">
                      <Users size={14} />
                      {friendProfiles.length}
                    </div>
                  </div>

                  {loading ? (
                    <p className="mt-5 text-sm text-slate-400">Caricamento amici...</p>
                  ) : friendProfiles.length === 0 ? (
                    <div className="mt-5 rounded-3xl border border-dashed border-slate-700/70 bg-slate-900/80 p-5 text-sm text-slate-400">
                      Nessun amico ancora. Cerca un giocatore e manda una richiesta!
                    </div>
                  ) : (
                    <div className="mt-5 grid gap-3">
                      {friendProfiles.map((friend) => {
                        const tier = getPremiumTier(friend, { id: friend.id })
                        const label = premiumLabel(tier)

                        return (
                          <button
                            key={friend.id}
                            onClick={() => openProfile(friend)}
                            className="group flex items-center gap-4 rounded-3xl border border-slate-800/70 bg-slate-900/80 p-4 text-left transition hover:border-amber-400/50"
                          >
                            <div className="flex h-14 w-14 items-center justify-center rounded-full bg-slate-800 text-2xl text-amber-300 overflow-hidden">
                              {friend.avatar_url ? (
                                <img src={friend.avatar_url} alt={friend.username || 'Avatar'} className="h-full w-full object-cover" />
                              ) : (
                                <span>{(friend.username || 'U').charAt(0).toUpperCase()}</span>
                              )}
                            </div>
                            <div className="truncate">
                              <div className="flex items-center gap-2">
                                <p className={`font-semibold text-white truncate ${premiumClassName(tier)}`}>{friend.username || 'Giocatore'}</p>
                                {label ? <span className="rounded-full border border-white/15 bg-white/[0.08] px-2 py-0.5 text-[9px] font-black uppercase text-cyan-100">{label}</span> : null}
                              </div>
                              <p className={`text-xs font-semibold ${isProfileOnline(friend) ? 'text-emerald-300' : 'text-slate-500'}`}>
                                <span className={`mr-1 inline-block h-1.5 w-1.5 rounded-full ${isProfileOnline(friend) ? 'bg-emerald-300 shadow-[0_0_10px_rgba(110,231,183,0.75)]' : 'bg-slate-600'}`} />
                                {isProfileOnline(friend) ? 'Ora online' : 'Tuo Amico'}
                              </p>
                            </div>
                          </button>
                        )
                      })}
                    </div>
                  )}
                </div>

                <div className="min-w-0 rounded-2xl border border-slate-800/80 bg-slate-950/90 p-4 sm:rounded-[1.75rem] sm:p-5">
                  <div className="flex items-center justify-between">
                    <h3 className="text-lg font-semibold text-white">Richieste</h3>
                    <div className="inline-flex items-center gap-2 rounded-full bg-emerald-500/10 px-3 py-1 text-xs uppercase tracking-[0.2em] text-emerald-200">
                      {incomingRequests.length} in arrivo
                    </div>
                  </div>

                  {incomingRequests.length === 0 ? (
                    <div className="mt-5 rounded-3xl border border-dashed border-slate-700/70 bg-slate-900/80 p-5 text-sm text-slate-400">
                      Nessuna richiesta in attesa. Continua a esplorare e connetterti.
                    </div>
                  ) : (
                    <div className="mt-5 space-y-3">
                      {incomingRequests.map((request) => {
                        const sender = allProfiles.find((profile) => profile.id === request.requester_id)
                        const tier = getPremiumTier(sender, { id: sender?.id })
                        const label = premiumLabel(tier)
                        return (
                          <div key={request.id} className="rounded-3xl border border-slate-800/70 bg-slate-900/80 p-4">
                            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
                              <div className="flex min-w-0 items-center gap-3">
                                <div className="flex h-11 w-11 items-center justify-center rounded-full bg-slate-800 text-amber-300 overflow-hidden">
                                  {sender?.avatar_url ? (
                                    <img src={sender.avatar_url} alt={sender.username || 'Avatar'} className="h-full w-full object-cover" />
                                  ) : (
                                    <span>{(sender?.username || 'U').charAt(0).toUpperCase()}</span>
                                  )}
                                </div>
                                <div className="min-w-0">
                                  <div className="flex items-center gap-2">
                                    <p className={`truncate font-semibold text-white ${premiumClassName(tier)}`}>{sender?.username || 'Giocatore'}</p>
                                    {label ? <span className="rounded-full border border-white/15 bg-white/[0.08] px-2 py-0.5 text-[9px] font-black uppercase text-cyan-100">{label}</span> : null}
                                  </div>
                                  <p className={`text-xs font-semibold ${isProfileOnline(sender) ? 'text-emerald-300' : 'text-slate-500'}`}>
                                    <span className={`mr-1 inline-block h-1.5 w-1.5 rounded-full ${isProfileOnline(sender) ? 'bg-emerald-300 shadow-[0_0_10px_rgba(110,231,183,0.75)]' : 'bg-slate-600'}`} />
                                    {isProfileOnline(sender) ? 'Ora online' : 'Ti ha inviato una richiesta di amicizia.'}
                                  </p>
                                </div>
                              </div>
                              <div className="flex shrink-0 gap-2">
                                <button
                                  onClick={() => updateRequest(request.id, 'accepted')}
                                  disabled={busy}
                                  className="rounded-2xl bg-emerald-500/15 px-3 py-2 text-xs font-semibold text-emerald-200 transition hover:bg-emerald-500/25 disabled:opacity-60"
                                >
                                  <Check size={14} /> Accetta
                                </button>
                                <button
                                  onClick={() => updateRequest(request.id, 'rejected')}
                                  disabled={busy}
                                  className="rounded-2xl bg-red-500/15 px-3 py-2 text-xs font-semibold text-red-300 transition hover:bg-red-500/25 disabled:opacity-60"
                                >
                                  <X size={14} /> Rifiuta
                                </button>
                              </div>
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  )}
                </div>
              </div>
            </section>

            <aside className="min-w-0 space-y-5 rounded-2xl border border-slate-800/80 bg-slate-950/90 p-4 sm:rounded-[1.75rem] sm:p-5">
              <h3 className="text-lg font-semibold text-white">Giocatori</h3>

              <div className="space-y-4">
                {peopleToShow.slice(0, 6).map((profile) => {
                  const status = resolvedRequests.get(profile.id)
                  const tier = getPremiumTier(profile, { id: profile.id })
                  const label = premiumLabel(tier)
                  return (
                    <div key={profile.id} className="flex min-w-0 items-center justify-between gap-2 rounded-2xl border border-slate-800/70 bg-slate-900/90 p-3 sm:gap-3 sm:rounded-3xl sm:p-4">
                      <button
                        onClick={() => openProfile(profile)}
                        className="flex min-w-0 flex-1 items-center gap-3 text-left"
                      >
                        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-slate-800 text-amber-300 overflow-hidden">
                          {profile.avatar_url ? (
                            <img src={profile.avatar_url} alt={profile.username || 'Avatar'} className="h-full w-full object-cover" />
                          ) : (
                            <span>{(profile.username || 'U').charAt(0).toUpperCase()}</span>
                          )}
                        </div>
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <p className={`font-semibold text-white truncate ${premiumClassName(tier)}`}>{profile.username || 'Giocatore'}</p>
                            {label ? <span className="rounded-full border border-white/15 bg-white/[0.08] px-2 py-0.5 text-[9px] font-black uppercase text-cyan-100">{label}</span> : null}
                          </div>
                          <p className={`text-[11px] font-semibold truncate ${isProfileOnline(profile) ? 'text-emerald-300' : 'text-slate-500'}`}>
                            <span className={`mr-1 inline-block h-1.5 w-1.5 rounded-full ${isProfileOnline(profile) ? 'bg-emerald-300 shadow-[0_0_10px_rgba(110,231,183,0.75)]' : 'bg-slate-600'}`} />
                            {isProfileOnline(profile)
                              ? 'Ora online'
                              : status === 'friend'
                              ? 'Già tuo amico'
                              : status === 'sent'
                              ? 'Richiesta inviata'
                              : status === 'incoming'
                              ? 'Richiesta in arrivo'
                              : 'Disponibile per un saluto'}
                          </p>
                        </div>
                      </button>
                      <button
                        onClick={() => sendFriendRequest(profile.id)}
                        disabled={busy || status === 'friend' || status === 'sent' || status === 'incoming'}
                        className="shrink-0 rounded-2xl bg-amber-400 px-3 py-2 text-xs font-semibold text-slate-950 transition hover:bg-amber-300 disabled:cursor-not-allowed disabled:opacity-60 sm:px-4"
                      >
                        {status === 'friend'
                          ? 'Amico'
                          : status === 'sent'
                          ? 'In attesa'
                          : status === 'incoming'
                          ? 'Vedi richiesta'
                          : 'Aggiungi'}
                      </button>
                    </div>
                  )
                })}

                {peopleToShow.length === 0 && (
                  <div className="rounded-3xl border border-dashed border-slate-700/70 bg-slate-900/80 p-4 text-sm text-slate-400">
                    Nessun giocatore trovato. Prova un altro nome.
                  </div>
                )}
              </div>

              {actionMessage ? (
                <div className="rounded-3xl border border-slate-800/70 bg-emerald-500/10 p-4 text-sm text-emerald-200">
                  {actionMessage}
                </div>
              ) : null}
            </aside>
          </div>
        </div>
      </main>

      {selectedProfile ? (
        (() => {
          const selectedTier = getPremiumTier(selectedProfile, { id: selectedProfile.id })
          const selectedLabel = premiumLabel(selectedTier)

          return (
        <div
          className="fixed inset-0 z-50 overflow-y-auto bg-black/70 p-2 backdrop-blur-sm sm:p-4"
          onClick={(event) => {
            if (event.target === event.currentTarget) {
              closeModal()
            }
          }}
        >
          <div
            className="mx-auto w-full max-w-5xl overflow-hidden rounded-2xl border border-slate-800/80 bg-slate-950/95 shadow-2xl shadow-black/60 sm:my-4 sm:rounded-[2rem]"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="sticky top-0 z-20 flex items-center justify-between border-b border-slate-800/70 bg-slate-900/95 p-5 backdrop-blur-xl">
              <div className="flex items-center gap-2">
                  <h3 className={`text-2xl font-semibold text-white ${premiumClassName(selectedTier)}`}>{selectedProfile.username || 'Giocatore'}</h3>
                  {selectedLabel ? <span className="rounded-full border border-white/15 bg-white/[0.08] px-2 py-1 text-[10px] font-black uppercase text-cyan-100">{selectedLabel}</span> : null}
              </div>
              <button
                onClick={closeModal}
                className="rounded-2xl border border-slate-700/70 px-3 py-2 text-sm text-slate-300 transition hover:bg-slate-900"
              >
                Chiudi
              </button>
            </div>

            <div className="grid gap-4 p-3 sm:p-5 lg:grid-cols-[280px_1fr]">
              <div className="h-fit space-y-5 rounded-2xl border border-slate-800/80 bg-slate-900/90 p-4 sm:rounded-[1.75rem]">
                <div className="flex flex-col items-center gap-4 text-center">
                  <div className="flex h-24 w-24 sm:h-28 sm:w-28 items-center justify-center overflow-hidden rounded-full bg-slate-800 text-4xl text-amber-300">
                    {selectedProfile.avatar_url ? (
                      <img src={selectedProfile.avatar_url} alt={selectedProfile.username || 'Avatar'} className="h-full w-full object-contain" />
                    ) : (
                      <span>{(selectedProfile.username || 'U').charAt(0).toUpperCase()}</span>
                    )}
                  </div>
                  <p className={`text-sm uppercase tracking-[0.25em] ${isProfileOnline(selectedProfile) ? 'text-emerald-300' : 'text-slate-500'}`}>
                    <span className={`mr-2 inline-block h-2 w-2 rounded-full ${isProfileOnline(selectedProfile) ? 'bg-emerald-300 shadow-[0_0_12px_rgba(110,231,183,0.8)]' : 'bg-slate-600'}`} />
                    {isProfileOnline(selectedProfile) ? 'Ora online' : isFriend ? 'Amico' : 'Profilo pubblico'}
                  </p>
                  <div className="inline-flex items-center gap-2 rounded-full bg-slate-800/80 px-3 py-2 text-xs uppercase tracking-[0.2em] text-slate-300">
                    <Heart size={14} />
                    {isFriend ? 'Visualizza le carte del tuo amico' : selectedRequest?.status === 'incoming' ? 'Richiesta in arrivo' : 'Invia amicizia per vedere le carte'}
                  </div>
                </div>

                {isFriend ? (
                  <div className="rounded-3xl border border-amber-200/20 bg-gradient-to-br from-amber-200/12 to-cyan-200/10 p-4">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <p className="text-[10px] font-black uppercase tracking-[0.22em] text-amber-200">Livello</p>
                        <p className="mt-1 text-3xl font-black text-white">LV {selectedProgress.level}</p>
                      </div>
                      <div className="text-right text-xs font-bold text-cyan-100">
                        {selectedProgress.unlockedCount}/{selectedProgress.totalBadges}
                        <span className="block text-slate-400">badge</span>
                      </div>
                    </div>
                    <div className="mt-3 h-2 overflow-hidden rounded-full bg-slate-950/60">
                      <div
                        className="h-full rounded-full bg-gradient-to-r from-amber-200 to-cyan-200"
                        style={{ width: `${selectedProgress.progressPercent}%` }}
                      />
                    </div>
                    <div className="mt-3 grid grid-cols-2 gap-2">
                      <button
                        type="button"
                        disabled
                        className="rounded-2xl border border-emerald-300/25 bg-emerald-300/10 px-3 py-2 text-xs font-black uppercase tracking-[0.12em] text-emerald-100"
                      >
                        Amico
                      </button>
                      <button
                        type="button"
                        onClick={() => router.push(`/chat?user=${selectedProfile.id}`)}
                        className="inline-flex items-center justify-center gap-1.5 rounded-2xl bg-cyan-300 px-3 py-2 text-xs font-black uppercase tracking-[0.12em] text-slate-950 transition hover:bg-cyan-200 active:scale-95"
                      >
                        <MessageCircle size={14} />
                        Messaggio
                      </button>
                    </div>
                  </div>
                ) : null}

                {!isFriend && selectedRequest?.status === 'incoming' ? (
                  <div className="rounded-3xl border border-slate-800/70 bg-slate-900/80 p-4">
                    <p className="text-sm text-slate-200">Questa persona ti ha inviato una richiesta.</p>
                    <div className="mt-4 flex gap-3">
                      <button
                        onClick={() => updateRequest(selectedRequest.id, 'accepted')}
                        disabled={busy}
                        className="rounded-2xl bg-emerald-500/15 px-4 py-2 text-sm font-semibold text-emerald-200 hover:bg-emerald-500/25 disabled:opacity-60"
                      >
                        Accetta
                      </button>
                      <button
                        onClick={() => updateRequest(selectedRequest.id, 'rejected')}
                        disabled={busy}
                        className="rounded-2xl bg-red-500/15 px-4 py-2 text-sm font-semibold text-red-300 hover:bg-red-500/25 disabled:opacity-60"
                      >
                        Rifiuta
                      </button>
                    </div>
                  </div>
                ) : null}

                {!isFriend && (!selectedRequest || selectedRequest.status !== 'incoming') ? (
                  <div className="grid gap-2">
                    <button
                      onClick={() => selectedProfile?.id && sendFriendRequest(selectedProfile.id)}
                      disabled={busy || resolvedRequests.get(selectedProfile.id) === 'sent' || resolvedRequests.get(selectedProfile.id) === 'friend'}
                      className="w-full rounded-3xl bg-amber-400 px-4 py-3 text-sm font-semibold text-slate-950 transition hover:bg-amber-300 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {resolvedRequests.get(selectedProfile.id) === 'sent'
                        ? 'Richiesta inviata'
                        : 'Invia richiesta d\'amicizia'}
                    </button>
                    <button
                      type="button"
                      disabled
                      className="inline-flex w-full items-center justify-center gap-2 rounded-3xl border border-slate-700 bg-slate-900/80 px-4 py-3 text-sm font-semibold text-slate-500"
                    >
                      <MessageCircle size={16} />
                      Messaggio
                    </button>
                  </div>
                ) : null}
              </div>

              <div className="min-h-[360px] rounded-2xl border border-slate-800/80 bg-slate-950/90 p-4 sm:rounded-[1.75rem] sm:p-5">
                {isFriend && selectedBinders.length > 0 ? (
                  <div className="mb-5 border-b border-white/8 pb-5">
                    <div className="flex items-center justify-between gap-3">
                      <h4 className="text-lg font-semibold text-white">Raccoglitori</h4>
                      <span className="rounded-full bg-amber-300/10 px-2.5 py-1 text-[10px] font-black text-amber-100">{selectedBinders.length}</span>
                    </div>
                    <div className="mt-3 grid grid-cols-3 gap-3 sm:grid-cols-5">
                      {selectedBinders.map(binder => (
                        <button key={binder.id} type="button" onClick={() => router.push(`/binders/${binder.id}`)} className="min-w-0 text-left transition hover:-translate-y-1 active:scale-95">
                          <BinderCover binder={binder} compact />
                        </button>
                      ))}
                    </div>
                  </div>
                ) : null}
                <div className="flex items-center justify-between gap-3">
                  <h4 className="text-lg font-semibold text-white">Collezione</h4>
                  {isFriend ? (
                    <span className="rounded-full bg-emerald-500/10 px-3 py-1 text-xs uppercase tracking-[0.2em] text-emerald-200">Visibile</span>
                  ) : (
                    <span className="rounded-full bg-amber-400/10 px-3 py-1 text-xs uppercase tracking-[0.2em] text-amber-200">Solo amici</span>
                  )}
                </div>

                {isFriend ? (
                  selectedCards.length === 0 ? (
                    <div className="mt-5 rounded-3xl border border-dashed border-slate-700/70 bg-slate-900/80 p-4 text-sm text-slate-400">
                      Nessuna carta trovata per questo utente.
                    </div>
                  ) : (
                    <>
                      <div className="mt-5 grid grid-cols-2 gap-2 lg:grid-cols-4">
                        {[
                          ['Carte', friendTotalQuantity.toString()],
                          ['Uniche', selectedCards.length.toString()],
                          ['Doppioni', friendDuplicateCount.toString()],
                          ['Valore', formatPrice(friendTotalValue)],
                        ].map(([label, value]) => (
                          <div key={label} className="rounded-2xl border border-white/10 bg-white/[0.055] p-3">
                            <p className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-400">{label}</p>
                            <p className="mt-1 truncate text-lg font-black text-white">{value}</p>
                          </div>
                        ))}
                      </div>

                      <div className="mt-5 rounded-3xl border border-cyan-300/15 bg-cyan-300/[0.08] p-3">
                        <div className="mb-3 flex items-center justify-between gap-3">
                          <div className="flex items-center gap-2">
                            <LibraryBig size={16} className="text-cyan-100" />
                            <p className="text-sm font-black text-white">Deck</p>
                          </div>
                          <span className="rounded-full bg-white/[0.08] px-2 py-1 text-[10px] font-black text-slate-200">{selectedDecks.length}</span>
                        </div>

                        {selectedDecks.length === 0 ? (
                          <p className="rounded-2xl border border-dashed border-slate-700 bg-slate-950/45 p-3 text-sm text-slate-400">
                            Nessun deck salvato visibile.
                          </p>
                        ) : (
                          <div className="grid gap-2 sm:grid-cols-2">
                            {selectedDecks.map(deck => (
                              <button
                                key={deck.id}
                                onClick={() => setSelectedFriendDeck(deck)}
                                className="flex gap-3 rounded-2xl border border-slate-700 bg-slate-950/65 p-2 text-left transition hover:border-cyan-300/45"
                              >
                                {deck.leader ? (
                                  <CardImage src={deck.leader.image_url} cardId={deck.leader.card_id} alt={deck.leader.name || 'Leader'} className="h-24 w-16 shrink-0 overflow-hidden rounded-xl bg-slate-900" />
                                ) : (
                                  <div className="grid h-24 w-16 shrink-0 place-items-center rounded-xl border border-dashed border-slate-700 text-[9px] text-slate-500">Lead</div>
                                )}
                                <div className="min-w-0 flex-1">
                                  <p className="truncate text-sm font-black text-white">{deck.name}</p>
                                  <p className="mt-1 truncate text-[10px] text-slate-400">{deck.leader?.name || 'No leader'}</p>
                                  <div className="mt-2 flex flex-wrap gap-1.5">
                                    <span className="rounded-full bg-cyan-300/12 px-2 py-1 text-[10px] font-black text-cyan-100">{deck.cards.reduce((sum, card) => sum + Number(card.quantity || 0), 0)}/50</span>
                                    <span className="rounded-full bg-emerald-300/12 px-2 py-1 text-[10px] font-black text-emerald-100">{formatOptionalPrice(getFriendDeckValue(deck))}</span>
                                  </div>
                                </div>
                              </button>
                            ))}
                          </div>
                        )}
                      </div>

                      {friendTopCard ? (
                        <div className="mt-3 flex items-center gap-3 rounded-2xl border border-cyan-300/20 bg-cyan-300/10 p-3">
                          <button onClick={() => openFriendCard(friendTopCard)} className="shrink-0">
                            <CardImage src={friendTopCard.image_url} cardId={friendTopCard.card_id} alt={friendTopCard.name || friendTopCard.card_id} className="h-20 w-14 overflow-hidden rounded-xl bg-slate-950" />
                          </button>
                          <div className="min-w-0">
                            <p className="text-[10px] font-black uppercase tracking-[0.22em] text-cyan-100">Carta più alta</p>
                            <p className="mt-1 truncate text-sm font-black text-white">{friendTopCard.name || friendTopCard.card_id}</p>
                            <p className="text-xs font-black text-cyan-100">{formatPrice(Number(friendTopCard.market_price ?? friendTopCard.inventory_price ?? 0))}</p>
                          </div>
                        </div>
                      ) : null}

                      <div className="mt-5 grid grid-cols-3 gap-2 sm:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
                        {selectedCards.map((card) => (
                          <div key={card.card_id} className="rounded-2xl border border-slate-800/70 bg-slate-900/80 p-1.5">
                            <button onClick={() => openFriendCard(card)} className="block w-full text-left">
                              <CardImage
                                src={card.image_url}
                                cardId={card.card_id}
                                alt={card.name || card.card_id}
                                className="aspect-[3/4] overflow-hidden rounded-xl bg-slate-800"
                              />
                            </button>
                            <p className="mt-1.5 text-xs font-semibold text-white line-clamp-1">{card.name || card.card_id}</p>
                            <p className="text-[10px] text-slate-500">{getRarityLabel(card) || '—'}</p>
                            <p className="text-[10px] text-amber-300">x{card.quantity}</p>
                          </div>
                        ))}
                      </div>
                    </>
                  )
                ) : (
                  <div className="mt-5 rounded-3xl border border-dashed border-slate-700/70 bg-slate-900/80 p-5 text-sm text-slate-400">
                    Solo gli amici possono vedere le carte complete del profilo.
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
          )
        })()
      ) : null}

      {selectedFriendDeck ? (
        <div className="fixed inset-0 z-[70] flex items-end justify-center bg-black/72 p-2 backdrop-blur-md sm:items-center sm:p-4" onClick={() => setSelectedFriendDeck(null)}>
          <div className="w-full max-w-5xl overflow-hidden rounded-[1.75rem] border border-slate-700 bg-slate-950/97 shadow-2xl" onClick={event => event.stopPropagation()}>
            <div className="flex items-center justify-between border-b border-slate-800 p-3">
              <h3 className="min-w-0 truncate text-lg font-black text-white">{selectedFriendDeck.name}</h3>
              <button onClick={() => setSelectedFriendDeck(null)} className="grid h-10 w-10 place-items-center rounded-2xl border border-slate-700 bg-slate-800 text-slate-100" aria-label="Chiudi deck">
                <X size={18} />
              </button>
            </div>
            <div className="grid max-h-[82dvh] gap-4 overflow-y-auto p-3 lg:grid-cols-[230px_1fr]">
              <aside className="rounded-3xl border border-cyan-300/20 bg-cyan-300/10 p-3">
                <div className="flex items-center gap-2 text-[10px] font-black uppercase tracking-[0.22em] text-cyan-100">
                  <Crown size={14} />Leader
                </div>
                {selectedFriendDeck.leader ? (
                  <>
                    <button onClick={() => selectedFriendDeck.leader && openFriendCard(selectedFriendDeck.leader)} className="mt-3 block w-full text-left">
                      <CardImage src={selectedFriendDeck.leader.image_url} cardId={selectedFriendDeck.leader.card_id} alt={selectedFriendDeck.leader.name || 'Leader'} className="aspect-[3/4] overflow-hidden rounded-2xl bg-slate-950" />
                    </button>
                    <p className="mt-2 text-sm font-black text-white">{selectedFriendDeck.leader.name}</p>
                    <p className="text-[10px] text-slate-400">{displayCardId(selectedFriendDeck.leader.card_id)}</p>
                  </>
                ) : (
                  <p className="mt-3 text-sm text-slate-400">Nessun leader salvato.</p>
                )}
                <div className="mt-3 rounded-2xl border border-emerald-300/20 bg-emerald-300/10 p-2">
                  <p className="text-[10px] font-black uppercase tracking-[0.18em] text-emerald-100/70">Valore stimato</p>
                  <p className="mt-1 text-lg font-black text-emerald-100">{formatOptionalPrice(getFriendDeckValue(selectedFriendDeck))}</p>
                </div>
              </aside>
              <section>
                <div className="mb-3 flex items-center justify-between">
                  <p className="text-sm font-black text-white">{selectedFriendDeck.cards.reduce((sum, card) => sum + Number(card.quantity || 0), 0)}/50 carte</p>
                  <p className="text-xs text-slate-400">{selectedFriendDeck.updated_at ? new Date(selectedFriendDeck.updated_at).toLocaleDateString('it-IT') : ''}</p>
                </div>
                <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6">
                  {selectedFriendDeck.cards.map(card => (
                    <div key={card.card_id} className="rounded-2xl border border-slate-700 bg-slate-900/80 p-1.5">
                      <div className="relative">
                        <button onClick={() => openFriendCard(card)} className="block w-full text-left">
                          <CardImage src={card.image_url} cardId={card.card_id} alt={card.name || card.card_id} className="aspect-[3/4] overflow-hidden rounded-xl bg-slate-950" />
                        </button>
                        <span className="absolute right-1 top-1 rounded-full bg-cyan-300 px-2 py-1 text-[10px] font-black text-slate-950">x{card.quantity}</span>
                      </div>
                      <p className="mt-1 truncate text-xs font-black text-white">{card.name}</p>
                      <p className="text-[10px] text-slate-500">{displayCardId(card.card_id)}</p>
                    </div>
                  ))}
                </div>
              </section>
            </div>
          </div>
        </div>
      ) : null}

      {selectedFriendCard ? (
        <div
          className="fixed inset-0 z-[80] flex items-end justify-center bg-black/74 p-2 backdrop-blur-md sm:items-center sm:p-4"
          onClick={() => {
            setSelectedFriendCard(null)
            setSelectedFriendCardPrice(null)
          }}
        >
          <div className="w-full max-w-3xl overflow-hidden rounded-[1.75rem] border border-slate-700 bg-slate-950/97 shadow-2xl lg:max-w-5xl" onClick={event => event.stopPropagation()}>
            <div className="flex items-center justify-between border-b border-slate-800 p-3">
              <h3 className="min-w-0 truncate text-lg font-black text-white">{selectedFriendCard.name || selectedFriendCard.card_id}</h3>
              <button
                onClick={() => {
                  setSelectedFriendCard(null)
                  setSelectedFriendCardPrice(null)
                }}
                className="grid h-10 w-10 place-items-center rounded-2xl border border-slate-700 bg-slate-800 text-slate-100"
                aria-label="Chiudi carta"
              >
                <X size={18} />
              </button>
            </div>
            <div className="grid max-h-[82dvh] grid-cols-1 gap-4 overflow-y-auto p-3 lg:grid-cols-[minmax(260px,360px)_minmax(0,1fr)] lg:items-start lg:gap-6 lg:p-5 xl:grid-cols-[minmax(320px,420px)_minmax(0,1fr)]">
              <div className="mx-auto w-full max-w-[280px] overflow-hidden rounded-3xl bg-slate-950 sm:max-w-[320px] lg:max-w-none">
                <CardImage
                  src={selectedFriendCard.image_url}
                  cardId={selectedFriendCard.card_id}
                  alt={selectedFriendCard.name || selectedFriendCard.card_id}
                  className="aspect-[3/4] w-full"
                  imgClassName="h-full w-full object-contain"
                />
              </div>
              <div className="min-w-0 space-y-3">
                <div>
                  <p className="break-words text-2xl font-black leading-tight text-white">{selectedFriendCard.name || 'Carta'}</p>
                  <p className="mt-1 text-sm font-bold text-cyan-100">{displayCardId(selectedFriendCard.card_id)}</p>
                </div>
                <div className="grid grid-cols-2 gap-2 lg:gap-3">
                  {[
                    ['Rarita', getRarityLabel(selectedFriendCard) || '-'],
                    ['Prezzo Medio', selectedFriendCardPriceLoading ? '...' : formatOptionalPrice(selectedFriendCardPrice ?? selectedFriendCard.market_price ?? selectedFriendCard.inventory_price)],
                    ['Copie', selectedFriendCard.quantity || 1],
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
