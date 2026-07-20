'use client'

import { useEffect, useRef, useState } from 'react'
import { Archive, BarChart3, Crown, Plus, RotateCcw, Search, SlidersHorizontal, Trash2, TrendingUp, X } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import Sidebar from '@/app/components/Sidebar'
import Topbar from '@/app/components/Topbar'
import CardImage from '@/app/components/CardImage'
import PushNotificationPrompt from '@/app/components/PushNotificationPrompt'
import DailyRewardBanner from '@/app/components/DailyRewardBanner'
import CardErrorReport from '@/app/components/CardErrorReport'
import { useRouter } from 'next/navigation'
import { trackAnalyticsEvent } from '@/lib/analytics'
import { getRarityLabel, rarityFilterValue } from '@/lib/rarity'

type UserCard = {
  id?: string
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
  sale_price?: number | null
  sold_at?: string | null
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

type SoldCard = UserCard & {
  id: string
  sale_price: number
  sold_at: string
}

type LivePriceResult = {
  marketPrice?: number | null
  midPrice?: number | null
  lowPrice?: number | null
  directLowPrice?: number | null
  currency?: string | null
  originalCurrency?: string | null
  source?: string | null
}

const SET_RELEASE_ORDER: Record<string, number> = {
  OP16: 16000,
  ST30: 15920,
  OP15: 15000,
  EB03: 14500,
  OP14: 14000,
  OP13: 13000,
  OP12: 12000,
  OP11: 11000,
  EB02: 10500,
  OP10: 10000,
  PRB02: 9800,
  OP09: 9000,
  PRB01: 8500,
  OP08: 8000,
  OP07: 7000,
  EB01: 6500,
  OP06: 6000,
  OP05: 5000,
  OP04: 4000,
  OP03: 3000,
  OP02: 2000,
  OP01: 1000,
}

const knownCardColors = ['Red', 'Green', 'Blue', 'Purple', 'Black', 'Yellow']
const colorAliases: Record<string, string> = {
  red: 'Red',
  rosso: 'Red',
  green: 'Green',
  verde: 'Green',
  blue: 'Blue',
  blu: 'Blue',
  purple: 'Purple',
  viola: 'Purple',
  black: 'Black',
  nero: 'Black',
  yellow: 'Yellow',
  giallo: 'Yellow',
}

const normalizeCardColors = (value?: string | null) => {
  const raw = String(value || '').trim()
  if (!raw || raw === 'Unknown') return []

  const parts = raw
    .split(/[\/,|+&]/)
    .map(part => part.trim().toLowerCase())
    .filter(Boolean)

  const values = parts.length > 0 ? parts : [raw.toLowerCase()]
  return [...new Set(values.map(color => colorAliases[color] || raw).filter(Boolean))]
}

const setDisplayName = (setCode: string) => {
  if (setCode === 'OTHER') return 'Altre carte'
  return setCode.replace(/^([A-Z]+)(\d+)$/, '$1-$2')
}

const numberOrNull = (value: unknown) => {
  if (value === null || value === undefined || value === '') return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

const compactCardCode = (value?: string | null) =>
  String(value || '').toUpperCase().replace(/[^A-Z0-9]/g, '')

const priceCache = new Map<string, LivePriceResult | null>()
const priceCacheKey = (card: { card_id: string; name?: string | null; set_name?: string | null }) =>
  [card.card_id, card.name || '', card.set_name || ''].join('|').toLowerCase()

const parseCollectionSet = (cardId: string) => {
  const normalized = (cardId || '').toUpperCase().replace(/_/g, '-')
  const match = normalized.match(/^(OP|EB|ST|PRB|SP|EX|CP)(\d{1,2})-?(\d{3})/)
  if (!match) {
    const promoMatch = normalized.match(/^(P)-?(\d{3})/)
    return {
      setCode: promoMatch ? 'P' : 'OTHER',
      releaseOrder: promoMatch ? 100 : 0,
      number: promoMatch ? Number(promoMatch[2]) : 0,
    }
  }

  const [, prefix, setRaw, numberRaw] = match
  const setNumber = Number(setRaw)
  const setCode = `${prefix}${String(setNumber).padStart(2, '0')}`
  return {
    setCode,
    releaseOrder: SET_RELEASE_ORDER[setCode] ?? (
      prefix === 'OP' ? setNumber * 1000 :
      prefix === 'EB' ? setNumber * 1000 + 500 :
      prefix === 'ST' ? 200 + setNumber :
      50 + setNumber
    ),
    number: Number(numberRaw || 0),
  }
}

export default function Dashboard() {
  const [selectedCard, setSelectedCard] = useState<UserCard | null>(null)
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
  const [missingReportOpen, setMissingReportOpen] = useState(false)
  const [missingCardCode, setMissingCardCode] = useState('')
  const [missingCardVariant, setMissingCardVariant] = useState('')
  const [missingCardDescription, setMissingCardDescription] = useState('')
  const [missingReportSubmitting, setMissingReportSubmitting] = useState(false)
  const catalogSearchRunRef = useRef(0)
  const [livePrice, setLivePrice] = useState<number | null>(null)
  const [livePriceLoading, setLivePriceLoading] = useState(false)
  const [analyticsOpen, setAnalyticsOpen] = useState(false)
  const [analyticsLoading, setAnalyticsLoading] = useState(false)
  const [analyticsLivePrices, setAnalyticsLivePrices] = useState<Record<string, number | null>>({})
  const [pricesReady, setPricesReady] = useState(false)
  const [soldOpen, setSoldOpen] = useState(false)
  const [soldCards, setSoldCards] = useState<SoldCard[]>([])
  const [soldLivePrices, setSoldLivePrices] = useState<Record<string, number | null>>({})
  const [soldLoading, setSoldLoading] = useState(false)
  const [soldReady, setSoldReady] = useState(true)
  const [sellingCard, setSellingCard] = useState<UserCard | null>(null)
  const [salePrice, setSalePrice] = useState('')
  const [saleQuantity, setSaleQuantity] = useState(1)
  const [sellingBusy, setSellingBusy] = useState(false)
  const [restoringSoldId, setRestoringSoldId] = useState<string | null>(null)
  const [saleMessage, setSaleMessage] = useState('')
  const detailRunRef = useRef(0)

 useEffect(() => {
  if (selectedCard || catalogOpen || analyticsOpen || soldOpen || sellingCard) {
    document.body.style.overflow = 'hidden'
    document.documentElement.style.overflow = 'hidden'
  } else {
    document.body.style.overflow = 'auto'
    document.documentElement.style.overflow = 'auto'
  }
}, [selectedCard, catalogOpen, analyticsOpen, soldOpen, sellingCard])

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
    setPricesReady(false)

    const { data, error } = await supabase
      .from('user_cards')
      .select(
        'id, card_id, quantity, name, image_url, rarity, card_color, card_type, card_cost, card_power, market_price, inventory_price'
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
      rarity: card.rarity === 'Unknown' ? null : card.rarity,
      card_color: card.card_color === 'Unknown' ? null : card.card_color,
      card_type: card.card_type === 'Unknown' ? null : card.card_type,
      card_cost: numberOrNull(card.card_cost),
      card_power: numberOrNull(card.card_power),
      market_price: card.market_price == null ? null : Number(card.market_price),
      inventory_price: card.inventory_price == null ? null : Number(card.inventory_price)
    }))
    setCards(loadedCards)
    setLoadingCards(false)
    void backfillMissingCardDetails(uid, loadedCards)
    void syncLivePricesForCards(uid, loadedCards)
  }

  useEffect(() => {
    if (!userId) return
    loadCards(userId)
  }, [userId])

  useEffect(() => {
    if (!catalogOpen) {
      catalogSearchRunRef.current += 1
      return
    }

    const search = async () => {
      const q = catalogQuery.trim()
      const runId = ++catalogSearchRunRef.current

      if (q.length < 2) {
        catalogSearchRunRef.current += 1
        setCatalogCards([])
        setCatalogLoading(false)
        return
      }

      try {
        setCatalogLoading(true)
        void trackAnalyticsEvent('manual_search', { source: 'collection', length: q.length }, '/dashboard')
        const res = await fetch(`/api/cards/search?q=${encodeURIComponent(q)}`)
        const data = await res.json()
        if (runId !== catalogSearchRunRef.current) return
        const seen = new Set<string>()
        const clean: CatalogCard[] = (Array.isArray(data) ? data : [])
          .map((card: any) => ({
            id: String(card.card_set_id ?? card.card_id ?? card.id),
            name: card.card_name || card.name || 'Carta',
            image_url: card.card_image || card.image_url || null,
            rarity: card.rarity || '-',
            card_color: card.card_color ?? null,
            card_type: card.card_type ?? null,
            card_cost: numberOrNull(card.card_cost),
            card_power: numberOrNull(card.card_power),
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
        if (runId !== catalogSearchRunRef.current) return
        setCatalogCards([])
      }
      if (runId !== catalogSearchRunRef.current) return
      setCatalogLoading(false)
    }

    const timeout = setTimeout(search, 250)
    return () => clearTimeout(timeout)
  }, [catalogOpen, catalogQuery])

  const closeCatalog = () => {
    setCatalogOpen(false)
    setCatalogSelectedCard(null)
    setLivePrice(null)
    setMissingReportOpen(false)
  }

  const submitMissingCardReport = async () => {
    if (!missingCardCode.trim() || !missingCardVariant.trim()) {
      setCatalogMessage('Compila codice carta e tipo/variante.')
      return
    }

    setMissingReportSubmitting(true)
    setCatalogMessage('')

    try {
      const { data: { session } } = await supabase.auth.getSession()
      const response = await fetch('/api/cards/report-missing', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
        },
        body: JSON.stringify({
          card_code: missingCardCode.trim(),
          card_variant: missingCardVariant.trim(),
          description: missingCardDescription.trim(),
        }),
      })

      const data = await response.json().catch(() => null)
      if (!response.ok) throw new Error(data?.error || 'Errore invio segnalazione')

      setCatalogMessage('Segnalazione inviata. Grazie!')
      setMissingCardCode('')
      setMissingCardVariant('')
      setMissingCardDescription('')
      setMissingReportOpen(false)
    } catch (error) {
      setCatalogMessage(error instanceof Error ? error.message : 'Errore durante l\'invio. Riprova tra poco.')
    } finally {
      setMissingReportSubmitting(false)
    }
  }

  const formatPrice = (value?: number | null) =>
    value == null
      ? '—'
      : new Intl.NumberFormat('it-IT', { style: 'currency', currency: 'EUR' }).format(value)
  const displayCardId = (value?: string | null) =>
    (value || '')
      .replace(/_p\d+$/i, '')
      .replace(/^((?:OP|ST|EB|PRB|SP|EX|CP)\d{2}-\d{3}|P-\d{3}|DON-\d{3})p\d+$/i, '$1')
  const getLivePriceNumber = (price?: LivePriceResult | null) => {
    if (!price) return null
    return price.marketPrice ?? price.midPrice ?? price.directLowPrice ?? price.lowPrice ?? null
  }

  const fetchLivePricesForCards = async (cardsToPrice: Array<{ card_id: string; name?: string | null; set_name?: string | null }>) => {
    const allPrices: Record<string, LivePriceResult | null> = {}
    const missingCards: Array<{ card_id: string; name?: string | null; set_name?: string | null }> = []
    const seenKeys = new Set<string>()

    cardsToPrice.forEach(card => {
      const key = priceCacheKey(card)
      if (priceCache.has(key)) {
        allPrices[card.card_id] = priceCache.get(key) ?? null
        return
      }
      if (!seenKeys.has(key)) {
        seenKeys.add(key)
        missingCards.push(card)
      }
    })

    if (missingCards.length === 0) return allPrices

    try {
      for (let index = 0; index < missingCards.length; index += 120) {
        const chunk = missingCards.slice(index, index + 120)
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
        const chunkPrices = (data?.prices || {}) as Record<string, LivePriceResult | null>
        chunk.forEach(card => {
          const value = chunkPrices[card.card_id] ?? null
          priceCache.set(priceCacheKey(card), value)
          allPrices[card.card_id] = value
        })
      }
    } catch {
    }

    return allPrices
  }

  const syncLivePricesForCards = async (uid: string, cardsToSync: UserCard[]) => {
    if (cardsToSync.length === 0) {
      setPricesReady(true)
      return
    }

    const prices = await fetchLivePricesForCards(cardsToSync)
    const liveMap = Object.fromEntries(
      cardsToSync.map(card => [card.card_id, getLivePriceNumber(prices[card.card_id])] as const)
    )
    setAnalyticsLivePrices(prev => ({ ...prev, ...liveMap }))
    setPricesReady(true)

    const missingSavedPrices = cardsToSync
      .filter(card => getSavedPrice(card) == null && liveMap[card.card_id] != null)
      .map(card => ({
        card_id: card.card_id,
        market_price: liveMap[card.card_id] as number
      }))

    if (missingSavedPrices.length > 0) {
      await Promise.all(missingSavedPrices.slice(0, 80).map(card =>
        supabase
          .from('user_cards')
          .update({ market_price: card.market_price, inventory_price: null })
          .eq('user_id', uid)
          .eq('card_id', card.card_id)
          .is('market_price', null)
      ))

      setCards(prev => prev.map(card => {
        const backfilled = missingSavedPrices.find(item => item.card_id === card.card_id)
        return backfilled ? { ...card, market_price: backfilled.market_price, inventory_price: null } : card
      }))
    }
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

  const catalogDetailsForCard = (card: UserCard, candidates: any[]) => {
      const wanted = compactCardCode(card.card_id)
      const detail = candidates.find((candidate: any) => {
        const ids = [
          candidate.card_set_id,
          candidate.card_id,
          candidate.id
        ].map(compactCardCode)
        return ids.includes(wanted)
      })

      if (!detail) return null

      return {
        name: detail.card_name || detail.name || card.name,
        image_url: detail.card_image || detail.image_url || card.image_url,
        rarity: detail.rarity && detail.rarity !== 'Unknown' ? detail.rarity : card.rarity,
        card_color: detail.card_color && detail.card_color !== 'Unknown' ? detail.card_color : card.card_color,
        card_type: detail.card_type && detail.card_type !== 'Unknown' ? detail.card_type : card.card_type,
        card_cost: numberOrNull(detail.card_cost),
        card_power: numberOrNull(detail.card_power),
      } satisfies Partial<UserCard>
  }

  const fetchCatalogDetailsForCard = async (card: UserCard) => {
    try {
      const res = await fetch(`/api/cards/search?q=${encodeURIComponent(card.card_id)}`)
      const data = await res.json()
      if (!Array.isArray(data)) return null
      return catalogDetailsForCard(card, data)
    } catch {
      return null
    }
  }

  const needsDetailBackfill = (card: UserCard) =>
    !/^CM-\d+/i.test(card.card_id) && (
    !card.name ||
    card.name === 'Unknown' ||
    !card.image_url ||
    !card.rarity ||
    card.rarity === 'Unknown' ||
    !card.card_color ||
    card.card_color === 'Unknown' ||
    !card.card_type ||
    card.card_type === 'Unknown' ||
    card.card_cost == null ||
    card.card_power == null)

  const backfillMissingCardDetails = async (uid: string, cardsToBackfill: UserCard[]) => {
    const targets = cardsToBackfill.filter(needsDetailBackfill).slice(0, 120)
    if (targets.length === 0) return

    let candidates: any[] = []
    try {
      const response = await fetch('/api/cards/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: targets.map(card => card.card_id) }),
      })
      const data = await response.json()
      candidates = Array.isArray(data) ? data : []
    } catch {
      return
    }

    const updates = targets.map(card => {
      const detail = catalogDetailsForCard(card, candidates)
      if (!detail) return null

      return {
        ...card,
        ...detail,
        name: detail.name || card.name,
        image_url: detail.image_url || card.image_url,
        rarity: detail.rarity || card.rarity,
        card_color: detail.card_color || card.card_color,
        card_type: detail.card_type || card.card_type,
        card_cost: detail.card_cost ?? card.card_cost ?? null,
        card_power: detail.card_power ?? card.card_power ?? null,
      } as UserCard
    })

    const cleanUpdates = updates.filter((card): card is UserCard => Boolean(card))
    if (cleanUpdates.length === 0) return

    setCards(current => current.map(card => {
      const update = cleanUpdates.find(item =>
        (item.id && card.id === item.id) || (!item.id && card.card_id === item.card_id)
      )
      return update ? { ...card, ...update } : card
    }))

    await Promise.all(cleanUpdates.map(card => {
      const query = supabase
        .from('user_cards')
        .update({
          name: card.name,
          image_url: card.image_url,
          rarity: card.rarity,
          card_color: card.card_color,
          card_type: card.card_type,
          card_cost: card.card_cost,
          card_power: card.card_power,
        })
        .eq('user_id', uid)

      return card.id
        ? query.eq('id', card.id)
        : query.eq('card_id', card.card_id)
    }))
  }

  const openCollectionCard = (card: UserCard) => {
    const runId = ++detailRunRef.current
    setSelectedCard(card)
    void loadLivePrice({ card_id: card.card_id, name: card.name })
    if (card.card_cost != null && card.card_power != null && card.card_type && card.card_color && card.rarity) return

    void (async () => {
      const detail = await fetchCatalogDetailsForCard(card)
      if (!detail || runId !== detailRunRef.current) return

      const enriched = {
        ...card,
        ...detail,
        card_cost: detail.card_cost ?? card.card_cost ?? null,
        card_power: detail.card_power ?? card.card_power ?? null,
      }
      setSelectedCard(current => current?.card_id === card.card_id ? enriched : current)
      setCards(current => current.map(item => item.card_id === card.card_id ? { ...item, ...enriched } : item))

      if (userId) {
        await supabase
          .from('user_cards')
          .update({
            name: enriched.name,
            image_url: enriched.image_url,
            rarity: enriched.rarity,
            card_color: enriched.card_color,
            card_type: enriched.card_type,
            card_cost: enriched.card_cost,
            card_power: enriched.card_power,
          })
          .eq('user_id', userId)
          .eq('card_id', card.card_id)
      }
    })()
  }

  const openSoldCardDetail = (card: SoldCard) => {
    detailRunRef.current += 1
    setSoldOpen(false)
    setSelectedCard(card)
    void loadLivePrice({ card_id: card.card_id, name: card.name })
  }

  const loadSoldCards = async (uid = userId) => {
    if (!uid) return
    setSoldLoading(true)
    setSoldReady(true)

    const { data, error } = await supabase
      .from('sold_cards')
      .select('id, card_id, quantity, name, image_url, rarity, card_color, card_type, card_cost, card_power, market_price, inventory_price, sale_price, sold_at')
      .eq('user_id', uid)
      .order('sold_at', { ascending: false })

    if (error) {
      setSoldReady(false)
      setSoldCards([])
      setSoldLoading(false)
      return
    }

    const mappedCards = (data || []).map(card => ({
      ...card,
      rarity: card.rarity === 'Unknown' ? null : card.rarity,
      card_color: card.card_color === 'Unknown' ? null : card.card_color,
      market_price: card.market_price == null ? null : Number(card.market_price),
      inventory_price: card.inventory_price == null ? null : Number(card.inventory_price),
      sale_price: Number(card.sale_price || 0)
    }))
    setSoldCards(mappedCards)
    setSoldLoading(false)

    const prices = await fetchLivePricesForCards(mappedCards)
    const liveMap = Object.fromEntries(
      mappedCards.map(card => [card.id, getLivePriceNumber(prices[card.card_id])] as const)
    )
    setSoldLivePrices(liveMap)
  }

  const openSoldCards = () => {
    setSoldOpen(true)
    void loadSoldCards()
  }

  const startSale = (card: UserCard) => {
    setSellingCard(card)
    setSaleQuantity(1)
    setSalePrice('')
    setSaleMessage('')
  }

  const confirmSale = async () => {
    if (!userId || !sellingCard || sellingBusy) return

    const parsedPrice = Number(salePrice.replace(',', '.'))
    const quantity = Math.max(1, Math.min(Number(saleQuantity || 1), sellingCard.quantity))

    if (!Number.isFinite(parsedPrice) || parsedPrice < 0) {
      setSaleMessage('Inserisci un prezzo valido.')
      return
    }

    setSellingBusy(true)
    setSaleMessage('')

    const { error: insertError } = await supabase
      .from('sold_cards')
      .insert({
        user_id: userId,
        card_id: sellingCard.card_id,
        name: sellingCard.name,
        image_url: sellingCard.image_url,
        rarity: sellingCard.rarity,
        card_color: sellingCard.card_color ?? null,
        card_type: sellingCard.card_type ?? null,
        card_cost: sellingCard.card_cost ?? null,
        card_power: sellingCard.card_power ?? null,
        market_price: sellingCard.market_price ?? null,
        inventory_price: sellingCard.inventory_price ?? null,
        quantity,
        sale_price: parsedPrice
      })

    if (insertError) {
      setSoldReady(false)
      setSaleMessage('Non riesco a salvare la vendita in questo momento.')
      setSellingBusy(false)
      return
    }

    const remainingQuantity = sellingCard.quantity - quantity
    if (remainingQuantity > 0) {
      let updateQuery = supabase
        .from('user_cards')
        .update({ quantity: remainingQuantity })
        .eq('user_id', userId)
      updateQuery = sellingCard.id
        ? updateQuery.eq('id', sellingCard.id)
        : updateQuery.eq('card_id', sellingCard.card_id)
      await updateQuery
    } else {
      let deleteQuery = supabase
        .from('user_cards')
        .delete()
        .eq('user_id', userId)
      deleteQuery = sellingCard.id
        ? deleteQuery.eq('id', sellingCard.id)
        : deleteQuery.eq('card_id', sellingCard.card_id)
      await deleteQuery
    }

    setSellingBusy(false)
    setSellingCard(null)
    setSelectedCard(null)
    setLivePrice(null)
    await loadCards(userId)
    if (soldOpen) await loadSoldCards(userId)
  }

  const restoreSoldCard = async (card: SoldCard) => {
    if (!userId || restoringSoldId) return

    setRestoringSoldId(card.id)

    const { data: existing } = await supabase
      .from('user_cards')
      .select('id, quantity, market_price, inventory_price')
      .eq('user_id', userId)
      .eq('card_id', card.card_id)
      .maybeSingle()

    if (existing) {
      await supabase
        .from('user_cards')
        .update({
          quantity: Number(existing.quantity || 0) + Number(card.quantity || 1),
          market_price: existing.market_price ?? card.market_price ?? null,
          inventory_price: existing.inventory_price ?? card.inventory_price ?? null
        })
        .eq('id', existing.id)
    } else {
      await supabase
        .from('user_cards')
        .insert({
          user_id: userId,
          card_id: card.card_id,
          quantity: card.quantity,
          name: card.name,
          image_url: card.image_url,
          rarity: card.rarity,
          card_color: card.card_color ?? null,
          card_type: card.card_type ?? null,
          card_cost: card.card_cost ?? null,
          card_power: card.card_power ?? null,
          market_price: card.market_price ?? null,
          inventory_price: card.inventory_price ?? null
        })
    }

    await supabase
      .from('sold_cards')
      .delete()
      .eq('id', card.id)
      .eq('user_id', userId)

    await Promise.all([
      loadCards(userId),
      loadSoldCards(userId)
    ])
    setRestoringSoldId(null)
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
      .select('id, quantity, market_price, inventory_price')
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
      const shouldBackfillPrice = existing.market_price == null && existing.inventory_price == null && currentCardLivePrice != null
      await supabase
        .from('user_cards')
        .update({
          quantity: existing.quantity + 1,
          ...payload,
          market_price: shouldBackfillPrice ? currentCardLivePrice : existing.market_price ?? null,
          inventory_price: shouldBackfillPrice ? null : existing.inventory_price ?? null,
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
  const removeCard = async (cardId: string, qty: number, rowId?: string | null) => {
    if (!userId) return

    console.log('DELETE CLICK:', cardId, qty)

    if (qty > 1) {
      let query = supabase
        .from('user_cards')
        .update({ quantity: qty - 1 })
        .eq('user_id', userId)
      query = rowId ? query.eq('id', rowId) : query.eq('card_id', cardId)
      const { error } = await query

      if (error) {
        console.error('UPDATE ERROR:', error)
        return
      }
    } else {
      let query = supabase
        .from('user_cards')
        .delete()
        .eq('user_id', userId)
      query = rowId ? query.eq('id', rowId) : query.eq('card_id', cardId)
      const { error } = await query

      if (error) {
        console.error('DELETE ERROR:', error)
        return
      }
    }

    await loadCards(userId)
  }

  const searchTermNormalized = searchTerm.trim().toLowerCase()
  const availableColors = Array.from(new Set(cards.map(card => card.card_color).filter((value): value is string => Boolean(value && value !== 'Unknown'))))
  const availableRarities = Array.from(new Set(cards.map(card => getRarityLabel(card)).filter((value): value is string => Boolean(value))))

  const filteredCards = cards.filter((item) => {
    const matchesSearch =
      !searchTermNormalized ||
      item.name?.toLowerCase().includes(searchTermNormalized) ||
      item.card_id.toLowerCase().includes(searchTermNormalized)

    const matchesColor =
      filterColor === 'all' ||
      (item.card_color || '').toLowerCase() === filterColor.toLowerCase()

    const matchesRarity =
      filterRarity === 'all' ||
      rarityFilterValue(item) === filterRarity

    const cost = item.card_cost ?? -1
    let matchesCost = true
    if (filterCost === '0-2') matchesCost = cost >= 0 && cost <= 2
    if (filterCost === '3-5') matchesCost = cost >= 3 && cost <= 5
    if (filterCost === '6+') matchesCost = cost >= 6

    return matchesSearch && matchesColor && matchesRarity && matchesCost
  })
  const sortedCollectionCards = [...filteredCards].sort((a, b) => {
    const aSet = parseCollectionSet(a.card_id)
    const bSet = parseCollectionSet(b.card_id)

    if (aSet.releaseOrder !== bSet.releaseOrder) return bSet.releaseOrder - aSet.releaseOrder
    if (aSet.setCode !== bSet.setCode) return bSet.setCode.localeCompare(aSet.setCode)
    if (aSet.number !== bSet.number) return aSet.number - bSet.number
    return a.card_id.localeCompare(b.card_id)
  })
  const collectionGroups = sortedCollectionCards.reduce<Array<{ setCode: string; cards: UserCard[] }>>((groups, card) => {
    const setCode = parseCollectionSet(card.card_id).setCode
    const last = groups[groups.length - 1]
    if (last?.setCode === setCode) {
      last.cards.push(card)
    } else {
      groups.push({ setCode, cards: [card] })
    }
    return groups
  }, [])

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
  const topSavedCardPrice = topSavedCard ? getAnalyticsPrice(topSavedCard) : null
  const topSavedCardTotal = topSavedCard && topSavedCardPrice != null
    ? topSavedCardPrice * topSavedCard.quantity
    : null
  const topExpensiveCards = [...cards]
    .filter(card => getAnalyticsPrice(card) != null)
    .sort((a, b) => (getAnalyticsPrice(b) || 0) - (getAnalyticsPrice(a) || 0))
    .slice(0, 5)
  const duplicateCards = cards.filter(card => card.quantity > 1)
  const groupByQuantity = (field: 'rarity' | 'card_color') => Object.entries(
    cards.reduce<Record<string, number>>((acc, card) => {
      const key = field === 'rarity' ? getRarityLabel(card) || '' : String(card[field] || '')
      if (!key || key === 'Unknown') return acc
      acc[key] = (acc[key] || 0) + card.quantity
      return acc
    }, {})
  ).sort((a, b) => b[1] - a[1])
  const rarityStats = groupByQuantity('rarity')
  const colorCounts = cards.reduce<Record<string, number>>((acc, card) => {
    for (const color of normalizeCardColors(card.card_color)) {
      acc[color] = (acc[color] || 0) + card.quantity
    }
    return acc
  }, {})
  const colorStats = knownCardColors.map(color => [color, colorCounts[color] || 0] as const)
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
  const soldTotalValue = soldCards.reduce((sum, card) => sum + Number(card.sale_price || 0) * Number(card.quantity || 0), 0)
  const soldTotalQuantity = soldCards.reduce((sum, card) => sum + Number(card.quantity || 0), 0)

  return (
    <div className="h-dvh overflow-y-auto text-white onepiece-wave-bg onepiece-clouds">
      <Sidebar activePage="collezione" />
      <div className="w-full min-h-screen">

        <Topbar />

        {/* CONTENT */}
        <div className="h-[calc(100dvh-56px)] overflow-y-auto px-3 pb-36 pt-20 sm:px-6">

          <div className="relative space-y-3">
            <DailyRewardBanner />
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
                    onClick={openSoldCards}
                    className="flex h-11 items-center gap-2 rounded-2xl border border-slate-600 bg-slate-800 px-3 text-sm font-black text-slate-200"
                    aria-label="Carte vendute"
                  >
                    <Archive size={17} />
                    <span className="hidden sm:inline">Vendute</span>
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

            <PushNotificationPrompt hideWhenGranted />

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
                      <option key={rarity} value={rarityFilterValue(rarity)}>{rarity}</option>
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

            {!loadingCards && filteredCards.length === 0 && (
              <div className="rounded-3xl border border-slate-700 bg-slate-900/80 p-4 text-sm text-gray-300">
                Nessuna carta trovata con i filtri selezionati.
              </div>
            )}
          </div>

          {loadingCards && (
            <p className="text-gray-400 text-sm">Caricamento collezione...</p>
          )}

          <div className="mt-4 space-y-5">
            {topSavedCard && (
              <section>
                <div className="mb-2 flex items-center gap-3">
                  <p className="shrink-0 text-[10px] font-black uppercase tracking-[0.24em] text-cyan-100">Top carta</p>
                  <div className="h-px flex-1 bg-gradient-to-r from-cyan-300/30 to-transparent" />
                  <span className="text-[10px] font-bold text-slate-500">Valore piu alto</span>
                </div>

                <div className="grid grid-cols-[minmax(94px,0.42fr)_minmax(0,1fr)] gap-2 rounded-lg border border-cyan-300/25 bg-slate-900 p-1.5 shadow-[0_18px_45px_rgba(8,47,73,0.22)] sm:max-w-xl sm:grid-cols-[130px_minmax(0,1fr)] sm:gap-3 sm:p-2">
                  <button onClick={() => openCollectionCard(topSavedCard)} className="block w-full text-left">
                    <CardImage
                      src={topSavedCard.image_url}
                      cardId={topSavedCard.card_id}
                      alt={topSavedCard.name || topSavedCard.card_id}
                      className="aspect-[3/4] overflow-hidden rounded-md bg-black"
                      imgClassName="h-full w-full object-contain"
                      fallbackClassName="flex h-full w-full items-center justify-center text-[10px] text-gray-400"
                    />
                  </button>

                  <div className="flex min-w-0 flex-col justify-between py-1 pr-1">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-black text-white sm:text-base">{topSavedCard.name || topSavedCard.card_id}</p>
                      <p className="mt-0.5 text-[10px] font-bold uppercase tracking-[0.18em] text-slate-400">{displayCardId(topSavedCard.card_id)}</p>
                      <p className="mt-1 text-[10px] text-slate-500">{getRarityLabel(topSavedCard) || '-'}</p>
                    </div>

                    <div className="mt-2 grid grid-cols-3 gap-1.5">
                      {[
                        ['Prezzo', formatPrice(topSavedCardPrice)],
                        ['Copie', `x${topSavedCard.quantity}`],
                        ['Totale', formatPrice(topSavedCardTotal)],
                      ].map(([label, value]) => (
                        <div key={label} className="rounded-xl border border-white/10 bg-white/[0.055] px-2 py-1.5">
                          <p className="text-[8px] font-black uppercase tracking-[0.16em] text-slate-500">{label}</p>
                          <p className="mt-0.5 truncate text-[10px] font-black text-cyan-100 sm:text-xs">{value}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </section>
            )}

            {collectionGroups.map(group => (
              <section key={group.setCode}>
                <div className="mb-2 flex items-center gap-3">
                  <p className="shrink-0 text-[10px] font-black uppercase tracking-[0.24em] text-cyan-100">{setDisplayName(group.setCode)}</p>
                  <div className="h-px flex-1 bg-gradient-to-r from-cyan-300/30 to-transparent" />
                  <span className="text-[10px] font-bold text-slate-500">{group.cards.reduce((sum, card) => sum + card.quantity, 0)} carte</span>
                </div>
                <div className="grid grid-cols-3 gap-1.5 sm:grid-cols-3 sm:gap-2 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-7 2xl:grid-cols-8">
                  {group.cards.map((item) => (
              <div
                key={item.card_id}
                className="relative bg-slate-900 rounded-lg p-1.5 sm:p-2 border border-slate-700 hover:border-amber-400/60 transition onepiece-card-hover onepiece-border-glow"
              >

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
                <p className="text-[8px] sm:text-[10px] text-gray-400">{getRarityLabel(item) || '?'}</p>
                <p className="text-[7px] sm:text-[9px] text-gray-500 truncate">{displayCardId(item.card_id)}</p>
                <p className="text-[10px] sm:text-xs text-amber-300 mt-1">x{item.quantity}</p>

              </div>
                  ))}
                </div>
              </section>
            ))}

          </div>

        </div>

      </div>

      {/* ADD BUTTON */}
      <div className="fixed bottom-24 left-1/2 z-50 -translate-x-1/2 pointer-events-none sm:bottom-28">
        <button
          onClick={() => {
            setCatalogOpen(true)
            setCatalogMessage('')
          }}
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
        closeCatalog()
      }
    }}
  >
    <div
      className="flex h-[88dvh] w-[calc(100vw-1rem)] max-w-6xl flex-col overflow-hidden rounded-[1.75rem] border border-slate-700 bg-slate-950/96 shadow-2xl shadow-black/50 sm:h-[84vh] sm:w-full"
      onClick={(event) => event.stopPropagation()}
    >
      <div className="border-b border-slate-800 p-3">
        <div className="mb-3 flex items-center justify-between gap-3 rounded-2xl border border-amber-300/20 bg-amber-300/[0.07] px-3 py-2.5">
          <div className="min-w-0">
            <p className="text-sm font-black text-white">Carta mancante?</p>
            <p className="truncate text-xs text-slate-400">Segnalala e la aggiungeremo al catalogo.</p>
          </div>
          <button
            type="button"
            onClick={() => {
              setMissingReportOpen(current => !current)
              setCatalogMessage('')
            }}
            className="shrink-0 rounded-xl bg-amber-300 px-3 py-2 text-xs font-black text-slate-950 transition active:scale-95"
          >
            {missingReportOpen ? 'Chiudi' : 'Segnalala'}
          </button>
        </div>

        {missingReportOpen && (
          <div className="mb-3 grid gap-2 rounded-2xl border border-amber-300/20 bg-slate-900/90 p-3 sm:grid-cols-2">
            <input
              value={missingCardCode}
              onChange={event => setMissingCardCode(event.target.value.toUpperCase())}
              placeholder="Codice, es. OP16-056"
              className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2.5 text-sm text-white outline-none focus:border-amber-300"
            />
            <input
              value={missingCardVariant}
              onChange={event => setMissingCardVariant(event.target.value)}
              placeholder="Tipo e variante, es. SR parallel winner"
              className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2.5 text-sm text-white outline-none focus:border-amber-300"
            />
            <textarea
              value={missingCardDescription}
              onChange={event => setMissingCardDescription(event.target.value)}
              placeholder="Descrizione (opzionale)"
              rows={2}
              className="w-full resize-none rounded-xl border border-slate-700 bg-slate-950 px-3 py-2.5 text-sm text-white outline-none focus:border-amber-300 sm:col-span-2"
            />
            <button
              type="button"
              onClick={submitMissingCardReport}
              disabled={missingReportSubmitting}
              className="rounded-xl bg-amber-300 px-3 py-2.5 text-sm font-black text-slate-950 transition active:scale-[0.98] disabled:opacity-60 sm:col-span-2"
            >
              {missingReportSubmitting ? 'Invio...' : 'Invia segnalazione'}
            </button>
          </div>
        )}

        <div className="flex items-center gap-2">
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
          onClick={closeCatalog}
          className="flex h-11 w-11 items-center justify-center rounded-2xl border border-slate-700 bg-slate-800 text-slate-200"
          aria-label="Chiudi catalogo"
        >
          <X size={18} />
        </button>
        </div>
      </div>

      {catalogMessage && (
        <div className="border-b border-emerald-500/20 bg-emerald-500/10 px-4 py-2 text-sm font-semibold text-emerald-200">
          {catalogMessage}
        </div>
      )}

      <div className="grid min-h-0 flex-1 gap-0 lg:grid-cols-[1fr_340px]">
        <div className="min-h-0 overflow-y-auto p-3">
          {catalogSelectedCard && (
            <div className="mb-3 grid grid-cols-[112px_minmax(0,1fr)] gap-3 rounded-3xl border border-cyan-300/20 bg-cyan-300/10 p-3 lg:hidden">
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
                  className="mt-2 grid h-11 w-11 place-items-center rounded-full border border-cyan-100/60 bg-cyan-300 text-slate-950 shadow-lg shadow-cyan-950/30 transition hover:scale-105 active:scale-90 disabled:opacity-60"
                  aria-label={`Aggiungi ${catalogSelectedCard.name} alla collezione`}
                  title="Aggiungi alla collezione"
                >
                  {catalogAddingId === catalogSelectedCard.id
                    ? <RotateCcw size={18} className="animate-spin" />
                    : <Plus size={22} strokeWidth={3} />}
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
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
              {catalogCards.map((card) => (
                <div key={card.id} className="rounded-2xl border border-slate-800 bg-slate-900/86 p-2.5">
                  <button
                    onClick={() => openCatalogCard(card)}
                    className="block w-full text-left"
                  >
                    <CardImage
                      src={card.image_url}
                      cardId={card.id}
                      alt={card.name}
                      className="aspect-[5/7] overflow-hidden rounded-xl bg-slate-950"
                    />
                    <p className="mt-2 line-clamp-2 text-[13px] font-bold leading-tight text-white">{card.name}</p>
                    <p className="mt-1 truncate text-[10px] text-slate-500">{card.id}</p>
                  </button>
                  <button
                    onClick={() => addCatalogCard(card)}
                    disabled={catalogAddingId === card.id}
                    className="mx-auto mt-2 grid h-10 w-10 place-items-center rounded-full border border-cyan-100/60 bg-cyan-300 text-slate-950 shadow-md shadow-cyan-950/30 transition hover:scale-105 active:scale-90 disabled:opacity-60"
                    aria-label={`Aggiungi ${card.name} alla collezione`}
                    title="Aggiungi alla collezione"
                  >
                    {catalogAddingId === card.id
                      ? <RotateCcw size={17} className="animate-spin" />
                      : <Plus size={21} strokeWidth={3} />}
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
                  <p className="text-[10px] uppercase tracking-[0.25em] text-slate-400">Prezzo Medio</p>
                  <p className="mt-1 text-2xl font-black text-cyan-200">{livePriceLoading ? '...' : formatPrice(livePrice)}</p>
                </div>
              </div>
              <button
                onClick={() => addCatalogCard(catalogSelectedCard)}
                disabled={catalogAddingId === catalogSelectedCard.id}
                className="mx-auto mt-3 grid h-14 w-14 place-items-center rounded-full border border-cyan-100/60 bg-cyan-300 text-slate-950 shadow-lg shadow-cyan-950/30 transition hover:scale-105 active:scale-90 disabled:opacity-60"
                aria-label={`Aggiungi ${catalogSelectedCard.name} alla collezione`}
                title="Aggiungi alla collezione"
              >
                {catalogAddingId === catalogSelectedCard.id
                  ? <RotateCcw size={20} className="animate-spin" />
                  : <Plus size={26} strokeWidth={3} />}
              </button>
            </div>
          ) : (
            <div className="flex h-full items-center justify-center rounded-3xl border border-dashed border-slate-700 p-5 text-center text-sm text-slate-400">
              Tocca una carta per vedere prezzo medio e dettagli.
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
        <h3 className="text-lg font-black text-white">Statistiche collezione</h3>
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
              <p className="text-sm font-black text-white">Carte piu costose</p>
            </div>
            {topExpensiveCards.length > 0 ? (
              <div className="mt-3 space-y-2">
                {topExpensiveCards.map((card, index) => (
                  <button
                    key={card.card_id}
                    onClick={() => openCollectionCard(card)}
                    className="grid w-full grid-cols-[42px_minmax(0,1fr)_auto] items-center gap-3 rounded-2xl border border-slate-700 bg-slate-950/65 p-2 text-left transition hover:border-cyan-300/40 active:scale-[0.99]"
                  >
                    <div className="relative">
                      <CardImage
                        src={card.image_url}
                        cardId={card.card_id}
                        alt={card.name || 'Carta'}
                        className="aspect-[3/4] overflow-hidden rounded-xl bg-slate-950"
                      />
                      <span className="absolute -left-1 -top-1 grid h-5 w-5 place-items-center rounded-full bg-cyan-300 text-[10px] font-black text-slate-950">
                        {index + 1}
                      </span>
                    </div>
                    <div className="min-w-0">
                      <p className="truncate text-sm font-bold text-white">{card.name || card.card_id}</p>
                      <p className="mt-0.5 text-[10px] uppercase tracking-[0.18em] text-slate-500">{displayCardId(card.card_id)}</p>
                    </div>
                    <div className="text-right">
                      <p className="text-sm font-black text-cyan-200">{formatPrice(getAnalyticsPrice(card))}</p>
                      <p className="mt-0.5 text-[10px] text-slate-500">x{card.quantity}</p>
                    </div>
                  </button>
                ))}
              </div>
            ) : (
              <p className="mt-3 text-sm text-slate-400">Nessun prezzo salvato.</p>
            )}
          </div>

          <div className="rounded-3xl border border-slate-700 bg-slate-900/82 p-3">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <TrendingUp className="text-emerald-200" size={18} />
                <p className="text-sm font-black text-white">Prezzo Medio</p>
              </div>
              <button
                onClick={openAnalytics}
                className="rounded-xl border border-cyan-300/30 bg-cyan-300/10 px-2 py-1 text-[10px] font-bold text-cyan-100"
              >
                Aggiorna
              </button>
            </div>
            <p className="mt-2 text-xs text-slate-400">
              {analyticsLoading ? 'Aggiorno i prezzi...' : `Prezzi aggiornati: ${analyticsCandidates.length} carte principali`}
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
{soldOpen && (
  <div
    className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 p-2 backdrop-blur-md sm:items-center sm:p-4"
    onClick={(event) => {
      if (event.target === event.currentTarget) {
        setSoldOpen(false)
      }
    }}
  >
    <div
      className="flex max-h-[88dvh] w-full max-w-3xl flex-col overflow-hidden rounded-[1.75rem] border border-slate-700 bg-slate-950/96 shadow-2xl shadow-black/50"
      onClick={(event) => event.stopPropagation()}
    >
      <div className="flex items-center justify-between gap-3 border-b border-slate-800 p-3">
        <div>
          <h3 className="text-lg font-black text-white">Carte vendute</h3>
          <p className="text-xs text-slate-400">{soldTotalQuantity} carte - {formatPrice(soldTotalValue)}</p>
        </div>
        <button
          onClick={() => setSoldOpen(false)}
          className="flex h-10 w-10 items-center justify-center rounded-2xl border border-slate-700 bg-slate-800 text-slate-200"
          aria-label="Chiudi vendute"
        >
          <X size={18} />
        </button>
      </div>

      <div className="min-h-0 overflow-y-auto p-3">
        {!soldReady ? (
          <div className="rounded-2xl border border-amber-300/25 bg-amber-300/10 p-3 text-sm text-amber-100">
            Carte vendute temporaneamente non disponibili.
          </div>
        ) : soldLoading ? (
          <p className="rounded-2xl border border-slate-700 p-4 text-sm text-slate-400">Carico vendute...</p>
        ) : soldCards.length === 0 ? (
          <div className="rounded-3xl border border-dashed border-slate-700 bg-slate-900/70 p-5 text-center text-sm text-slate-400">
            Nessuna carta venduta registrata.
          </div>
        ) : (
          <div className="space-y-2">
            {soldCards.map(card => {
              const currentPrice = soldLivePrices[card.id] ?? card.market_price ?? card.inventory_price ?? null
              const delta = currentPrice == null ? null : card.sale_price - currentPrice

              return (
                <div key={card.id} className="grid grid-cols-[54px_minmax(0,1fr)_38px] gap-3 rounded-2xl border border-slate-700 bg-slate-900/82 p-2 sm:grid-cols-[60px_minmax(0,1fr)_minmax(150px,auto)_38px]">
                  <button
                    type="button"
                    onClick={() => openSoldCardDetail(card)}
                    className="block text-left transition active:scale-[0.98]"
                    aria-label={`Apri ${card.name || card.card_id}`}
                  >
                    <CardImage
                      src={card.image_url}
                      cardId={card.card_id}
                      alt={card.name || card.card_id}
                      className="aspect-[3/4] overflow-hidden rounded-xl bg-slate-950"
                    />
                  </button>
                  <button
                    type="button"
                    onClick={() => openSoldCardDetail(card)}
                    className="min-w-0 text-left transition active:scale-[0.99]"
                  >
                    <p className="truncate text-sm font-black text-white">{card.name || card.card_id}</p>
                    <p className="mt-0.5 text-[10px] uppercase tracking-[0.16em] text-slate-500">{displayCardId(card.card_id)}</p>
                    <p className="mt-1 text-[11px] text-slate-400">
                      Venduta il {new Date(card.sold_at).toLocaleDateString('it-IT')} - x{card.quantity}
                    </p>
                  </button>
                  <div className="col-span-3 grid grid-cols-3 gap-1.5 text-right sm:col-span-1">
                    <div className="rounded-xl border border-white/10 bg-white/[0.045] px-2 py-1.5">
                      <p className="text-[8px] font-black uppercase tracking-[0.14em] text-slate-500">Venduta</p>
                      <p className="mt-0.5 text-xs font-black text-emerald-200">{formatPrice(card.sale_price)}</p>
                    </div>
                    <div className="rounded-xl border border-white/10 bg-white/[0.045] px-2 py-1.5">
                      <p className="text-[8px] font-black uppercase tracking-[0.14em] text-slate-500">Ora</p>
                      <p className="mt-0.5 text-xs font-black text-cyan-100">{formatPrice(currentPrice)}</p>
                    </div>
                    <div className={`rounded-xl border px-2 py-1.5 ${
                      delta == null
                        ? 'border-white/10 bg-white/[0.045]'
                        : delta >= 0
                        ? 'border-emerald-300/25 bg-emerald-300/10'
                        : 'border-rose-300/25 bg-rose-300/10'
                    }`}>
                      <p className="text-[8px] font-black uppercase tracking-[0.14em] text-slate-500">Diff.</p>
                      <p className={`mt-0.5 text-xs font-black ${
                        delta == null ? 'text-slate-300' : delta >= 0 ? 'text-emerald-200' : 'text-rose-200'
                      }`}>
                        {delta == null ? '-' : formatDelta(delta)}
                      </p>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => restoreSoldCard(card)}
                    disabled={restoringSoldId === card.id}
                    className="grid h-9 w-9 place-items-center self-center rounded-xl border border-cyan-300/25 bg-cyan-300/10 text-cyan-100 transition hover:bg-cyan-300/18 active:scale-95 disabled:opacity-50"
                    title="Rimetti in collezione"
                    aria-label="Rimetti in collezione"
                  >
                    <RotateCcw size={15} className={restoringSoldId === card.id ? 'animate-spin' : ''} />
                  </button>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  </div>
)}
{sellingCard && (
  <div
    className="fixed inset-0 z-[60] flex items-end justify-center bg-black/75 p-2 backdrop-blur-md sm:items-center sm:p-4"
    onClick={(event) => {
      if (event.target === event.currentTarget && !sellingBusy) {
        setSellingCard(null)
      }
    }}
  >
    <div
      className="w-full max-w-md rounded-[1.75rem] border border-slate-700 bg-slate-950/97 p-4 shadow-2xl shadow-black/50"
      onClick={(event) => event.stopPropagation()}
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-lg font-black text-white">Segna come venduta</h3>
          <p className="mt-1 text-sm text-slate-400">{sellingCard.name || sellingCard.card_id}</p>
        </div>
        <button
          onClick={() => setSellingCard(null)}
          disabled={sellingBusy}
          className="grid h-10 w-10 place-items-center rounded-2xl border border-slate-700 bg-slate-800 text-slate-200 disabled:opacity-50"
          aria-label="Chiudi vendita"
        >
          <X size={18} />
        </button>
      </div>

      <div className="mt-4 grid grid-cols-[88px_minmax(0,1fr)] gap-3">
        <CardImage
          src={sellingCard.image_url}
          cardId={sellingCard.card_id}
          alt={sellingCard.name || sellingCard.card_id}
          className="aspect-[3/4] overflow-hidden rounded-2xl bg-slate-900"
        />
        <div className="space-y-3">
          <label className="block">
            <span className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-500">Prezzo vendita</span>
            <input
              value={salePrice}
              onChange={(event) => setSalePrice(event.target.value)}
              inputMode="decimal"
              placeholder="Es. 12,50"
              className="mt-1 w-full rounded-2xl border border-slate-700 bg-slate-900 px-3 py-3 text-sm text-white outline-none focus:border-emerald-300"
            />
          </label>
          <label className="block">
            <span className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-500">Quantità</span>
            <input
              type="number"
              min={1}
              max={sellingCard.quantity}
              value={saleQuantity}
              onChange={(event) => setSaleQuantity(Math.max(1, Math.min(Number(event.target.value || 1), sellingCard.quantity)))}
              className="mt-1 w-full rounded-2xl border border-slate-700 bg-slate-900 px-3 py-3 text-sm text-white outline-none focus:border-emerald-300"
            />
          </label>
        </div>
      </div>

      {saleMessage ? (
        <p className="mt-3 rounded-2xl border border-amber-300/25 bg-amber-300/10 px-3 py-2 text-sm text-amber-100">{saleMessage}</p>
      ) : null}

      <div className="mt-4 grid grid-cols-2 gap-2">
        <button
          onClick={() => setSellingCard(null)}
          disabled={sellingBusy}
          className="rounded-2xl border border-slate-700 bg-slate-900 px-4 py-3 text-sm font-bold text-slate-200 disabled:opacity-50"
        >
          Annulla
        </button>
        <button
          onClick={confirmSale}
          disabled={sellingBusy}
          className="rounded-2xl bg-emerald-300 px-4 py-3 text-sm font-black text-slate-950 disabled:opacity-60"
        >
          {sellingBusy ? 'Salvo...' : 'Conferma'}
        </button>
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
      className="w-full max-w-sm sm:max-w-2xl lg:max-w-5xl bg-slate-900 rounded-xl border border-slate-700 p-3 sm:p-5 lg:p-6 relative max-h-[90vh] overflow-y-auto"
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

      <div className="grid gap-4 lg:grid-cols-[360px_1fr] xl:grid-cols-[420px_1fr] lg:items-start">
        <div className="space-y-3">
          <CardImage
            src={selectedCard.image_url}
            cardId={selectedCard.card_id}
            alt={selectedCard.name || 'Carta'}
            className="aspect-[3/4] overflow-hidden rounded-3xl border border-slate-700 bg-slate-800 p-3 lg:max-h-[70vh]"
            imgClassName="h-full w-full object-contain"
          />
        </div>

        <div className="space-y-4">
          {selectedCard.sold_at ? (
            <div className="grid grid-cols-2 gap-2">
              <div className="rounded-2xl border border-emerald-300/25 bg-emerald-300/10 p-3">
                <p className="text-[10px] uppercase tracking-[0.2em] text-slate-500">Venduta a</p>
                <p className="mt-1 text-xl font-black text-emerald-200">{formatPrice(selectedCard.sale_price ?? null)}</p>
              </div>
              <div className="rounded-2xl border border-white/10 bg-white/[0.05] p-3">
                <p className="text-[10px] uppercase tracking-[0.2em] text-slate-500">Data vendita</p>
                <p className="mt-1 text-sm font-black text-white">{new Date(selectedCard.sold_at).toLocaleDateString('it-IT')}</p>
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-2">
              <button
                onClick={async () => {
                  await removeCard(selectedCard.card_id, selectedCard.quantity, selectedCard.id)
                  setSelectedCard(null)
                  setLivePrice(null)
                }}
                className="flex items-center justify-center gap-2 rounded-2xl border border-rose-300/30 bg-rose-400/10 px-4 py-3 text-sm font-black text-rose-100 transition hover:bg-rose-400/16 active:scale-[0.98]"
              >
                <Trash2 size={16} />
                Elimina
              </button>
              <button
                onClick={() => startSale(selectedCard)}
                className="rounded-2xl border border-emerald-300/35 bg-emerald-300/12 px-4 py-3 text-sm font-black text-emerald-100 transition hover:bg-emerald-300/18 active:scale-[0.98]"
              >
                Dichiara carta venduta
              </button>
            </div>
          )}
          <div>
            <h2 className="text-lg sm:text-xl font-bold text-amber-300 mb-2">
              {selectedCard.name || 'Carta sconosciuta'}
            </h2>
            <p className="text-xs uppercase tracking-[0.25em] text-gray-400 mb-3">
              {displayCardId(selectedCard.card_id)}
            </p>
            <div className="mb-3 grid gap-2 sm:grid-cols-3 lg:gap-3">
              <div className="rounded-2xl border border-cyan-300/20 bg-cyan-300/10 p-3">
                <p className="text-[10px] uppercase tracking-[0.2em] text-gray-500">Prezzo Medio</p>
                <p className="mt-1 text-xl font-black text-cyan-200 lg:text-2xl">{livePriceLoading ? '...' : formatPrice(livePrice)}</p>
              </div>
              <div className="rounded-2xl border border-white/10 bg-white/[0.05] p-3">
                <p className="text-[10px] uppercase tracking-[0.2em] text-gray-500">Aggiunta</p>
                <p className="mt-1 text-xl font-black text-white lg:text-2xl">{formatPrice(selectedSavedPrice)}</p>
              </div>
              <div className={`rounded-2xl border p-3 ${
                selectedPriceDelta == null
                  ? 'border-white/10 bg-white/[0.05]'
                  : selectedPriceDelta >= 0
                  ? 'border-emerald-400/25 bg-emerald-400/10'
                  : 'border-rose-400/25 bg-rose-400/10'
              }`}>
                <p className="text-[10px] uppercase tracking-[0.2em] text-gray-500">Differenza</p>
                <p className={`mt-1 text-xl font-black lg:text-2xl ${
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

          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:gap-3">
            {[
              ['Rarita', getRarityLabel(selectedCard) || '-'],
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

          <CardErrorReport
            cardId={selectedCard.card_id}
            cardName={selectedCard.name || 'Carta sconosciuta'}
            pagePath="/dashboard"
          />

        </div>
      </div>

    </div>

  </div>
)}
    </div>
  )
}
