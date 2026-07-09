'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { BookOpenCheck, CheckCircle2, CopyPlus, Crown, Plus, Save, Search, Trash2, XCircle } from 'lucide-react'
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
  quantity: number
}

type CatalogCard = {
  id: string
  name: string
  image_url: string | null
  rarity: string | null
  card_color?: string | null
  card_type?: string | null
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
}

type SavedDeck = {
  id: string
  name: string
  leader: DeckCard | null
  cards: DeckCard[]
  updatedAt: string
}

const popularDecks = [
  ['Green/Blue Luffy', '30.54%'],
  ['Blue/Yellow Nami', '24.55%'],
  ['Purple Enel', '15.87%'],
  ['Purple/Yellow Rosinante', '9.28%'],
  ['Black/Yellow Blackbeard', '5.09%'],
  ['Red/Blue Lucy', '3.14%'],
  ['Red Shanks', '2.10%'],
  ['Black Crocodile', '1.80%'],
]

const compact = (value?: string | null) => (value || '').toLowerCase().replace(/[^a-z0-9]/g, '')
const baseCardId = (value?: string | null) => compact(value).replace(/p\d+$/i, '')
const displayCardId = (value?: string | null) => (value || '').replace(/_p\d+$/i, '')
const deckStorageKey = (userId: string) => `opv-decks:${userId}`

const colors = ['red', 'green', 'blue', 'purple', 'black', 'yellow']

const parseColors = (value?: string | null) => {
  const normalized = (value || '').toLowerCase()
  return colors.filter(color => normalized.includes(color))
}

const toDeckCard = (card: CatalogCard | DeckCard, quantity = 1): DeckCard => ({
  card_id: 'id' in card ? card.id : card.card_id,
  name: card.name,
  image_url: card.image_url,
  rarity: card.rarity,
  card_color: card.card_color ?? null,
  card_type: card.card_type ?? null,
  quantity
})

export default function DeckBuilderPage() {
  const router = useRouter()
  const [userId, setUserId] = useState<string | null>(null)
  const [deckName, setDeckName] = useState('Nuovo deck')
  const [leader, setLeader] = useState<DeckCard | null>(null)
  const [deckCards, setDeckCards] = useState<DeckCard[]>([])
  const [savedDecks, setSavedDecks] = useState<SavedDeck[]>([])
  const [collection, setCollection] = useState<DeckCard[]>([])
  const [search, setSearch] = useState('')
  const [catalogResults, setCatalogResults] = useState<CatalogCard[]>([])
  const [loadingSearch, setLoadingSearch] = useState(false)
  const [activeSource, setActiveSource] = useState<'collection' | 'catalog'>('collection')

  useEffect(() => {
    const load = async () => {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session?.user) {
        router.push('/')
        return
      }

      setUserId(session.user.id)

      const { data } = await supabase
        .from('user_cards')
        .select('card_id, quantity, name, image_url, rarity, card_color, card_type')
        .eq('user_id', session.user.id)

      setCollection(data || [])

      try {
        const raw = window.localStorage.getItem(deckStorageKey(session.user.id))
        setSavedDecks(raw ? JSON.parse(raw) : [])
      } catch {
        setSavedDecks([])
      }
    }

    load()
  }, [router])

  useEffect(() => {
    if (!search.trim() || activeSource !== 'catalog') {
      return
    }

    const timer = window.setTimeout(async () => {
      setLoadingSearch(true)
      try {
        const res = await fetch(`/api/cards/search?q=${encodeURIComponent(search.trim())}`)
        const data = await res.json()
        setCatalogResults((Array.isArray(data) ? data : []).slice(0, 24).map((card: SearchCardResponse) => ({
          id: String(card.card_set_id ?? card.card_id ?? card.id),
          name: card.card_name || card.name || 'Carta',
          image_url: card.card_image || card.image_url || null,
          rarity: card.rarity || '-',
          card_color: card.card_color ?? null,
          card_type: card.card_type ?? null
        })))
      } finally {
        setLoadingSearch(false)
      }
    }, 260)

    return () => window.clearTimeout(timer)
  }, [search, activeSource])

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

  const filteredCollection = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return collection.slice(0, 30)
    return collection
      .filter(card =>
        (card.name || '').toLowerCase().includes(q) ||
        card.card_id.toLowerCase().includes(q)
      )
      .slice(0, 30)
  }, [collection, search])

  const availableCards = activeSource === 'collection'
    ? filteredCollection
    : catalogResults.map(card => toDeckCard(card, 1))

  const saveDecks = (decks: SavedDeck[]) => {
    if (!userId) return
    setSavedDecks(decks)
    window.localStorage.setItem(deckStorageKey(userId), JSON.stringify(decks))
  }

  const addMainCard = (card: DeckCard) => {
    if ((card.card_type || '').toLowerCase().includes('leader')) return

    const key = baseCardId(card.card_id)
    const currentCopies = deckCards.reduce((sum, item) => sum + (baseCardId(item.card_id) === key ? item.quantity : 0), 0)
    if (currentCopies >= 4 || mainCount >= 50) return

    setDeckCards(prev => {
      const existing = prev.find(item => item.card_id === card.card_id)
      if (existing) {
        return prev.map(item => item.card_id === card.card_id ? { ...item, quantity: item.quantity + 1 } : item)
      }
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
    setLeader({ ...card, quantity: 1 })
  }

  const saveCurrentDeck = () => {
    if (!userId) return
    const deck: SavedDeck = {
      id: `${Date.now()}`,
      name: deckName.trim() || 'Deck senza nome',
      leader,
      cards: deckCards,
      updatedAt: new Date().toISOString()
    }
    saveDecks([deck, ...savedDecks.filter(item => item.name !== deck.name)].slice(0, 20))
  }

  const loadDeck = (deck: SavedDeck) => {
    setDeckName(deck.name)
    setLeader(deck.leader)
    setDeckCards(deck.cards)
  }

  const deleteDeck = (deckId: string) => {
    saveDecks(savedDecks.filter(deck => deck.id !== deckId))
  }

  return (
    <div className="min-h-screen overflow-x-hidden pb-32 pt-14 text-white onepiece-wave-bg onepiece-clouds sm:pb-36">
      <Sidebar activePage="decks" />
      <Topbar />

      <main className="mx-auto max-w-7xl px-3 py-4 sm:px-6 lg:px-8">
        <section className="rounded-[1.6rem] border border-white/10 bg-slate-900/72 p-4 shadow-2xl shadow-black/20 backdrop-blur-xl sm:rounded-[2rem] sm:p-5">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <p className="text-[10px] font-black uppercase tracking-[0.3em] text-cyan-200">Deck Builder</p>
              <h1 className="mt-1 text-2xl font-black text-white sm:text-3xl">Costruisci e salva i tuoi deck</h1>
              <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-300">
                Regole applicate: 1 Leader, 50 carte nel deck principale, massimo 4 copie per numero carta e colori compatibili col Leader.
              </p>
            </div>
            <div className={`rounded-2xl border px-4 py-3 ${isValid ? 'border-emerald-300/30 bg-emerald-300/10 text-emerald-100' : 'border-amber-300/30 bg-amber-300/10 text-amber-100'}`}>
              <div className="flex items-center gap-2 text-sm font-black">
                {isValid ? <CheckCircle2 size={18} /> : <XCircle size={18} />}
                {isValid ? 'Deck valido' : 'Deck da completare'}
              </div>
              <p className="mt-1 text-xs opacity-80">{mainCount}/50 carte principali</p>
            </div>
          </div>
        </section>

        <div className="mt-4 grid gap-4 xl:grid-cols-[330px_1fr_300px]">
          <aside className="space-y-4">
            <div className="rounded-[1.6rem] border border-white/10 bg-slate-900/75 p-4 backdrop-blur-xl">
              <label className="block text-[10px] font-black uppercase tracking-[0.24em] text-slate-400">Nome deck</label>
              <input
                value={deckName}
                onChange={(event) => setDeckName(event.target.value)}
                className="mt-2 w-full rounded-2xl border border-slate-700 bg-slate-950/70 px-3 py-2 text-sm font-bold text-white outline-none focus:border-cyan-300"
              />

              <div className="mt-4 rounded-2xl border border-cyan-300/20 bg-cyan-300/10 p-3">
                <div className="flex items-center gap-2 text-xs font-black uppercase tracking-[0.18em] text-cyan-100">
                  <Crown size={15} />
                  Leader
                </div>
                {leader ? (
                  <div className="mt-3 flex items-center gap-3">
                    <CardImage src={leader.image_url} cardId={leader.card_id} alt={leader.name || leader.card_id} className="h-20 w-14 shrink-0 overflow-hidden rounded-xl bg-slate-950" />
                    <div className="min-w-0">
                      <p className="truncate text-sm font-black text-white">{leader.name}</p>
                      <p className="text-[10px] uppercase tracking-[0.18em] text-slate-400">{displayCardId(leader.card_id)}</p>
                      <p className="text-xs text-cyan-100">{leader.card_color || 'Colore non letto'}</p>
                    </div>
                  </div>
                ) : (
                  <p className="mt-3 text-sm text-slate-400">Scegli un Leader dalla ricerca.</p>
                )}
              </div>

              <div className="mt-4 grid grid-cols-2 gap-2 text-center">
                <div className="rounded-2xl border border-white/10 bg-white/[0.055] p-3">
                  <p className="text-[10px] uppercase tracking-[0.2em] text-slate-400">Main</p>
                  <p className="mt-1 text-2xl font-black text-white">{mainCount}/50</p>
                </div>
                <div className="rounded-2xl border border-white/10 bg-white/[0.055] p-3">
                  <p className="text-[10px] uppercase tracking-[0.2em] text-slate-400">DON</p>
                  <p className="mt-1 text-2xl font-black text-white">10</p>
                </div>
              </div>

              <button
                onClick={saveCurrentDeck}
                className="mt-4 flex w-full items-center justify-center gap-2 rounded-2xl bg-cyan-300 px-4 py-3 text-sm font-black text-slate-950 shadow-lg transition hover:scale-[1.01]"
              >
                <Save size={16} />
                Salva deck
              </button>
            </div>

            <div className="rounded-[1.6rem] border border-white/10 bg-slate-900/75 p-4 backdrop-blur-xl">
              <p className="text-[10px] font-black uppercase tracking-[0.24em] text-slate-400">Deck salvati</p>
              <div className="mt-3 space-y-2">
                {savedDecks.length === 0 ? (
                  <p className="rounded-2xl border border-dashed border-slate-700 p-3 text-sm text-slate-400">Nessun deck salvato.</p>
                ) : savedDecks.map(deck => (
                  <div key={deck.id} className="flex items-center gap-2 rounded-2xl border border-slate-700 bg-slate-950/60 p-2">
                    <button onClick={() => loadDeck(deck)} className="min-w-0 flex-1 text-left">
                      <p className="truncate text-sm font-black text-white">{deck.name}</p>
                      <p className="text-[10px] text-slate-500">{deck.cards.reduce((sum, card) => sum + card.quantity, 0)}/50 carte</p>
                    </button>
                    <button onClick={() => deleteDeck(deck.id)} className="grid h-9 w-9 place-items-center rounded-xl text-rose-200 hover:bg-rose-400/10" aria-label="Elimina deck">
                      <Trash2 size={15} />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          </aside>

          <section className="rounded-[1.6rem] border border-white/10 bg-slate-900/75 p-4 backdrop-blur-xl">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
                <input
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Cerca carta per deck"
                  className="w-full rounded-2xl border border-slate-700 bg-slate-950/70 px-10 py-3 text-sm text-white outline-none focus:border-cyan-300"
                />
              </div>
              <div className="grid grid-cols-2 rounded-2xl border border-slate-700 bg-slate-950/60 p-1 text-xs font-black">
                <button onClick={() => setActiveSource('collection')} className={`rounded-xl px-3 py-2 ${activeSource === 'collection' ? 'bg-cyan-300 text-slate-950' : 'text-slate-400'}`}>Mie</button>
                <button onClick={() => setActiveSource('catalog')} className={`rounded-xl px-3 py-2 ${activeSource === 'catalog' ? 'bg-cyan-300 text-slate-950' : 'text-slate-400'}`}>Catalogo</button>
              </div>
            </div>

            <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
              {loadingSearch ? (
                <p className="col-span-full rounded-2xl border border-slate-700 p-4 text-sm text-slate-400">Ricerca...</p>
              ) : availableCards.map(card => {
                const isLeader = (card.card_type || '').toLowerCase().includes('leader')
                return (
                  <div key={`${card.card_id}-${activeSource}`} className="rounded-2xl border border-slate-700 bg-slate-950/70 p-2">
                    <CardImage src={card.image_url} cardId={card.card_id} alt={card.name || card.card_id} className="aspect-[3/4] overflow-hidden rounded-xl bg-slate-900" />
                    <p className="mt-2 truncate text-xs font-black text-white">{card.name}</p>
                    <p className="text-[10px] text-slate-500">{displayCardId(card.card_id)}</p>
                    <div className="mt-2 grid grid-cols-2 gap-1">
                      <button
                        onClick={() => addMainCard(card)}
                        className="flex items-center justify-center gap-1 rounded-xl bg-cyan-300 px-2 py-2 text-[10px] font-black text-slate-950 disabled:opacity-40"
                        disabled={isLeader || mainCount >= 50}
                      >
                        <Plus size={13} />
                        Main
                      </button>
                      <button
                        onClick={() => setAsLeader(card)}
                        className="flex items-center justify-center gap-1 rounded-xl border border-amber-200/40 bg-amber-200/12 px-2 py-2 text-[10px] font-black text-amber-100"
                      >
                        <Crown size={13} />
                        Lead
                      </button>
                    </div>
                  </div>
                )
              })}
            </div>

            <div className="mt-5">
              <div className="flex items-center justify-between">
                <p className="text-[10px] font-black uppercase tracking-[0.24em] text-slate-400">Lista deck</p>
                <button onClick={() => setDeckCards([])} className="text-xs font-bold text-rose-200 hover:text-rose-100">Svuota</button>
              </div>
              <div className="mt-2 max-h-[430px] space-y-2 overflow-y-auto pr-1">
                {deckCards.length === 0 ? (
                  <p className="rounded-2xl border border-dashed border-slate-700 p-4 text-sm text-slate-400">Aggiungi carte al deck principale.</p>
                ) : deckCards.map(card => {
                  const badCopy = (baseCounts[baseCardId(card.card_id)] || 0) > 4
                  const badColor = offColor.some(item => item.card_id === card.card_id)
                  return (
                    <div key={card.card_id} className={`flex items-center gap-3 rounded-2xl border p-2 ${badCopy || badColor ? 'border-rose-300/35 bg-rose-300/10' : 'border-slate-700 bg-slate-950/60'}`}>
                      <CardImage src={card.image_url} cardId={card.card_id} alt={card.name || card.card_id} className="h-16 w-11 shrink-0 overflow-hidden rounded-lg bg-slate-900" />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-black text-white">{card.name}</p>
                        <p className="text-[10px] text-slate-500">{displayCardId(card.card_id)} · {card.card_color || '-'}</p>
                      </div>
                      <div className="flex items-center gap-2">
                        <button onClick={() => removeMainCard(card.card_id)} className="grid h-8 w-8 place-items-center rounded-xl border border-slate-700 text-slate-200">-</button>
                        <span className="w-5 text-center text-sm font-black text-white">{card.quantity}</span>
                        <button onClick={() => addMainCard(card)} className="grid h-8 w-8 place-items-center rounded-xl bg-cyan-300 text-slate-950">+</button>
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          </section>

          <aside className="space-y-4">
            <div className="rounded-[1.6rem] border border-white/10 bg-slate-900/75 p-4 backdrop-blur-xl">
              <div className="flex items-center gap-2 text-[10px] font-black uppercase tracking-[0.24em] text-cyan-200">
                <BookOpenCheck size={15} />
                Controlli
              </div>
              <div className="mt-3 space-y-2 text-sm">
                {[
                  [Boolean(leader), '1 Leader scelto'],
                  [mainCount === 50, '50 carte main deck'],
                  [overLimit.length === 0, 'Massimo 4 copie per numero'],
                  [offColor.length === 0, 'Colori compatibili'],
                ].map(([ok, label]) => (
                  <div key={String(label)} className={`flex items-center gap-2 rounded-2xl border px-3 py-2 ${ok ? 'border-emerald-300/20 bg-emerald-300/10 text-emerald-100' : 'border-slate-700 bg-slate-950/60 text-slate-400'}`}>
                    {ok ? <CheckCircle2 size={15} /> : <XCircle size={15} />}
                    {label}
                  </div>
                ))}
              </div>
            </div>

            <div className="rounded-[1.6rem] border border-white/10 bg-slate-900/75 p-4 backdrop-blur-xl">
              <div className="flex items-center gap-2 text-[10px] font-black uppercase tracking-[0.24em] text-amber-200">
                <CopyPlus size={15} />
                Meta OP16
              </div>
              <p className="mt-2 text-xs leading-5 text-slate-400">Deck più usati negli ultimi eventi tracciati da Limitless.</p>
              <div className="mt-3 space-y-2">
                {popularDecks.map(([name, share], index) => (
                  <div key={name} className="flex items-center justify-between gap-2 rounded-2xl border border-slate-700 bg-slate-950/60 px-3 py-2">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-black text-white">{index + 1}. {name}</p>
                    </div>
                    <span className="rounded-full bg-cyan-300/12 px-2 py-1 text-xs font-black text-cyan-100">{share}</span>
                  </div>
                ))}
              </div>
              <a href="https://onepiece.limitlesstcg.com/decks" target="_blank" rel="noreferrer" className="mt-3 block rounded-2xl border border-cyan-300/25 bg-cyan-300/10 px-3 py-2 text-center text-xs font-black text-cyan-100">
                Apri fonte meta
              </a>
            </div>
          </aside>
        </div>
      </main>
    </div>
  )
}
