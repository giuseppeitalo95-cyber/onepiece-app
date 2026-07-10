'use client'

import { useEffect, useState } from 'react'
import { BarChart3, Crown, Plus, Search, SlidersHorizontal, Trash2, TrendingUp, X } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import Sidebar from '@/app/components/Sidebar'
import Topbar from '@/app/components/Topbar'
import CardImage from '@/app/components/CardImage'
import { useRouter } from 'next/navigation'
import { evaluateProgress } from '@/lib/progression'

type UserCard = {
  card_id: string
  quantity: number
  name: string | null
  image_url: string | null
  rarity: string | null

  // 🔥 AGGIUNTE
  card_color?: string | null
  card_type?: string | null
  card_cost?: number | null
  card_power?: number | null
  market_price?: number | null
  inventory_price?: number | null
}

type CatalogCard = {
  id: string
  name: string
  image_url: string | null
  rarity: string | null
  card_color?: string | null
  card_type?: string | null
  card_cost?: number | null
  card_power?: number | null
  market_price?: number | null
  inventory_price?: number | null
  set_name?: string | null
  card_text?: string | null
  sub_types?: string | null
}

type LivePriceResult = {
  marketPrice?: number | null
  midPrice?: number | null
  lowPrice?: number | null
  currency?: string | null
  originalCurrency?: string | null
  source?: string | null
}

export default function Dashboard() {
  const [addOpen, setAddOpen] = useState(false)
  const [selectedCard, setSelectedCard] = useState<UserCard | null>(null)
  const [openMenuId, setOpenMenuId] = useState<string | null>(null)
  const router = useRouter()

  const [userId, setUserId] = useState<string | null>(null)
  const [cards, setCards] = useState<UserCard[]>([])
  const [loadingCards, setLoadingCards] = useState(true)
  const [searchTerm, setSearchTerm] = useState('')
  const [filterColor, setFilterColor] = useState('all')
  const [filterRarity, setFilterRarity] = useState('all')
  const [filterCost, setFilterCost] = useState('all')
  const [filtersOpen, setFiltersOpen] = useState(false)
  const [catalogOpen, setCatalogOpen] = useState(false)
  const [catalogQuery, setCatalogQuery] = useState('')
  const [catalogCards, setCatalogCards] = useState<CatalogCard[]>([])
  const [catalogLoading, setCatalogLoading] = useState(false)
  const [catalogSelectedCard, setCatalogSelectedCard] = useState<CatalogCard | null>(null)
  const [catalogAddingId, setCatalogAddingId] = useState<string | null>(null)
  const [catalogMessage, setCatalogMessage] = useState('')
  const [livePrice, setLivePrice] = useState<number | null>(null)
  const [livePriceLoading, setLivePriceLoading] = useState(false)
  const [analyticsOpen, setAnalyticsOpen] = useState(false)
  const [analyticsLoading, setAnalyticsLoading] = useState(false)
  const [analyticsLivePrices, setAnalyticsLivePrices] = useState<Record<string, number | null>>({})

 useEffect(() => {
  if (addOpen || selectedCard || catalogOpen || analyticsOpen) {
    document.body.style.overflow = 'hidden'
    document.documentElement.style.overflow = 'hidden'
  } else {
    document.body.style.overflow = 'auto'
    document.documentElement.style.overflow = 'auto'
  }
}, [addOpen, selectedCard, catalogOpen, analyticsOpen])

  useEffect(() => {
    const load = async () => {
      const { data: { session } } = await supabase.auth.getSession()

      if (!session?.user) {
        router.push('/')
        return
      }

      const id = session.user.id
      setUserId(id)

    }

    load()
  }, [])

  const loadCards = async (uid: string) => {
    setLoadingCards(true)

    const { data, error } = await supabase
      .from('user_cards')
      .select(
        'card_id, quantity, name, image_url, rarity, card_color, card_type, card_cost, card_power, market_price, inventory_price'
      )
      .eq('user_id', uid)

    if (error) {
      console.error('LOAD ERROR:', error)
      setCards([])
      setLoadingCards(false)
      return
    }

    const loadedCards = (data || []).map(card => ({
      ...card,
      market_price: card.market_price ? Number(card.market_price) : null,
      inventory_price: card.inventory_price ? Number(card.inventory_price) : null
    }))
    setCards(loadedCards)
    evaluateProgress(uid, loadedCards, { claimDaily: true })
    setLoadingCards(false)
    void syncLivePricesForCards(uid, loadedCards)
  }

  useEffect(() => {
    if (!userId) return
    loadCards(userId)
  }, [userId])

  useEffect(() => {
    if (!catalogOpen) return

    const search = async () => {
      const q = catalogQuery.trim()

      if (q.length < 2) {
        setCatalogCards([])
        setCatalogLoading(false)
        return
      }

      setCatalogLoading(true)
      try {
        const res = await fetch(`/api/cards/search?q=${encodeURIComponent(q)}`)
        const data = await res.json()
        const seen = new Set<string>()
        const clean: CatalogCard[] = (Array.isArray(data) ? data : [])
          .map((card: any) => ({
            id: String(card.card_set_id ?? card.card_id ?? card.id),
            name: card.card_name || card.name || 'Carta',
            image_url: card.card_image || card.image_url || null,
            rarity: card.rarity || '-',
            card_color: card.card_color ?? null,
            card_type: card.card_type ?? null,
            card_cost: card.card_cost ? Number(card.card_cost) : null,
            card_power: card.card_power ? Number(card.card_power) : null,
            market_price: card.market_price ? Number(card.market_price) : null,
            inventory_price: card.inventory_price ? Number(card.inventory_price) : null,
            set_name: card.set_name ?? null,
            card_text: card.card_text ?? null,
            sub_types: card.sub_types ?? null,
          }))
          .filter((card: CatalogCard) => {
            if (seen.has(card.id)) return false
            seen.add(card.id)
            return true
          })
          .slice(0, 40)

        setCatalogCards(clean)
      } catch {
        setCatalogCards([])
      }
      setCatalogLoading(false)
    }

    const timeout = setTimeout(search, 250)
    return () => clearTimeout(timeout)
  }, [catalogOpen, catalogQuery])

  const refreshAfterAdd = async () => {
    setAddOpen(false)
    if (userId) await loadCards(userId)
  }

  const formatPrice = (value?: number | null) =>
    value == null
      ? '—'
      : new Intl.NumberFormat('it-IT', { style: 'currency', currency: 'USD' }).format(value)
  const displayCardId = (value?: string | null) =>
    (value || '')
      .replace(/_p\d+$/i, '')
      .replace(/^((?:OP|ST|EB|PRB|SP|EX|CP)\d{2}-\d{3}|P-\d{3}|DON-\d{3})p\d+$/i, '$1')
  const getLivePriceNumber = (price?: LivePriceResult | null) => {
    if (!price) return null
    return price.marketPrice ?? price.midPrice ?? price.lowPrice ?? null
  }

  const fetchLivePricesForCards = async (cardsToPrice: Array<{ card_id: string; name?: string | null; set_name?: string | null }>) => {
    const allPrices: Record<string, LivePriceResult | null> = {}

    try {
      for (let index = 0; index < cardsToPrice.length; index += 120) {
        const chunk = cardsToPrice.slice(index, index + 120)
        const res = await fetch('/api/cards/prices', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            cards: chunk.map(card => ({
              cardId: card.card_id,
              name: card.name,
              setName: card.set_name
            }))
          })
        })
        const data = await res.json()
        Object.assign(allPrices, (data?.prices || {}) as Record<string, LivePriceResult | null>)
      }
    } catch {
    }

    return allPrices
  }

  const syncLivePricesForCards = async (uid: string, cardsToSync: UserCard[]) => {
    if (cardsToSync.length === 0) return

    const prices = await fetchLivePricesForCards(cardsToSync)
    const liveMap = Object.fromEntries(
      cardsToSync.map(card => [card.card_id, getLivePriceNumber(prices[card.card_id])] as const)
    )
    setAnalyticsLivePrices(prev => ({ ...prev, ...liveMap }))

    const progressCards = cardsToSync.map(card => {
      const live = liveMap[card.card_id]
      return live == null ? card : { ...card, market_price: live, inventory_price: null }
    })
    evaluateProgress(uid, progressCards, { claimDaily: true })
  }

  const fetchLivePriceForCard = async (card: { id?: string; card_id?: string; name?: string | null; set_name?: string | null }) => {
    try {
      const params = new URLSearchParams()
      params.set('cardId', card.card_id || card.id || '')
      if (card.name) params.set('name', card.name)
      if (card.set_name) params.set('setName', card.set_name)

      const res = await fetch(`/api/cards/price?${params.toString()}`)
      const data = await res.json()
      const price = data?.price
      return getLivePriceNumber(price)
    } catch {
      return null
    }
  }

  const isPriceAnomaly = (saved?: number | null, live?: number | null) => {
    if (saved == null || live == null) return false
    if (saved <= 0 || live <= 0) return false
    const high = Math.max(saved, live)
    const low = Math.min(saved, live)
    return high >= 50 && high / low >= 12
  }

  const loadLivePrice = async (card: { id?: string; card_id?: string; name?: string | null; set_name?: string | null }) => {
    setLivePriceLoading(true)
    setLivePrice(null)

    try {
      const params = new URLSearchParams()
      params.set('cardId', card.card_id || card.id || '')
      if (card.name) params.set('name', card.name)
      if (card.set_name) params.set('setName', card.set_name)

      const res = await fetch(`/api/cards/price?${params.toString()}`)
      const data = await res.json()
      const price = data?.price
      setLivePrice(getLivePriceNumber(price))
    } catch {
      setLivePrice(null)
    }

    setLivePriceLoading(false)
  }

  const openCollectionCard = (card: UserCard) => {
    setSelectedCard(card)
    void loadLivePrice({ card_id: card.card_id, name: card.name })
  }

  const openCatalogCard = (card: CatalogCard) => {
    setCatalogSelectedCard(card)
    void loadLivePrice(card)
  }

  const addCatalogCard = async (card: CatalogCard) => {
    if (!userId || catalogAddingId) return

    setCatalogAddingId(card.id)
    setCatalogMessage('')

    const { data: existing } = await supabase
      .from('user_cards')
      .select('id, quantity')
      .eq('user_id', userId)
      .eq('card_id', card.id)
      .maybeSingle()

    const currentCardLivePrice = catalogSelectedCard?.id === card.id
      ? livePrice
      : await fetchLivePriceForCard(card)
    const payload = {
      user_id: userId,
      card_id: card.id,
      name: card.name,
      image_url: card.image_url,
      rarity: card.rarity,
      card_color: card.card_color ?? null,
      card_type: card.card_type ?? null,
      card_cost: card.card_cost ?? null,
      card_power: card.card_power ?? null,
      market_price: currentCardLivePrice ?? null,
      inventory_price: null,
    }

    if (existing) {
      await supabase
        .from('user_cards')
        .update({
          quantity: existing.quantity + 1,
          ...payload
        })
        .eq('id', existing.id)
    } else {
      await supabase
        .from('user_cards')
        .insert({
          ...payload,
          quantity: 1
        })
    }

    if (userId) await loadCards(userId)
    setCatalogMessage(`${card.name} aggiunta alla collezione.`)
    setCatalogAddingId(null)
  }

  const getSavedPrice = (card: UserCard) => card.market_price ?? card.inventory_price ?? null

  const openAnalytics = async () => {
    setAnalyticsOpen(true)
    setAnalyticsLoading(true)

    const candidates = [...cards]

    const priceResults = await fetchLivePricesForCards(candidates)
    const liveMap = Object.fromEntries(
      candidates.map(card => [card.card_id, getLivePriceNumber(priceResults[card.card_id])] as const)
    )
    setAnalyticsLivePrices(prev => ({ ...prev, ...liveMap }))
    setAnalyticsLoading(false)
  }

  // 🔥 DELETE FIX DEFINITIVO
  const removeCard = async (cardId: string, qty: number) => {
    if (!userId) return

    console.log('DELETE CLICK:', cardId, qty)

    if (qty > 1) {
      const { error } = await supabase
        .from('user_cards')
        .update({ quantity: qty - 1 })
        .eq('user_id', userId)
        .eq('card_id', cardId)

      if (error) {
        console.error('UPDATE ERROR:', error)
        return
      }
    } else {
      const { error } = await supabase
        .from('user_cards')
        .delete()
        .eq('user_id', userId)
        .eq('card_id', cardId)

      if (error) {
        console.error('DELETE ERROR:', error)
        return
      }
    }

    await loadCards(userId)
  }

  const searchTermNormalized = searchTerm.trim().toLowerCase()
  const availableColors = Array.from(new Set(cards.map(card => card.card_color || 'Unknown'))).filter(Boolean)
  const availableRarities = Array.from(new Set(cards.map(card => card.rarity || 'Unknown'))).filter(Boolean)

  const filteredCards = cards.filter((item) => {
    const matchesSearch =
      !searchTermNormalized ||
      item.name?.toLowerCase().includes(searchTermNormalized) ||
      item.card_id.toLowerCase().includes(searchTermNormalized)

    const matchesColor =
      filterColor === 'all' ||
      (item.card_color || 'Unknown').toLowerCase() === filterColor.toLowerCase()

    const matchesRarity =
      filterRarity === 'all' ||
      (item.rarity || 'Unknown').toLowerCase() === filterRarity.toLowerCase()

    const cost = item.card_cost ?? -1
    let matchesCost = true
    if (filterCost === '0-2') matchesCost = cost >= 0 && cost <= 2
    if (filterCost === '3-5') matchesCost = cost >= 3 && cost <= 5
    if (filterCost === '6+') matchesCost = cost >= 6

    return matchesSearch && matchesColor && matchesRarity && matchesCost
  })

  const selectedStoredPrice = selectedCard
    ? selectedCard.market_price ?? selectedCard.inventory_price ?? null
    : null
  const selectedSavedPrice = isPriceAnomaly(selectedStoredPrice, livePrice) ? null : selectedStoredPrice
  const selectedPriceDelta = livePrice != null && selectedSavedPrice != null
    ? livePrice - selectedSavedPrice
    : null
  const formatDelta = (value: number) => {
    const sign = value > 0 ? '+' : ''
    return `${sign}${formatPrice(value)}`
  }
  const totalQuantity = cards.reduce((sum, card) => sum + card.quantity, 0)
  const getAnalyticsPrice = (card: UserCard) => {
    const saved = getSavedPrice(card)
    const live = analyticsLivePrices[card.card_id]
    if (isPriceAnomaly(saved, live)) return live
    return live ?? saved
  }
  const savedCollectionValue = cards.reduce((sum, card) => sum + ((getAnalyticsPrice(card) || 0) * card.quantity), 0)
  const topSavedCard = [...cards]
    .filter(card => getAnalyticsPrice(card) != null)
    .sort((a, b) => (getAnalyticsPrice(b) || 0) - (getAnalyticsPrice(a) || 0))[0] || null
  const duplicateCards = cards.filter(card => card.quantity > 1)
  const groupByQuantity = (field: 'rarity' | 'card_color') => Object.entries(
    cards.reduce<Record<string, number>>((acc, card) => {
      const key = String(card[field] || 'Unknown')
      acc[key] = (acc[key] || 0) + card.quantity
      return acc
    }, {})
  ).sort((a, b) => b[1] - a[1])
  const rarityStats = groupByQuantity('rarity').slice(0, 5)
  const colorStats = groupByQuantity('card_color').slice(0, 5)
  const analyticsPricedCards = [...cards]
    .filter(card => getAnalyticsPrice(card) != null)
    .sort((a, b) => ((getAnalyticsPrice(b) || 0) * b.quantity) - ((getAnalyticsPrice(a) || 0) * a.quantity))
  const analyticsCandidates = analyticsPricedCards
    .slice(0, 12)
  const analyticsDeltas = cards
    .map(card => {
      const stored = getSavedPrice(card)
      const live = analyticsLivePrices[card.card_id]
      const saved = isPriceAnomaly(stored, live) ? null : stored
      return {
        card,
        saved,
        live,
        delta: saved != null && live != null ? live - saved : null
      }
    })
    .filter(item => item.delta != null)
    .sort((a, b) => (b.delta || 0) - (a.delta || 0))
  const topRiser = analyticsDeltas[0] || null
  const topDrop = [...analyticsDeltas].sort((a, b) => (a.delta || 0) - (b.delta || 0))[0] || null
  const liveSampleValue = analyticsCandidates.reduce((sum, card) => {
    return sum + ((getAnalyticsPrice(card) ?? 0) * card.quantity)
  }, 0)

  return (
    <div className="h-dvh overflow-y-auto text-white onepiece-wave-bg onepiece-clouds">
      <Sidebar activePage="collezione" />
      <div className="w-full min-h-screen">

        <Topbar />

        {/* CONTENT */}
        <div className="h-[calc(100dvh-56px)] overflow-y-auto px-3 pb-36 pt-20 sm:px-6">

          <div className="relative space-y-3">
            <div className="rounded-[1.75rem] border border-slate-700 bg-slate-900/82 p-3 shadow-lg shadow-black/20 sm:p-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-black text-white">Collezione</p>
                  <p className="text-xs text-gray-400">{filteredCards.length} carte visibili</p>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setFiltersOpen(prev => !prev)}
                    className="flex h-11 w-11 items-center justify-center rounded-2xl border border-slate-600 bg-slate-800 text-cyan-100"
                    aria-label="Apri filtri"
                  >
                    <SlidersHorizontal size={18} />
                  </button>
                  <button
                    onClick={openAnalytics}
                    className="flex h-11 w-11 items-center justify-center rounded-2xl border border-slate-600 bg-slate-800 text-cyan-100"
                    aria-label="Analytics collezione"
                  >
                    <BarChart3 size={18} />
                  </button>
                  <button
                    onClick={() => {
                      setCatalogOpen(true)
                      setCatalogMessage('')
                    }}
                    className="flex h-11 items-center gap-2 rounded-2xl border border-cyan-300/40 bg-cyan-300 px-3 text-sm font-black text-slate-950 shadow-lg shadow-cyan-950/20 sm:px-4"
                  >
                    <Search size={17} />
                    <span className="hidden sm:inline">Cerca carta non posseduta</span>
                    <span className="sm:hidden">Catalogo</span>
                  </button>
                </div>
              </div>

              <label className="relative mt-3 block">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
                <input
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  placeholder="Cerca carta nella collezione"
                  className="min-w-0 w-full rounded-2xl border border-slate-700 bg-slate-950/80 py-3 pl-10 pr-3 text-sm text-white placeholder:text-slate-500 focus:border-cyan-300 focus:outline-none focus:ring-2 focus:ring-cyan-300/15"
                />
              </label>
            </div>

            {filtersOpen && (
              <div className="absolute right-0 top-full z-30 mt-2 w-full rounded-[1.75rem] border border-slate-700 bg-slate-950/95 p-4 shadow-2xl shadow-black/40 backdrop-blur-xl sm:w-[380px]">
                <div className="grid gap-3">
                  <select
                    value={filterColor}
                    onChange={(e) => setFilterColor(e.target.value)}
                    className="w-full rounded-2xl border border-slate-700 bg-slate-900/90 px-3 py-3 text-sm text-white focus:border-cyan-300 focus:outline-none"
                  >
                    <option value="all">Tutti i colori</option>
                    {availableColors.map((color) => (
                      <option key={color} value={color.toLowerCase()}>{color}</option>
                    ))}
                  </select>

                  <select
                    value={filterRarity}
                    onChange={(e) => setFilterRarity(e.target.value)}
                    className="w-full rounded-2xl border border-slate-700 bg-slate-900/90 px-3 py-3 text-sm text-white focus:border-cyan-300 focus:outline-none"
                  >
                    <option value="all">Tutte le rarita</option>
                    {availableRarities.map((rarity) => (
                      <option key={rarity} value={rarity.toLowerCase()}>{rarity}</option>
                    ))}
                  </select>

                  <select
                    value={filterCost}
                    onChange={(e) => setFilterCost(e.target.value)}
                    className="w-full rounded-2xl border border-slate-700 bg-slate-900/90 px-3 py-3 text-sm text-white focus:border-cyan-300 focus:outline-none"
                  >
                    <option value="all">Tutti i costi</option>
                    <option value="0-2">Costo 0-2</option>
                    <option value="3-5">Costo 3-5</option>
                    <option value="6+">Costo 6+</option>
                  </select>
                </div>

                <div className="mt-3 grid grid-cols-2 gap-2">
                  <button
                    onClick={() => {
                      setFilterColor('all')
                      setFilterRarity('all')
                      setFilterCost('all')
                    }}
                    className="rounded-2xl border border-slate-700 bg-slate-800 px-3 py-2 text-sm font-bold text-slate-200"
                  >
                    Reset
                  </button>
                  <button
                    onClick={() => setFiltersOpen(false)}
                    className="rounded-2xl border border-cyan-300/40 bg-cyan-300 px-3 py-2 text-sm font-black text-slate-950"
                  >
                    Applica
                  </button>
                </div>
              </div>
            )}

            <div className="hidden">
              <div>
                <p className="text-sm font-semibold text-white">Cerca nella collezione</p>
                <p className="text-xs text-gray-400">Usa testo, colore, rarità o costo per trovare le carte che possiedi.</p>
              </div>

              <div className="grid gap-2 sm:grid-cols-4 min-w-0">
                <input
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  placeholder="Cerca nome o codice"
                  className="min-w-0 w-full rounded-2xl border border-slate-700 bg-slate-900/90 px-3 py-2 text-sm text-white placeholder:text-slate-500 focus:border-amber-400 focus:outline-none focus:ring-2 focus:ring-amber-400/20"
                />

                <select
                  value={filterColor}
                  onChange={(e) => setFilterColor(e.target.value)}
                  className="w-full rounded-2xl border border-slate-700 bg-slate-900/90 px-3 py-2 text-sm text-white focus:border-amber-400 focus:outline-none focus:ring-2 focus:ring-amber-400/20"
                >
                  <option value="all">Tutti i colori</option>
                  {availableColors.map((color) => (
                    <option key={color} value={color.toLowerCase()}>{color}</option>
                  ))}
                </select>

                <select
                  value={filterRarity}
                  onChange={(e) => setFilterRarity(e.target.value)}
                  className="w-full rounded-2xl border border-slate-700 bg-slate-900/90 px-3 py-2 text-sm text-white focus:border-amber-400 focus:outline-none focus:ring-2 focus:ring-amber-400/20"
                >
                  <option value="all">Tutte le rarità</option>
                  {availableRarities.map((rarity) => (
                    <option key={rarity} value={rarity.toLowerCase()}>{rarity}</option>
                  ))}
                </select>

                <select
                  value={filterCost}
                  onChange={(e) => setFilterCost(e.target.value)}
                  className="w-full rounded-2xl border border-slate-700 bg-slate-900/90 px-3 py-2 text-sm text-white focus:border-amber-400 focus:outline-none focus:ring-2 focus:ring-amber-400/20"
                >
                  <option value="all">Tutti i costi</option>
                  <option value="0-2">Costo 0–2</option>
                  <option value="3-5">Costo 3–5</option>
                  <option value="6+">Costo 6+</option>
                </select>
              </div>
            </div>

            {!loadingCards && filteredCards.length === 0 && (
              <div className="rounded-3xl border border-slate-700 bg-slate-900/80 p-4 text-sm text-gray-300">
                Nessuna carta trovata con i filtri selezionati.
              </div>
            )}
          </div>

          {loadingCards && (
            <p className="text-gray-400 text-sm">Caricamento collezione...</p>
          )}

          <div className="grid grid-cols-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-7 2xl:grid-cols-8 gap-1.5 sm:gap-2 mt-4">

            {[...filteredCards]
  .sort((a, b) => {
    const parse = (id: string) => {
      const matchOp = id.match(/OP(\d+)-(\d+)/i)
      const matchEb = id.match(/EB(\d+)-(\d+)/i)
      
      if (matchOp) {
        return { type: 'op', set: parseInt(matchOp[1], 10), num: parseInt(matchOp[2], 10) }
      }
      if (matchEb) {
        return { type: 'eb', set: parseInt(matchEb[1], 10), num: parseInt(matchEb[2], 10) }
      }
      return { type: 'other', set: 0, num: 0 }
    }

    const A = parse(a.card_id)
    const B = parse(b.card_id)

    // EB prima di OP
    if (A.type !== B.type) {
      if (A.type === 'eb') return -1
      if (B.type === 'eb') return 1
      return 0
    }

    // all'interno dello stesso tipo: set decrescente (15 → 14 → 13)
    if (A.set !== B.set) return B.set - A.set

    // dentro set: 001 → 002 → 025
    return A.num - B.num
  })
  .map((item) => (
              <div
                key={item.card_id}
                className="relative bg-slate-900 rounded-lg p-1.5 sm:p-2 border border-slate-700 hover:border-amber-400/60 transition onepiece-card-hover onepiece-border-glow"
              >

                {/* DELETE BUTTON */}
                {/* MENU DELETE (3 PUNTINI) */}
<div className="absolute bottom-1 sm:bottom-2 right-1 sm:right-2">
  
  <button 
    onClick={() => setOpenMenuId(openMenuId === item.card_id ? null : item.card_id)}
    className="text-gray-400 hover:text-red-400 text-base sm:text-lg leading-none px-1"
  >
    ⋯
  </button>

  {openMenuId === item.card_id && (
    <>
      <div 
        className="fixed inset-0 z-20"
        onClick={() => setOpenMenuId(null)}
      />
      <div className="absolute bottom-6 right-0 bg-slate-800 border border-slate-700 rounded-md shadow-lg overflow-hidden z-30">
    
        <button
          onClick={() => {
            removeCard(item.card_id, item.quantity)
            setOpenMenuId(null)
          }}
          className="flex items-center gap-2 px-2 sm:px-3 py-1 sm:py-2 text-red-400 hover:bg-slate-700 text-xs w-full whitespace-nowrap"
        >
          <Trash2 size={12} className="sm:w-3.5 sm:h-3.5" />
          Elimina
        </button>
        <button
          onClick={() => {
            openCollectionCard(item)
            setOpenMenuId(null)
          }}
          className="flex items-center gap-2 px-2 sm:px-3 py-1 sm:py-2 text-white hover:bg-slate-700 text-xs w-full whitespace-nowrap"
        >
          Info
        </button>
      </div>
    </>
  )}
</div>

                <button onClick={() => openCollectionCard(item)} className="block w-full text-left">
                  <CardImage
                    src={item.image_url}
                    cardId={item.card_id}
                    alt={item.name || item.card_id}
                    className="w-full aspect-[3/4] overflow-hidden rounded-md bg-black"
                    imgClassName="h-full w-full object-contain"
                    fallbackClassName="flex h-full w-full items-center justify-center text-[10px] text-gray-400"
                  />
                </button>

                <p className="font-bold mt-1 sm:mt-2 text-[10px] sm:text-xs line-clamp-2">{item.name || 'Unknown'}</p>
                <p className="text-[8px] sm:text-[10px] text-gray-400">{item.rarity || '?'}</p>
                <p className="text-[7px] sm:text-[9px] text-gray-500 truncate">{displayCardId(item.card_id)}</p>
                <p className="text-[10px] sm:text-xs text-amber-300 mt-1">x{item.quantity}</p>

              </div>
            ))}

          </div>

        </div>

      </div>

      {/* ADD BUTTON */}
      <div className="fixed bottom-24 left-1/2 z-50 -translate-x-1/2 pointer-events-none sm:bottom-28">
        <button
          onClick={() => setAddOpen(true)}
          className="pointer-events-auto group grid h-16 w-16 place-items-center rounded-full border border-cyan-200/50 bg-gradient-to-r from-cyan-300 to-rose-300 text-slate-950 shadow-[0_18px_44px_rgba(0,0,0,0.45)] transition hover:scale-[1.04] hover:shadow-cyan-950/40 active:scale-95"
          aria-label="Aggiungi carta"
        >
          <Plus className="text-slate-950" size={30} strokeWidth={3} />
        </button>
      </div>
{catalogOpen && (
  <div
    className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 p-2 backdrop-blur-md sm:items-center sm:p-4"
    onClick={(event) => {
      if (event.target === event.currentTarget) {
        setCatalogOpen(false)
        setCatalogSelectedCard(null)
        setLivePrice(null)
      }
    }}
  >
    <div
      className="flex h-[88dvh] w-[calc(100vw-1rem)] max-w-6xl flex-col overflow-hidden rounded-[1.75rem] border border-slate-700 bg-slate-950/96 shadow-2xl shadow-black/50 sm:h-[84vh] sm:w-full"
      onClick={(event) => event.stopPropagation()}
    >
      <div className="flex items-center gap-2 border-b border-slate-800 p-3">
        <label className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
          <input
            value={catalogQuery}
            onChange={(event) => setCatalogQuery(event.target.value)}
            placeholder="Cerca una carta qualsiasi"
            className="w-full rounded-2xl border border-slate-700 bg-slate-900/90 py-3 pl-10 pr-3 text-sm text-white outline-none focus:border-cyan-300"
            autoFocus
          />
        </label>
        <button
          onClick={() => {
            setCatalogOpen(false)
            setCatalogSelectedCard(null)
            setLivePrice(null)
          }}
          className="flex h-11 w-11 items-center justify-center rounded-2xl border border-slate-700 bg-slate-800 text-slate-200"
          aria-label="Chiudi catalogo"
        >
          <X size={18} />
        </button>
      </div>

      {catalogMessage && (
        <div className="border-b border-emerald-500/20 bg-emerald-500/10 px-4 py-2 text-sm font-semibold text-emerald-200">
          {catalogMessage}
        </div>
      )}

      <div className="grid min-h-0 flex-1 gap-0 lg:grid-cols-[1fr_340px]">
        <div className="min-h-0 overflow-y-auto p-3">
          {catalogSelectedCard && (
            <div className="mb-3 grid grid-cols-[92px_minmax(0,1fr)] gap-3 rounded-3xl border border-cyan-300/20 bg-cyan-300/10 p-3 lg:hidden">
              <CardImage
                src={catalogSelectedCard.image_url}
                cardId={catalogSelectedCard.id}
                alt={catalogSelectedCard.name}
                className="aspect-[3/4] overflow-hidden rounded-2xl bg-slate-950"
              />
              <div className="min-w-0">
                <p className="line-clamp-2 text-sm font-black text-white">{catalogSelectedCard.name}</p>
                <p className="mt-1 truncate text-[10px] uppercase tracking-[0.18em] text-slate-500">{displayCardId(catalogSelectedCard.id)}</p>
                <p className="mt-2 text-2xl font-black text-cyan-200">{livePriceLoading ? '...' : formatPrice(livePrice)}</p>
                <button
                  onClick={() => addCatalogCard(catalogSelectedCard)}
                  disabled={catalogAddingId === catalogSelectedCard.id}
                  className="mt-2 rounded-xl bg-cyan-300 px-3 py-2 text-[11px] font-black text-slate-950 disabled:opacity-60"
                >
                  {catalogAddingId === catalogSelectedCard.id ? 'Aggiungo...' : 'Aggiungi'}
                </button>
              </div>
            </div>
          )}

          {catalogQuery.trim().length < 2 ? (
            <div className="flex h-full items-center justify-center rounded-3xl border border-dashed border-slate-700 p-6 text-center text-sm text-slate-400">
              Cerca per nome o codice carta.
            </div>
          ) : catalogLoading ? (
            <div className="rounded-3xl border border-slate-700 bg-slate-900/80 p-4 text-sm text-slate-400">Ricerca in corso...</div>
          ) : catalogCards.length === 0 ? (
            <div className="rounded-3xl border border-slate-700 bg-slate-900/80 p-4 text-sm text-slate-400">Nessuna carta trovata.</div>
          ) : (
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
              {catalogCards.map((card) => (
                <div key={card.id} className="rounded-2xl border border-slate-800 bg-slate-900/86 p-2">
                  <button
                    onClick={() => openCatalogCard(card)}
                    className="block w-full text-left"
                  >
                    <CardImage
                      src={card.image_url}
                      cardId={card.id}
                      alt={card.name}
                      className="aspect-[3/4] overflow-hidden rounded-xl bg-slate-950"
                    />
                    <p className="mt-2 line-clamp-2 text-[11px] font-bold text-white">{card.name}</p>
                    <p className="mt-1 truncate text-[9px] text-slate-500">{card.id}</p>
                  </button>
                  <button
                    onClick={() => addCatalogCard(card)}
                    disabled={catalogAddingId === card.id}
                    className="mt-2 w-full rounded-xl bg-cyan-300 px-2 py-2 text-[11px] font-black text-slate-950 disabled:opacity-60"
                  >
                    {catalogAddingId === card.id ? '...' : 'Aggiungi'}
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        <aside className="hidden min-h-0 border-l border-slate-800 bg-slate-900/60 p-3 lg:block">
          {catalogSelectedCard ? (
            <div className="flex h-full flex-col">
              <div className="min-h-0 flex-1 overflow-y-auto">
                <CardImage
                  src={catalogSelectedCard.image_url}
                  cardId={catalogSelectedCard.id}
                  alt={catalogSelectedCard.name}
                  className="aspect-[3/4] overflow-hidden rounded-3xl bg-slate-950"
                />
                <p className="mt-3 text-xl font-black text-white">{catalogSelectedCard.name}</p>
                <p className="mt-1 text-xs uppercase tracking-[0.22em] text-slate-500">{displayCardId(catalogSelectedCard.id)}</p>
                <div className="mt-3 rounded-2xl border border-cyan-300/20 bg-cyan-300/10 p-3">
                  <p className="text-[10px] uppercase tracking-[0.25em] text-slate-400">Valore live</p>
                  <p className="mt-1 text-2xl font-black text-cyan-200">{livePriceLoading ? '...' : formatPrice(livePrice)}</p>
                </div>
              </div>
              <button
                onClick={() => addCatalogCard(catalogSelectedCard)}
                disabled={catalogAddingId === catalogSelectedCard.id}
                className="mt-3 rounded-2xl bg-cyan-300 px-4 py-3 text-sm font-black text-slate-950 disabled:opacity-60"
              >
                {catalogAddingId === catalogSelectedCard.id ? 'Aggiungo...' : 'Aggiungi alla collezione'}
              </button>
            </div>
          ) : (
            <div className="flex h-full items-center justify-center rounded-3xl border border-dashed border-slate-700 p-5 text-center text-sm text-slate-400">
              Tocca una carta per vedere prezzo live e dettagli.
            </div>
          )}
        </aside>
      </div>
    </div>
  </div>
)}
{analyticsOpen && (
  <div
    className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 p-2 backdrop-blur-md sm:items-center sm:p-4"
    onClick={(event) => {
      if (event.target === event.currentTarget) {
        setAnalyticsOpen(false)
      }
    }}
  >
    <div
      className="flex max-h-[88dvh] w-full max-w-4xl flex-col overflow-hidden rounded-[1.75rem] border border-slate-700 bg-slate-950/96 shadow-2xl shadow-black/50"
      onClick={(event) => event.stopPropagation()}
    >
      <div className="flex items-center justify-between gap-3 border-b border-slate-800 p-3">
        <div>
          <p className="text-[10px] uppercase tracking-[0.28em] text-cyan-200">Analytics</p>
          <h3 className="text-lg font-black text-white">Collezione</h3>
        </div>
        <button
          onClick={() => setAnalyticsOpen(false)}
          className="flex h-10 w-10 items-center justify-center rounded-2xl border border-slate-700 bg-slate-800 text-slate-200"
          aria-label="Chiudi analytics"
        >
          <X size={18} />
        </button>
      </div>

      <div className="min-h-0 overflow-y-auto p-3">
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {[
            ['Carte totali', totalQuantity.toString()],
            ['Uniche', cards.length.toString()],
            ['Valore stimato', formatPrice(savedCollectionValue)],
            ['Doppioni', duplicateCards.length.toString()],
          ].map(([label, value]) => (
            <div key={label} className="rounded-2xl border border-slate-700 bg-slate-900/80 p-3">
              <p className="text-[9px] uppercase tracking-[0.2em] text-slate-500">{label}</p>
              <p className="mt-2 text-lg font-black text-white">{value}</p>
            </div>
          ))}
        </div>

        <div className="mt-2 grid gap-2 lg:grid-cols-2">
          <div className="rounded-3xl border border-slate-700 bg-slate-900/82 p-3">
            <div className="flex items-center gap-2">
              <Crown className="text-cyan-200" size={18} />
              <p className="text-sm font-black text-white">Carta più alta</p>
            </div>
            {topSavedCard ? (
              <div className="mt-3 grid grid-cols-[76px_1fr] gap-3">
                <button onClick={() => openCollectionCard(topSavedCard)} className="block text-left">
                  <CardImage
                    src={topSavedCard.image_url}
                    cardId={topSavedCard.card_id}
                    alt={topSavedCard.name || 'Carta'}
                    className="aspect-[3/4] overflow-hidden rounded-2xl bg-slate-950"
                  />
                </button>
                <div className="min-w-0">
                  <p className="line-clamp-2 text-sm font-bold text-white">{topSavedCard.name}</p>
                  <p className="mt-1 text-[10px] uppercase tracking-[0.18em] text-slate-500">{displayCardId(topSavedCard.card_id)}</p>
                  <p className="mt-2 text-2xl font-black text-cyan-200">{formatPrice(getAnalyticsPrice(topSavedCard))}</p>
                </div>
              </div>
            ) : (
              <p className="mt-3 text-sm text-slate-400">Nessun prezzo salvato.</p>
            )}
          </div>

          <div className="rounded-3xl border border-slate-700 bg-slate-900/82 p-3">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <TrendingUp className="text-emerald-200" size={18} />
                <p className="text-sm font-black text-white">Trend live</p>
              </div>
              <button
                onClick={openAnalytics}
                className="rounded-xl border border-cyan-300/30 bg-cyan-300/10 px-2 py-1 text-[10px] font-bold text-cyan-100"
              >
                Aggiorna
              </button>
            </div>
            <p className="mt-2 text-xs text-slate-400">
              {analyticsLoading ? 'Aggiorno i prezzi live...' : `Prezzi aggiornati: ${analyticsCandidates.length} carte principali`}
            </p>
            <div className="mt-3 rounded-2xl border border-slate-700 bg-slate-950/70 p-3">
              <p className="text-[9px] uppercase tracking-[0.2em] text-slate-500">Valore aggiornato carte principali</p>
              <p className="mt-1 text-xl font-black text-cyan-200">{formatPrice(liveSampleValue)}</p>
            </div>
            <div className="mt-2 grid gap-2 sm:grid-cols-2">
              <div className="rounded-2xl border border-emerald-500/20 bg-emerald-500/10 p-3">
                <p className="text-[9px] uppercase tracking-[0.2em] text-slate-500">Migliorata</p>
                <p className="mt-1 line-clamp-1 text-sm font-bold text-white">{topRiser?.card.name || '—'}</p>
                <p className="mt-1 text-lg font-black text-emerald-200">{topRiser?.delta != null ? formatDelta(topRiser.delta) : '—'}</p>
              </div>
              <div className="rounded-2xl border border-rose-500/20 bg-rose-500/10 p-3">
                <p className="text-[9px] uppercase tracking-[0.2em] text-slate-500">Da controllare</p>
                <p className="mt-1 line-clamp-1 text-sm font-bold text-white">{topDrop?.card.name || '—'}</p>
                <p className="mt-1 text-lg font-black text-rose-200">{topDrop?.delta != null ? formatDelta(topDrop.delta) : '—'}</p>
              </div>
            </div>
          </div>
        </div>

        <div className="mt-2 grid gap-2 lg:grid-cols-2">
          <div className="rounded-3xl border border-slate-700 bg-slate-900/82 p-3">
            <p className="text-sm font-black text-white">Rarità più presenti</p>
            <div className="mt-3 space-y-2">
              {rarityStats.map(([label, count]) => (
                <div key={label} className="flex items-center justify-between rounded-2xl bg-slate-950/70 px-3 py-2 text-sm">
                  <span className="truncate text-slate-300">{label}</span>
                  <span className="font-black text-cyan-200">{count}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-3xl border border-slate-700 bg-slate-900/82 p-3">
            <p className="text-sm font-black text-white">Colori collezione</p>
            <div className="mt-3 space-y-2">
              {colorStats.map(([label, count]) => (
                <div key={label} className="flex items-center justify-between rounded-2xl bg-slate-950/70 px-3 py-2 text-sm">
                  <span className="truncate text-slate-300">{label}</span>
                  <span className="font-black text-cyan-200">{count}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
)}
{selectedCard && (
  <div
    className="fixed inset-0 z-50 bg-black/70 backdrop-blur-md flex items-center justify-center p-4"
    onClick={(event) => {
      if (event.target === event.currentTarget) {
        setSelectedCard(null)
        setLivePrice(null)
      }
    }}
    onTouchMove={(event) => event.preventDefault()}
  >

    <div
      className="w-full max-w-sm sm:max-w-2xl bg-slate-900 rounded-xl border border-slate-700 p-3 sm:p-5 relative max-h-[90vh] overflow-y-auto"
      onClick={(event) => event.stopPropagation()}
    >

      <button
        onClick={() => {
          setSelectedCard(null)
          setLivePrice(null)
        }}
        className="absolute top-2 right-2 sm:top-3 sm:right-3 text-white hover:text-gray-300"
      >
        ✕
      </button>

      <div className="grid gap-4 lg:grid-cols-[1fr_1.2fr]">
        <CardImage
          src={selectedCard.image_url}
          cardId={selectedCard.card_id}
          alt={selectedCard.name || 'Carta'}
          className="aspect-[3/4] overflow-hidden rounded-3xl border border-slate-700 bg-slate-800 p-3"
          imgClassName="h-full w-full object-contain"
        />

        <div className="space-y-4">
          <div>
            <h2 className="text-lg sm:text-xl font-bold text-amber-300 mb-2">
              {selectedCard.name || 'Carta sconosciuta'}
            </h2>
            <p className="text-xs uppercase tracking-[0.25em] text-gray-400 mb-3">
              {displayCardId(selectedCard.card_id)}
            </p>
            <div className="mb-3 grid gap-2 sm:grid-cols-3">
              <div className="rounded-2xl border border-cyan-300/20 bg-cyan-300/10 p-3">
                <p className="text-[10px] uppercase tracking-[0.2em] text-gray-500">Live USD</p>
                <p className="mt-1 text-xl font-black text-cyan-200">{livePriceLoading ? '...' : formatPrice(livePrice)}</p>
              </div>
              <div className="rounded-2xl border border-white/10 bg-white/[0.05] p-3">
                <p className="text-[10px] uppercase tracking-[0.2em] text-gray-500">Aggiunta</p>
                <p className="mt-1 text-xl font-black text-white">{formatPrice(selectedSavedPrice)}</p>
              </div>
              <div className={`rounded-2xl border p-3 ${
                selectedPriceDelta == null
                  ? 'border-white/10 bg-white/[0.05]'
                  : selectedPriceDelta >= 0
                  ? 'border-emerald-400/25 bg-emerald-400/10'
                  : 'border-rose-400/25 bg-rose-400/10'
              }`}>
                <p className="text-[10px] uppercase tracking-[0.2em] text-gray-500">Differenza</p>
                <p className={`mt-1 text-xl font-black ${
                  selectedPriceDelta == null
                    ? 'text-slate-300'
                    : selectedPriceDelta >= 0
                    ? 'text-emerald-200'
                    : 'text-rose-200'
                }`}>
                  {selectedPriceDelta == null ? '-' : formatDelta(selectedPriceDelta)}
                </p>
              </div>
            </div>
          </div>

          <div className="hidden">
            <div className="rounded-2xl bg-slate-900/90 border border-slate-700 p-3">
              <p className="text-[10px] uppercase tracking-[0.24em] text-gray-500 mb-2">Generale</p>
              <p className="text-sm text-gray-200"><span className="text-amber-300">Rarità:</span> {selectedCard.rarity || '—'}</p>
              <p className="text-sm text-gray-200"><span className="text-amber-300">Colore:</span> {selectedCard.card_color || '—'}</p>
              <p className="text-sm text-gray-200"><span className="text-amber-300">Tipo:</span> {selectedCard.card_type || '—'}</p>
            </div>

            <div className="rounded-2xl bg-slate-900/90 border border-slate-700 p-3">
              <p className="text-[10px] uppercase tracking-[0.24em] text-gray-500 mb-2">Statistiche</p>
              <p className="text-sm text-gray-200"><span className="text-amber-300">Costo:</span> {selectedCard.card_cost ?? '—'}</p>
              <p className="text-sm text-gray-200"><span className="text-amber-300">Power:</span> {selectedCard.card_power ?? '—'}</p>
              <p className="text-sm text-gray-200"><span className="text-amber-300">Quantità:</span> {selectedCard.quantity}</p>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {[
              ['Rarita', selectedCard.rarity || '-'],
              ['Colore', selectedCard.card_color || '-'],
              ['Tipo', selectedCard.card_type || '-'],
              ['Costo', selectedCard.card_cost ?? '-'],
              ['Power', selectedCard.card_power ?? '-'],
              ['Qta', selectedCard.quantity],
            ].map(([label, value]) => (
              <div key={String(label)} className="rounded-2xl border border-slate-700 bg-slate-900/90 p-3">
                <p className="text-[10px] uppercase tracking-[0.2em] text-gray-500">{label}</p>
                <p className="mt-1 truncate text-sm font-bold text-gray-100">{value}</p>
              </div>
            ))}
          </div>

        </div>
      </div>

    </div>

  </div>
)}
      {/* MODAL */}
      
      {addOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-md p-2 sm:p-4 overflow-hidden"
          onClick={(event) => {
            if (event.target === event.currentTarget) {
              refreshAfterAdd()
            }
          }}
          onTouchMove={(event) => event.preventDefault()}
        >

          
<div className="relative w-full max-w-5xl h-[85vh] bg-slate-900 rounded-xl overflow-hidden border border-slate-700 flex flex-col">
            <button
              onClick={refreshAfterAdd}
              className="absolute top-3 right-3 sm:top-4 sm:right-4 z-50 bg-black/80 hover:bg-black/95 p-2 rounded-full transition flex-shrink-0 text-white"
            >
              ✕
            </button>

            <iframe
              title="add-card-form"
              src="/add-card"
              className="w-full flex-1 min-h-0"
              style={{
                display: 'block',
                border: 'none',
                overflow: 'hidden'
              }}
            />
          </div>
        </div>
      )}

    </div>
  )
}
