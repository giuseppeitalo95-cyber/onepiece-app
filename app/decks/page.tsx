'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Crown, Eye, LibraryBig, Minus, Plus, Save, Search, Trash2, Trophy, X } from 'lucide-react'
import Sidebar from '@/app/components/Sidebar'
import Topbar from '@/app/components/Topbar'
import CardImage from '@/app/components/CardImage'
import { supabase } from '@/lib/supabase'

type DeckCard = {
  card_id: string
  name: string | null
  image_url: string | null
  rarity: string | null
  card_color?: string | null
  card_type?: string | null
  card_cost?: number | null
  card_power?: number | null
  market_price?: number | null
  inventory_price?: number | null
  quantity: number
}

type SavedDeck = {
  id: string
  name: string
  leader: DeckCard | null
  cards: DeckCard[]
  updatedAt: string
  player?: string
  placement?: string
  source?: string
  sourceUrl?: string
  sourceTotal?: string
}

type SearchCardResponse = {
  card_set_id?: string | number | null
  card_id?: string | number | null
  id?: string | number | null
  card_name?: string | null
  name?: string | null
  card_image?: string | null
  image_url?: string | null
  rarity?: string | null
  card_color?: string | null
  card_type?: string | null
  card_cost?: number | string | null
  card_power?: number | string | null
  market_price?: number | string | null
  inventory_price?: number | string | null
}

type DbDeckRow = {
  id: string
  user_id: string
  name: string
  leader: DeckCard | null
  cards: DeckCard[] | null
  source?: string | null
  source_url?: string | null
  player?: string | null
  placement?: string | null
  meta_total?: string | null
  updated_at?: string | null
}

type LivePriceResult = {
  marketPrice?: number | null
  midPrice?: number | null
  lowPrice?: number | null
  currency?: string | null
  originalCurrency?: string | null
}

type Mode = 'saved' | 'create' | 'meta'

const compact = (value?: string | null) => (value || '').toLowerCase().replace(/[^a-z0-9]/g, '')
const baseCardId = (value?: string | null) => {
  const raw = (value || '').toLowerCase().replace(/[^a-z0-9_]/g, '')
  const withoutUnderscoreVariant = raw.replace(/_p\d+$/i, '')
  return withoutUnderscoreVariant
    .replace(/[^a-z0-9]/g, '')
    .replace(/^((?:op|st|eb|prb|sp|ex|cp)\d{5,6}|p\d{3}|don\d{3})p\d+$/i, '$1')
}
const displayCardId = (value?: string | null) =>
  (value || '')
    .replace(/_p\d+$/i, '')
    .replace(/^((?:OP|ST|EB|PRB|SP|EX|CP)\d{2}-\d{3}|P-\d{3}|DON-\d{3})p\d+$/i, '$1')
const deckStorageKey = (userId: string) => `opv-decks:${userId}`
const colors = ['red', 'green', 'blue', 'purple', 'black', 'yellow']

const isDonCard = (card: { card_id?: string | null; name?: string | null; card_type?: string | null }) =>
  compact(card.card_type).includes('don') || compact(card.name).includes('don') || compact(card.card_id).startsWith('don')

const parseColors = (value?: string | null) => {
  const normalized = (value || '').toLowerCase()
  return colors.filter(color => normalized.includes(color))
}

const isSearchCard = (card: SearchCardResponse | DeckCard): card is SearchCardResponse =>
  'card_set_id' in card || 'card_name' in card || 'card_image' in card || 'id' in card

const toDeckCard = (card: SearchCardResponse | DeckCard, quantity = 1): DeckCard => {
  if (!isSearchCard(card)) {
    return {
      ...card,
      quantity
    }
  }

  return {
    card_id: String(card.card_id ?? card.card_set_id ?? card.id ?? ''),
    name: card.card_name || card.name || 'Carta',
    image_url: card.card_image || card.image_url || null,
    rarity: card.rarity || null,
    card_color: card.card_color ?? null,
    card_type: card.card_type ?? null,
    card_cost: card.card_cost == null ? null : Number(card.card_cost),
    card_power: card.card_power == null ? null : Number(card.card_power),
    market_price: card.market_price == null ? null : Number(card.market_price),
    inventory_price: card.inventory_price == null ? null : Number(card.inventory_price),
    quantity
  }
}

const rowToDeck = (row: DbDeckRow): SavedDeck => ({
  id: String(row.id),
  name: row.name || 'Deck senza nome',
  leader: row.leader || null,
  cards: Array.isArray(row.cards) ? row.cards : [],
  updatedAt: row.updated_at || new Date().toISOString(),
  source: row.source || undefined,
  sourceUrl: row.source_url || undefined,
  player: row.player || undefined,
  placement: row.placement || undefined,
  sourceTotal: row.meta_total || undefined
})

const deckToRow = (deck: SavedDeck, uid: string) => ({
  id: deck.id,
  user_id: uid,
  name: deck.name,
  leader: deck.leader,
  cards: deck.cards,
  source: deck.source || null,
  source_url: deck.sourceUrl || null,
  player: deck.player || null,
  placement: deck.placement || null,
  meta_total: deck.sourceTotal || null,
  updated_at: deck.updatedAt
})

export default function DeckBuilderPage() {
  const router = useRouter()
  const [mode, setMode] = useState<Mode>('saved')
  const [userId, setUserId] = useState<string | null>(null)
  const [deckName, setDeckName] = useState('Nuovo deck')
  const [leader, setLeader] = useState<DeckCard | null>(null)
  const [deckCards, setDeckCards] = useState<DeckCard[]>([])
  const [savedDecks, setSavedDecks] = useState<SavedDeck[]>([])
  const [search, setSearch] = useState('')
  const [catalogResults, setCatalogResults] = useState<DeckCard[]>([])
  const [loadingSearch, setLoadingSearch] = useState(false)
  const [openDeck, setOpenDeck] = useState<SavedDeck | null>(null)
  const [selectedCard, setSelectedCard] = useState<DeckCard | null>(null)
  const [selectedCardPrice, setSelectedCardPrice] = useState<number | null>(null)
  const [selectedCardPriceLoading, setSelectedCardPriceLoading] = useState(false)
  const [editingDeckId, setEditingDeckId] = useState<string | null>(null)
  const [metaDecks, setMetaDecks] = useState<SavedDeck[]>([])
  const [metaLoading, setMetaLoading] = useState(false)
  const [deckValues, setDeckValues] = useState<Record<string, number | null>>({})
  const [deckStoreReady, setDeckStoreReady] = useState(true)
  const [collectionSavingDeckId, setCollectionSavingDeckId] = useState<string | null>(null)
  const [collectionMessage, setCollectionMessage] = useState('')
  const collectionSaveLock = useRef<string | null>(null)

  useEffect(() => {
    const load = async () => {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session?.user) {
        router.push('/')
        return
      }

      setUserId(session.user.id)

      await loadSavedDecks(session.user.id)
    }

    load()
  }, [router])

  const loadLocalDecks = (uid: string) => {
    try {
      const raw = window.localStorage.getItem(deckStorageKey(uid))
      return raw ? JSON.parse(raw) as SavedDeck[] : []
    } catch {
      return []
    }
  }

  const saveLocalDecks = (uid: string, decks: SavedDeck[]) => {
    window.localStorage.setItem(deckStorageKey(uid), JSON.stringify(decks))
  }

  const loadSavedDecks = async (uid: string) => {
    const localDecks = loadLocalDecks(uid)

    try {
      const { data, error } = await supabase
        .from('user_decks')
        .select('id, user_id, name, leader, cards, source, source_url, player, placement, meta_total, updated_at')
        .eq('user_id', uid)
        .order('updated_at', { ascending: false })

      if (error) throw error

      setDeckStoreReady(true)
      const dbDecks = (data || []).map(row => rowToDeck(row as DbDeckRow))
      const dbIds = new Set(dbDecks.map(deck => deck.id))
      const decksToMigrate = localDecks.filter(deck => !dbIds.has(deck.id))

      if (decksToMigrate.length > 0) {
        await supabase
          .from('user_decks')
          .upsert(decksToMigrate.map(deck => deckToRow(deck, uid)), { onConflict: 'user_id,id' })
      }

      const merged = [...decksToMigrate, ...dbDecks]
        .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
        .slice(0, 80)

      setSavedDecks(merged)
      saveLocalDecks(uid, merged)
    } catch {
      setDeckStoreReady(false)
      setSavedDecks(localDecks)
    }
  }

  useEffect(() => {
    if (mode !== 'meta' || metaDecks.length > 0 || metaLoading) return

    const loadMeta = async () => {
      setMetaLoading(true)
      try {
        const res = await fetch('/api/decks/meta')
        const data = await res.json()
        setMetaDecks(Array.isArray(data?.decks) ? data.decks : [])
      } catch {
        setMetaDecks([])
      }
      setMetaLoading(false)
    }

    loadMeta()
  }, [mode, metaDecks.length, metaLoading])

  useEffect(() => {
    if (!search.trim()) {
      setCatalogResults([])
      setLoadingSearch(false)
      return
    }

    const timer = window.setTimeout(async () => {
      setLoadingSearch(true)
      try {
        const res = await fetch(`/api/cards/search?q=${encodeURIComponent(search.trim())}`)
        const data = await res.json()
        setCatalogResults((Array.isArray(data) ? data : [])
          .map((card: SearchCardResponse) => toDeckCard(card))
          .filter(card => !isDonCard(card))
          .slice(0, 32))
      } finally {
        setLoadingSearch(false)
      }
    }, 240)

    return () => window.clearTimeout(timer)
  }, [search])

  useEffect(() => {
    if (savedDecks.length === 0) {
      setDeckValues({})
      return
    }

    let cancelled = false

    const loadDeckValues = async () => {
      const uniqueCards = new Map<string, DeckCard>()
      savedDecks.forEach(deck => {
        if (deck.leader) uniqueCards.set(deck.leader.card_id, deck.leader)
        deck.cards.forEach(card => uniqueCards.set(card.card_id, card))
      })

      try {
        const res = await fetch('/api/cards/prices', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            cards: [...uniqueCards.values()].map(card => ({
              cardId: card.card_id,
              name: card.name
            }))
          })
        })
        const data = await res.json()
        const prices = (data?.prices || {}) as Record<string, LivePriceResult | null>
        const valueMap = Object.fromEntries(
          savedDecks.map(deck => {
            const value = deck.cards.reduce((sum, card) => {
              const live = prices[card.card_id]
              const price = live?.marketPrice ?? live?.midPrice ?? live?.lowPrice ?? card.market_price ?? card.inventory_price ?? 0
              return sum + Number(price || 0) * Number(card.quantity || 0)
            }, 0)
            return [deck.id, value > 0 ? value : null]
          })
        )

        if (!cancelled) setDeckValues(valueMap)
      } catch {
        if (!cancelled) setDeckValues({})
      }
    }

    loadDeckValues()

    return () => {
      cancelled = true
    }
  }, [savedDecks])

  const mainCount = deckCards.reduce((sum, card) => sum + card.quantity, 0)
  const leaderColors = parseColors(leader?.card_color)
  const baseCounts = deckCards.reduce<Record<string, number>>((acc, card) => {
    const key = baseCardId(card.card_id)
    acc[key] = (acc[key] || 0) + card.quantity
    return acc
  }, {})
  const overLimit = deckCards.filter(card => (baseCounts[baseCardId(card.card_id)] || 0) > 4)
  const offColor = leaderColors.length === 0
    ? []
    : deckCards.filter(card => {
        const cardColors = parseColors(card.card_color)
        return cardColors.length > 0 && !cardColors.some(color => leaderColors.includes(color))
      })
  const isValid = Boolean(leader) && mainCount === 50 && overLimit.length === 0 && offColor.length === 0

  const availableCards = catalogResults
  const formatPrice = (value?: number | null) =>
    value == null
      ? '—'
      : new Intl.NumberFormat('it-IT', { style: 'currency', currency: 'EUR' }).format(value)
  const getLivePriceNumber = (price?: LivePriceResult | null) => {
    if (!price) return null
    return price.marketPrice ?? price.midPrice ?? price.lowPrice ?? null
  }

  const deckCardsExpanded = deckCards.flatMap(card =>
    Array.from({ length: card.quantity }, (_, index) => ({ ...card, copyIndex: index }))
  )

  const saveDecks = async (decks: SavedDeck[]) => {
    if (!userId) return
    setSavedDecks(decks)
    saveLocalDecks(userId, decks)

    if (!deckStoreReady) return

    try {
      const { error } = await supabase
        .from('user_decks')
        .upsert(decks.map(deck => deckToRow(deck, userId)), { onConflict: 'user_id,id' })

      if (error) throw error
    } catch {
      setDeckStoreReady(false)
    }
  }

  const openCardDetail = async (card: DeckCard | null) => {
    if (!card) return

    setSelectedCard(card)
    setSelectedCardPrice(null)
    setSelectedCardPriceLoading(true)

    try {
      const params = new URLSearchParams()
      params.set('cardId', card.card_id)
      if (card.name) params.set('name', card.name)

      const res = await fetch(`/api/cards/price?${params.toString()}`)
      const data = await res.json()
      setSelectedCardPrice(getLivePriceNumber(data?.price))
    } catch {
      setSelectedCardPrice(null)
    }

    setSelectedCardPriceLoading(false)
  }

  const addMainCard = (card: DeckCard) => {
    if (isDonCard(card) || (card.card_type || '').toLowerCase().includes('leader')) return

    const key = baseCardId(card.card_id)
    const currentCopies = deckCards.reduce((sum, item) => sum + (baseCardId(item.card_id) === key ? item.quantity : 0), 0)
    if (currentCopies >= 4 || mainCount >= 50) return

    setDeckCards(prev => {
      const existing = prev.find(item => item.card_id === card.card_id)
      if (existing) return prev.map(item => item.card_id === card.card_id ? { ...item, quantity: item.quantity + 1 } : item)
      return [...prev, { ...card, quantity: 1 }]
    })
  }

  const removeMainCard = (cardId: string) => {
    setDeckCards(prev => prev
      .map(card => card.card_id === cardId ? { ...card, quantity: card.quantity - 1 } : card)
      .filter(card => card.quantity > 0)
    )
  }

  const setAsLeader = (card: DeckCard) => {
    if (isDonCard(card)) return
    setLeader({ ...card, quantity: 1 })
  }

  const startNewDeck = () => {
    setMode('create')
    setDeckName('Nuovo deck')
    setLeader(null)
    setDeckCards([])
    setEditingDeckId(null)
    setOpenDeck(null)
  }

  const saveCurrentDeck = async () => {
    if (!userId) return
    const deck: SavedDeck = {
      id: editingDeckId || `${Date.now()}`,
      name: deckName.trim() || 'Deck senza nome',
      leader,
      cards: deckCards,
      updatedAt: new Date().toISOString()
    }
    await saveDecks([deck, ...savedDecks.filter(item => item.id !== deck.id && item.name !== deck.name)].slice(0, 80))
    setEditingDeckId(deck.id)
    setOpenDeck(deck)
  }

  const loadDeck = (deck: SavedDeck) => {
    setMode('create')
    setDeckName(deck.name)
    setLeader(deck.leader)
    setDeckCards(deck.cards.filter(card => !isDonCard(card)))
    setEditingDeckId(deck.id)
    setOpenDeck(null)
  }

  const deleteDeck = async (deckId: string) => {
    if (userId && deckStoreReady) {
      await supabase.from('user_decks').delete().eq('user_id', userId).eq('id', deckId)
    }
    await saveDecks(savedDecks.filter(deck => deck.id !== deckId))
    if (openDeck?.id === deckId) setOpenDeck(null)
  }

  const saveMetaDeckToMine = async (deck: SavedDeck) => {
    if (!userId) return
    const copiedDeck: SavedDeck = {
      ...deck,
      id: `${Date.now()}`,
      name: deck.name,
      source: undefined,
      sourceUrl: undefined,
      player: undefined,
      placement: undefined,
      updatedAt: new Date().toISOString()
    }

    await saveDecks([copiedDeck, ...savedDecks.filter(item => item.name !== copiedDeck.name)].slice(0, 80))
    setOpenDeck(copiedDeck)
  }

  const addDeckToCollection = async (deck: SavedDeck) => {
    if (!userId || collectionSavingDeckId || collectionSaveLock.current) return

    const cardsToAdd = [
      ...(deck.leader ? [{ ...deck.leader, quantity: 1 }] : []),
      ...deck.cards.filter(card => !isDonCard(card))
    ].filter(card => card.card_id)

    if (cardsToAdd.length === 0) {
      setCollectionMessage('Questo deck non contiene carte aggiungibili.')
      return
    }

    collectionSaveLock.current = deck.id
    setCollectionSavingDeckId(deck.id)
    setCollectionMessage('Aggiungo le carte alla collezione...')

    try {
      const grouped = new Map<string, { card: DeckCard; quantity: number }>()
      for (const card of cardsToAdd) {
        const current = grouped.get(card.card_id)
        const quantity = Math.max(1, Number(card.quantity || 1))
        grouped.set(card.card_id, {
          card,
          quantity: Math.max(current?.quantity || 0, quantity)
        })
      }

      const cardIds = [...grouped.keys()]
      const { data: existingCards, error: lookupError } = await supabase
        .from('user_cards')
        .select('id, card_id, quantity')
        .eq('user_id', userId)
        .in('card_id', cardIds)

      if (lookupError) throw lookupError

      const existingById = new Map((existingCards || []).map(card => [String(card.card_id), card]))
      const inserts: Array<Record<string, unknown>> = []
      const updates: Array<Promise<{ error: unknown }>> = []

      grouped.forEach(({ card, quantity }, cardId) => {
        const payload = {
          user_id: userId,
          card_id: card.card_id,
          name: card.name,
          image_url: card.image_url,
          rarity: card.rarity,
          card_color: card.card_color ?? null,
          card_type: card.card_type ?? null,
          card_cost: card.card_cost ?? null,
          card_power: card.card_power ?? null,
          market_price: card.market_price ?? null,
          inventory_price: card.inventory_price ?? null,
        }
        const existing = existingById.get(cardId)

        if (existing) {
          updates.push(Promise.resolve(
            supabase
              .from('user_cards')
              .update({
                ...payload,
                quantity: Number(existing.quantity || 0) + quantity
              })
              .eq('id', existing.id)
          ))
        } else {
          inserts.push({
            ...payload,
            quantity
          })
        }
      })

      const operations = [...updates]
      if (inserts.length > 0) {
        operations.push(Promise.resolve(supabase.from('user_cards').insert(inserts)))
      }

      const results = await Promise.all(operations)
      const errorResult = results.find(result => result.error)
      if (errorResult?.error) throw errorResult.error

      const totalQuantity = [...grouped.values()].reduce((sum, item) => sum + item.quantity, 0)
      setCollectionMessage(`${totalQuantity} carte aggiunte alla collezione.`)
    } catch (error) {
      console.error('Deck collection save error:', error)
      setCollectionMessage('Non sono riuscito ad aggiungere il deck. Riprova quando Supabase torna stabile.')
    }

    collectionSaveLock.current = null
    setCollectionSavingDeckId(null)
  }

  const getDeckValue = (deck: SavedDeck) => {
    const liveValue = deckValues[deck.id]
    if (liveValue != null) return liveValue
    const storedValue = deck.cards.reduce((sum, card) => {
      const price = Number(card.market_price ?? card.inventory_price ?? 0)
      return sum + price * Number(card.quantity || 0)
    }, 0)
    return storedValue > 0 ? storedValue : null
  }

  const pageTitle = mode === 'saved' ? 'I miei deck' : mode === 'create' ? 'Crea deck' : 'Deck meta'
  const pageDescription = mode === 'saved'
    ? 'Tutti i deck salvati, apribili e modificabili.'
    : mode === 'create'
    ? 'Costruisci Leader + 50 carte main. I DON sono nascosti.'
    : 'Decklist reali recenti da Limitless, apribili come i tuoi deck.'

  const renderDeckModal = (deck: SavedDeck) => (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 p-2 backdrop-blur-md sm:items-center sm:p-4" onClick={() => setOpenDeck(null)}>
      <div className="max-h-[90dvh] w-full max-w-5xl overflow-hidden rounded-[1.75rem] border border-slate-700 bg-slate-950/96 shadow-2xl" onClick={event => event.stopPropagation()}>
        <div className="flex items-center justify-between gap-3 border-b border-slate-800 p-3">
          <div className="min-w-0">
            <p className="text-[10px] uppercase tracking-[0.28em] text-cyan-200">{deck.source || 'Deck salvato'}</p>
            <h3 className="truncate text-lg font-black text-white">{deck.name}</h3>
            <p className="truncate text-xs text-slate-400">{deck.player ? `${deck.placement} · ${deck.player}` : `${deck.cards.reduce((sum, card) => sum + card.quantity, 0)}/50 carte`}</p>
          </div>
          <button onClick={() => setOpenDeck(null)} className="grid h-10 w-10 place-items-center rounded-2xl border border-slate-700 bg-slate-800 text-slate-100" aria-label="Chiudi">
            <X size={18} />
          </button>
        </div>
        <div className="grid max-h-[calc(90dvh-74px)] gap-4 overflow-y-auto p-3 lg:grid-cols-[240px_1fr]">
          <aside className="rounded-3xl border border-cyan-300/20 bg-cyan-300/10 p-3">
            <p className="text-[10px] font-black uppercase tracking-[0.22em] text-cyan-100">Leader</p>
            {deck.leader ? (
              <>
                <button onClick={() => openCardDetail(deck.leader)} className="mt-3 block w-full text-left">
                  <CardImage src={deck.leader.image_url} cardId={deck.leader.card_id} alt={deck.leader.name || 'Leader'} className="aspect-[3/4] overflow-hidden rounded-2xl bg-slate-950" />
                </button>
                <p className="mt-2 text-sm font-black text-white">{deck.leader.name}</p>
                <p className="text-[10px] text-slate-400">{displayCardId(deck.leader.card_id)}</p>
              </>
            ) : <p className="mt-3 text-sm text-slate-400">Nessun leader salvato.</p>}
            <div className="mt-3 rounded-2xl border border-emerald-300/20 bg-emerald-300/10 p-2">
              <p className="text-[10px] font-black uppercase tracking-[0.18em] text-emerald-100/70">Valore stimato</p>
              <p className="mt-1 text-lg font-black text-emerald-100">{formatPrice(getDeckValue(deck))}</p>
            </div>
            {deck.sourceUrl && <a href={deck.sourceUrl} target="_blank" rel="noreferrer" className="mt-2 block rounded-2xl border border-cyan-300/25 bg-cyan-300/10 px-3 py-2 text-center text-xs font-black text-cyan-100">Fonte</a>}
            {deck.id.startsWith('meta-') ? (
              <button onClick={() => saveMetaDeckToMine(deck)} className="mt-3 w-full rounded-2xl bg-cyan-300 px-4 py-3 text-sm font-black text-slate-950">Salva nei miei deck</button>
            ) : (
              <>
                <button onClick={() => addDeckToCollection(deck)} disabled={collectionSavingDeckId === deck.id} className="mt-3 w-full rounded-2xl bg-emerald-300 px-4 py-3 text-sm font-black text-slate-950 disabled:opacity-60">
                  {collectionSavingDeckId === deck.id ? 'Aggiungo...' : 'Aggiungi alla collezione'}
                </button>
                <button onClick={() => loadDeck(deck)} className="mt-2 w-full rounded-2xl bg-cyan-300 px-4 py-3 text-sm font-black text-slate-950">Modifica</button>
              </>
            )}
            {collectionMessage ? (
              <p className="mt-2 rounded-2xl border border-white/10 bg-white/[0.06] px-3 py-2 text-xs font-bold text-slate-200">{collectionMessage}</p>
            ) : null}
          </aside>
          <section>
            <div className="mb-3 flex items-center justify-between">
              <p className="text-sm font-black text-white">{deck.cards.reduce((sum, card) => sum + card.quantity, 0)}/50 carte</p>
              <p className="text-xs text-slate-400">{new Date(deck.updatedAt).toLocaleDateString('it-IT')}</p>
            </div>
            <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6">
              {deck.cards.filter(card => !isDonCard(card)).map(card => (
                <div key={card.card_id} className="rounded-2xl border border-slate-700 bg-slate-900/80 p-1.5">
                  <div className="relative">
                    <button onClick={() => openCardDetail(card)} className="block w-full text-left">
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
  )

  return (
    <div className={`min-h-screen overflow-x-hidden pt-14 text-white onepiece-wave-bg onepiece-clouds ${mode === 'create' ? 'pb-56 sm:pb-60' : 'pb-32 sm:pb-36'}`}>
      <Sidebar activePage="decks" />
      <Topbar />

      <main className="mx-auto max-w-7xl px-3 py-4 sm:px-6 lg:px-8">
        <section className="rounded-[1.6rem] border border-white/10 bg-slate-900/72 p-4 shadow-2xl shadow-black/20 backdrop-blur-xl sm:rounded-[2rem] sm:p-5">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <p className="text-[10px] font-black uppercase tracking-[0.3em] text-cyan-200">Deck</p>
              <h1 className="mt-1 text-2xl font-black text-white sm:text-3xl">{pageTitle}</h1>
              <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-300">{pageDescription}</p>
            </div>
            <div className="grid grid-cols-3 rounded-2xl border border-slate-700 bg-slate-950/60 p-1 text-xs font-black sm:text-sm">
              <button onClick={() => setMode('saved')} className={`rounded-xl px-2 py-2 sm:px-4 ${mode === 'saved' ? 'bg-cyan-300 text-slate-950' : 'text-slate-400'}`}>I miei deck</button>
              <button onClick={startNewDeck} className={`rounded-xl px-2 py-2 sm:px-4 ${mode === 'create' ? 'bg-cyan-300 text-slate-950' : 'text-slate-400'}`}>Crea deck</button>
              <button onClick={() => setMode('meta')} className={`rounded-xl px-2 py-2 sm:px-4 ${mode === 'meta' ? 'bg-cyan-300 text-slate-950' : 'text-slate-400'}`}>Deck meta</button>
            </div>
          </div>
        </section>

        {mode === 'saved' ? (
          <section className="mt-4 rounded-[1.6rem] border border-white/10 bg-slate-900/75 p-3 backdrop-blur-xl sm:p-4">
            <div className="mb-3 flex items-center justify-between gap-3">
              <div className="flex items-center gap-2 text-[10px] font-black uppercase tracking-[0.24em] text-cyan-200">
                <LibraryBig size={15} />I miei deck
              </div>
              <button onClick={startNewDeck} className="rounded-2xl bg-cyan-300 px-3 py-2 text-xs font-black text-slate-950 active:scale-95">
                Crea deck
              </button>
            </div>

            {savedDecks.length === 0 ? (
              <div className="rounded-[1.5rem] border border-dashed border-slate-700 bg-slate-950/55 p-5 text-center">
                <p className="text-lg font-black text-white">Nessun deck salvato</p>
                <p className="mt-2 text-sm text-slate-400">Crea il primo deck e lo ritroverai qui.</p>
                <button onClick={startNewDeck} className="mt-4 rounded-2xl bg-cyan-300 px-4 py-3 text-sm font-black text-slate-950">Crea deck</button>
              </div>
            ) : (
              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                {savedDecks.map(deck => {
                  const mainCountSaved = deck.cards.reduce((sum, card) => sum + card.quantity, 0)
                  const uniqueCount = deck.cards.length
                  return (
                    <article key={deck.id} className="overflow-hidden rounded-[1.5rem] border border-slate-700 bg-slate-950/65 p-3">
                      <button onClick={() => setOpenDeck(deck)} className="w-full text-left">
                        <div className="flex gap-3">
                          {deck.leader ? (
                            <CardImage src={deck.leader.image_url} cardId={deck.leader.card_id} alt={deck.leader.name || 'Leader'} className="h-28 w-20 shrink-0 overflow-hidden rounded-2xl bg-slate-900" />
                          ) : (
                            <div className="grid h-28 w-20 shrink-0 place-items-center rounded-2xl border border-dashed border-slate-700 text-[10px] text-slate-500">Leader</div>
                          )}
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-lg font-black text-white">{deck.name}</p>
                            <p className="mt-1 truncate text-xs text-slate-400">{deck.leader?.name || 'No leader'}</p>
                            <div className="mt-3 flex flex-wrap gap-2">
                              <span className="rounded-full bg-cyan-300/12 px-2 py-1 text-[10px] font-black text-cyan-100">{mainCountSaved}/50</span>
                              <span className="rounded-full bg-white/[0.08] px-2 py-1 text-[10px] font-black text-slate-200">{uniqueCount} uniche</span>
                              <span className="rounded-full bg-emerald-300/12 px-2 py-1 text-[10px] font-black text-emerald-100">{formatPrice(getDeckValue(deck))}</span>
                            </div>
                            <p className="mt-3 text-[10px] text-slate-500">{new Date(deck.updatedAt).toLocaleDateString('it-IT')}</p>
                          </div>
                        </div>
                      </button>
                      <div className="mt-3 grid grid-cols-3 gap-2">
                        <button onClick={() => setOpenDeck(deck)} className="rounded-xl border border-slate-700 bg-slate-900 px-2 py-2 text-[10px] font-black text-slate-200">Apri</button>
                        <button onClick={() => loadDeck(deck)} className="rounded-xl border border-cyan-300/25 bg-cyan-300/10 px-2 py-2 text-[10px] font-black text-cyan-100">Modifica</button>
                        <button onClick={() => deleteDeck(deck.id)} className="rounded-xl border border-rose-300/25 bg-rose-400/10 px-2 py-2 text-[10px] font-black text-rose-100">Elimina</button>
                      </div>
                    </article>
                  )
                })}
              </div>
            )}
          </section>
        ) : mode === 'create' ? (
          <div className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,1fr)_330px]">
            <section className="rounded-[1.6rem] border border-white/10 bg-slate-900/75 p-3 backdrop-blur-xl sm:p-4">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                <div className="relative flex-1">
                  <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
                  <input
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                    placeholder="Cerca nel catalogo carte"
                    className="w-full rounded-2xl border border-slate-700 bg-slate-950/70 px-10 py-3 text-sm text-white outline-none focus:border-cyan-300"
                  />
                </div>
              </div>

              <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5 2xl:grid-cols-6">
                {loadingSearch ? (
                  <p className="col-span-full rounded-2xl border border-slate-700 p-4 text-sm text-slate-400">Ricerca...</p>
                ) : !search.trim() ? (
                  <p className="col-span-full rounded-2xl border border-dashed border-slate-700 p-4 text-sm text-slate-400">Cerca una carta per aggiungerla al deck.</p>
                ) : availableCards.map(card => {
                  const isLeader = (card.card_type || '').toLowerCase().includes('leader')
                  const copies = baseCounts[baseCardId(card.card_id)] || 0
                  const canAdd = !isLeader && !isDonCard(card) && copies < 4 && mainCount < 50

                  return (
                    <div key={card.card_id} className="relative rounded-2xl border border-slate-700 bg-slate-950/70 p-2">
                      {copies > 0 && <div className="absolute right-3 top-3 z-10 rounded-full border border-cyan-100/40 bg-cyan-300 px-2 py-1 text-[10px] font-black text-slate-950 shadow-lg">x{copies}</div>}
                      <button onClick={() => openCardDetail(card)} className="block w-full text-left">
                        <CardImage src={card.image_url} cardId={card.card_id} alt={card.name || card.card_id} className="aspect-[3/4] overflow-hidden rounded-xl bg-slate-900" />
                      </button>
                      <p className="mt-2 truncate text-xs font-black text-white">{card.name}</p>
                      <p className="text-[10px] text-slate-500">{displayCardId(card.card_id)}</p>
                      <div className="mt-2 grid grid-cols-2 gap-1">
                        <button onClick={() => addMainCard(card)} className="flex items-center justify-center gap-1 rounded-xl bg-cyan-300 px-2 py-2 text-[10px] font-black text-slate-950 disabled:opacity-40" disabled={!canAdd}>
                          <Plus size={13} />Main
                        </button>
                        <button onClick={() => setAsLeader(card)} className="flex items-center justify-center gap-1 rounded-xl border border-amber-200/40 bg-amber-200/12 px-2 py-2 text-[10px] font-black text-amber-100">
                          <Crown size={13} />Lead
                        </button>
                      </div>
                    </div>
                  )
                })}
              </div>
            </section>

            <aside className="space-y-4">
              <div className="rounded-[1.6rem] border border-white/10 bg-slate-900/75 p-4 backdrop-blur-xl">
                <div className="flex items-center gap-2 text-[10px] font-black uppercase tracking-[0.24em] text-cyan-200"><LibraryBig size={15} />I miei deck</div>
                <div className="mt-3 space-y-2">
                  {savedDecks.length === 0 ? (
                    <p className="rounded-2xl border border-dashed border-slate-700 p-3 text-sm text-slate-400">Nessun deck salvato.</p>
                  ) : savedDecks.map(deck => (
                    <div key={deck.id} className="flex items-center gap-2 rounded-2xl border border-slate-700 bg-slate-950/60 p-2">
                      <button onClick={() => setOpenDeck(deck)} className="min-w-0 flex-1 text-left">
                        <p className="truncate text-sm font-black text-white">{deck.name}</p>
                        <p className="text-[10px] text-slate-500">{deck.cards.reduce((sum, card) => sum + card.quantity, 0)}/50 · {deck.leader?.name || 'No leader'}</p>
                      </button>
                      <button onClick={() => loadDeck(deck)} className="grid h-9 w-9 place-items-center rounded-xl text-cyan-100 hover:bg-cyan-300/10" aria-label="Modifica deck"><Eye size={15} /></button>
                      <button onClick={() => deleteDeck(deck.id)} className="grid h-9 w-9 place-items-center rounded-xl text-rose-200 hover:bg-rose-400/10" aria-label="Elimina deck"><Trash2 size={15} /></button>
                    </div>
                  ))}
                </div>
              </div>
            </aside>
          </div>
        ) : (
          <section className="mt-4 rounded-[1.6rem] border border-white/10 bg-slate-900/75 p-3 backdrop-blur-xl sm:p-4">
            {metaLoading ? (
              <p className="rounded-2xl border border-slate-700 p-4 text-sm text-slate-400">Carico i deck meta...</p>
            ) : metaDecks.length === 0 ? (
              <p className="rounded-2xl border border-dashed border-slate-700 p-4 text-sm text-slate-400">Deck meta non disponibili adesso.</p>
            ) : (
              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                {metaDecks.map(deck => (
                  <button key={deck.id} onClick={() => setOpenDeck(deck)} className="rounded-[1.5rem] border border-slate-700 bg-slate-950/65 p-3 text-left transition hover:border-cyan-300/50">
                    <div className="flex gap-3">
                      {deck.leader ? <CardImage src={deck.leader.image_url} cardId={deck.leader.card_id} alt={deck.leader.name || 'Leader'} className="h-28 w-20 shrink-0 overflow-hidden rounded-2xl bg-slate-900" /> : null}
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 text-[10px] font-black uppercase tracking-[0.18em] text-amber-200"><Trophy size={13} />{deck.placement}</div>
                        <p className="mt-1 truncate text-lg font-black text-white">{deck.name}</p>
                        <p className="mt-1 truncate text-xs text-slate-400">{deck.player || 'Limitless'}</p>
                        <div className="mt-3 flex flex-wrap gap-2">
                          <span className="rounded-full bg-cyan-300/12 px-2 py-1 text-[10px] font-black text-cyan-100">{deck.cards.reduce((sum, card) => sum + card.quantity, 0)}/50</span>
                          <span className="rounded-full bg-emerald-300/12 px-2 py-1 text-[10px] font-black text-emerald-100">{formatPrice(getDeckValue(deck))}</span>
                        </div>
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </section>
        )}
      </main>

      {mode === 'create' && (
        <div className="fixed inset-x-0 z-40 mx-auto w-[min(calc(100%-1rem),980px)] rounded-[1.6rem] border border-white/14 bg-[#173842]/94 p-2 shadow-[0_20px_50px_rgba(0,0,0,0.35)] backdrop-blur-2xl sm:p-3" style={{ bottom: 'calc(max(0.5rem, env(safe-area-inset-bottom)) + 4.8rem)' }}>
          <div className="mb-2 grid grid-cols-[1fr_auto] gap-2">
            <input
              value={deckName}
              onChange={(event) => setDeckName(event.target.value)}
              className="min-w-0 rounded-2xl border border-white/10 bg-slate-950/55 px-3 py-2 text-sm font-black text-white outline-none focus:border-cyan-200"
              aria-label="Nome deck"
            />
            <button onClick={saveCurrentDeck} className="flex items-center justify-center gap-2 rounded-2xl bg-cyan-300 px-4 py-2 text-sm font-black text-slate-950 shadow-lg active:scale-95">
              <Save size={16} />
              <span className="hidden sm:inline">Salva</span>
            </button>
          </div>
          <div className="flex items-center gap-3">
            {leader ? <CardImage src={leader.image_url} cardId={leader.card_id} alt={leader.name || 'Leader'} className="h-16 w-11 shrink-0 overflow-hidden rounded-xl bg-slate-950" /> : <div className="grid h-16 w-11 shrink-0 place-items-center rounded-xl border border-dashed border-slate-600 text-[9px] text-slate-400">Lead</div>}
            <div className="min-w-0 flex-1">
              <div className="mb-2 flex items-center justify-between gap-2">
                <span className="truncate text-xs font-black text-white">{deckName} · {mainCount}/50</span>
                <span className={`rounded-full px-2 py-1 text-[10px] font-black ${isValid ? 'bg-emerald-300/15 text-emerald-100' : 'bg-amber-300/15 text-amber-100'}`}>{isValid ? 'Valido' : 'In costruzione'}</span>
              </div>
              <div className="flex gap-2 overflow-x-auto pb-1">
                {deckCardsExpanded.length === 0 ? (
                  <div className="rounded-2xl border border-dashed border-slate-600 px-4 py-3 text-sm text-slate-400">Le carte aggiunte compariranno qui.</div>
                ) : deckCardsExpanded.map(card => (
                  <button key={`${card.card_id}-${card.copyIndex}`} onClick={() => removeMainCard(card.card_id)} className="relative h-20 w-14 shrink-0 overflow-hidden rounded-xl border border-slate-700 bg-slate-950" aria-label={`Rimuovi ${card.name}`}>
                    <CardImage src={card.image_url} cardId={card.card_id} alt={card.name || card.card_id} className="h-full w-full" />
                    <span className="absolute right-1 top-1 grid h-5 w-5 place-items-center rounded-full bg-rose-400 text-slate-950"><Minus size={12} /></span>
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {openDeck && renderDeckModal(openDeck)}
      {selectedCard ? (
        <div
          className="fixed inset-0 z-[60] flex items-end justify-center bg-black/72 p-2 backdrop-blur-md sm:items-center sm:p-4"
          onClick={() => {
            setSelectedCard(null)
            setSelectedCardPrice(null)
          }}
        >
          <div className="w-full max-w-3xl overflow-hidden rounded-[1.75rem] border border-slate-700 bg-slate-950/97 shadow-2xl" onClick={event => event.stopPropagation()}>
            <div className="flex items-center justify-between border-b border-slate-800 p-3">
              <div className="min-w-0">
                <p className="text-[10px] font-black uppercase tracking-[0.24em] text-cyan-200">Carta</p>
                <h3 className="truncate text-lg font-black text-white">{selectedCard.name || selectedCard.card_id}</h3>
              </div>
              <button
                onClick={() => {
                  setSelectedCard(null)
                  setSelectedCardPrice(null)
                }}
                className="grid h-10 w-10 place-items-center rounded-2xl border border-slate-700 bg-slate-800 text-slate-100"
                aria-label="Chiudi carta"
              >
                <X size={18} />
              </button>
            </div>
            <div className="grid max-h-[82dvh] gap-4 overflow-y-auto p-3 sm:grid-cols-[240px_1fr]">
              <CardImage src={selectedCard.image_url} cardId={selectedCard.card_id} alt={selectedCard.name || selectedCard.card_id} className="aspect-[3/4] overflow-hidden rounded-3xl bg-slate-950" />
              <div className="space-y-3">
                <div>
                  <p className="text-2xl font-black text-white">{selectedCard.name || 'Carta'}</p>
                  <p className="mt-1 text-sm font-bold text-cyan-100">{displayCardId(selectedCard.card_id)}</p>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  {[
                    ['Rarita', selectedCard.rarity || '-'],
                    ['Colore', selectedCard.card_color || '-'],
                    ['Tipo', selectedCard.card_type || '-'],
                    ['Prezzo live', selectedCardPriceLoading ? '...' : formatPrice(selectedCardPrice ?? selectedCard.market_price ?? selectedCard.inventory_price)],
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
