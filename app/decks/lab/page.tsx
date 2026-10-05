'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { ArrowLeft, Beaker, Check, Filter, Minus, PackageCheck, Plus, RefreshCw, Save, Search, ShoppingBag, Trash2, X } from 'lucide-react'
import CardImage from '@/app/components/CardImage'
import Sidebar from '@/app/components/Sidebar'
import Topbar from '@/app/components/Topbar'
import { baseDeckCardId, buildOwnedQuantityByBase } from '@/lib/deckAvailability'
import { supabase } from '@/lib/supabase'
import { validateUserText } from '@/lib/textModeration'

type CatalogCard = {
  card_id: string
  name: string
  image_url: string | null
  rarity: string | null
  card_color: string | null
  card_type: string | null
  card_cost: number | null
  card_power: number | null
}

type ExperimentCard = CatalogCard & {
  quantity: number
  owned_quantity: number
}

type ExperimentDeck = {
  id: string
  name: string
  cards: ExperimentCard[]
  updatedAt: string
}

type DeckRow = {
  id: string
  name: string
  cards: ExperimentCard[] | null
  updated_at: string | null
}

type SearchCard = {
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
}

const colors = ['red', 'green', 'blue', 'purple', 'black', 'yellow']
const colorLabels: Record<string, string> = {
  red: 'Rosso', green: 'Verde', blue: 'Blu', purple: 'Viola', black: 'Nero', yellow: 'Giallo'
}

const numberOrNull = (value: unknown) => {
  if (value === null || value === undefined || value === '') return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

const toCatalogCard = (card: SearchCard): CatalogCard => ({
  card_id: String(card.card_id ?? card.card_set_id ?? card.id ?? ''),
  name: card.card_name || card.name || 'Carta',
  image_url: card.card_image || card.image_url || null,
  rarity: card.rarity || null,
  card_color: card.card_color || null,
  card_type: card.card_type || null,
  card_cost: numberOrNull(card.card_cost),
  card_power: numberOrNull(card.card_power),
})

const displayCardId = (value: string) => value
  .replace(/_p\d+$/i, '')
  .replace(/^((?:OP|ST|EB|PRB|SP|EX|CP)\d{2}-\d{3}|P-\d{3}|DON-\d{3})p\d+$/i, '$1')

const parseCardColors = (value?: string | null) => {
  const normalized = (value || '').toLowerCase()
  return colors.filter(color => normalized.includes(color))
}

const isDon = (card: CatalogCard) => {
  const normalized = `${card.card_id} ${card.name} ${card.card_type}`.toLowerCase().replace(/[^a-z0-9]/g, '')
  return normalized.startsWith('don') || normalized.includes('doncard')
}

export default function ExperimentalDecksPage() {
  const router = useRouter()
  const [userId, setUserId] = useState<string | null>(null)
  const [plans, setPlans] = useState<ExperimentDeck[]>([])
  const [activePlan, setActivePlan] = useState<ExperimentDeck | null>(null)
  const [collectionCards, setCollectionCards] = useState<Array<{ card_id: string; quantity: number }>>([])
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<CatalogCard[]>([])
  const [searching, setSearching] = useState(false)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState('')
  const [showFilters, setShowFilters] = useState(false)
  const [colorFilter, setColorFilter] = useState('all')
  const [costFilter, setCostFilter] = useState('all')
  const [rarityFilter, setRarityFilter] = useState('all')
  const [typeFilter, setTypeFilter] = useState('all')
  const searchRun = useRef(0)

  useEffect(() => {
    const load = async () => {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session?.user) {
        router.push('/')
        return
      }

      setUserId(session.user.id)
      const [deckResponse, collectionResponse] = await Promise.all([
        supabase
          .from('user_decks')
          .select('id, name, cards, updated_at')
          .eq('user_id', session.user.id)
          .eq('source', 'experimental')
          .order('updated_at', { ascending: false }),
        supabase
          .from('user_cards')
          .select('card_id, quantity')
          .eq('user_id', session.user.id),
      ])

      const loadedPlans = (deckResponse.data || []).map(row => {
        const value = row as DeckRow
        return {
          id: value.id,
          name: value.name || 'Deck sperimentale',
          cards: Array.isArray(value.cards) ? value.cards.map(card => ({
            ...card,
            quantity: Math.max(1, Number(card.quantity || 1)),
            owned_quantity: Math.max(0, Number(card.owned_quantity || 0)),
          })) : [],
          updatedAt: value.updated_at || new Date().toISOString(),
        }
      })

      setPlans(loadedPlans)
      setCollectionCards((collectionResponse.data || []).map(card => ({
        card_id: String(card.card_id || ''),
        quantity: Math.max(0, Number(card.quantity || 0)),
      })))
    }

    void load()
  }, [router])

  useEffect(() => {
    const trimmed = query.trim()
    if (!trimmed) {
      searchRun.current += 1
      return
    }

    const timer = window.setTimeout(async () => {
      const run = ++searchRun.current
      setSearching(true)
      try {
        const response = await fetch(`/api/cards/search?q=${encodeURIComponent(trimmed)}`)
        const data = await response.json()
        if (run !== searchRun.current) return
        setResults((Array.isArray(data) ? data : [])
          .map((card: SearchCard) => toCatalogCard(card))
          .filter(card => card.card_id && !isDon(card)))
      } catch {
        if (run === searchRun.current) setResults([])
      } finally {
        if (run === searchRun.current) setSearching(false)
      }
    }, 220)

    return () => window.clearTimeout(timer)
  }, [query])

  const collectionByBase = useMemo(() => buildOwnedQuantityByBase(collectionCards), [collectionCards])

  const availableRarities = useMemo(() => [...new Set(results.map(card => card.rarity).filter(Boolean) as string[])].sort(), [results])
  const availableTypes = useMemo(() => [...new Set(results.map(card => card.card_type).filter(Boolean) as string[])].sort(), [results])

  const filteredResults = useMemo(() => results.filter(card => {
    if (colorFilter !== 'all' && !parseCardColors(card.card_color).includes(colorFilter)) return false
    if (costFilter !== 'all') {
      const cost = card.card_cost ?? -1
      if (costFilter === '7+' ? cost < 7 : cost !== Number(costFilter)) return false
    }
    if (rarityFilter !== 'all' && card.rarity !== rarityFilter) return false
    if (typeFilter !== 'all' && card.card_type !== typeFilter) return false
    return true
  }), [results, colorFilter, costFilter, rarityFilter, typeFilter])

  const stats = useMemo(() => {
    if (!activePlan) return { required: 0, owned: 0, missing: 0, complete: 0 }
    const required = activePlan.cards.reduce((sum, card) => sum + card.quantity, 0)
    const owned = activePlan.cards.reduce((sum, card) => sum + Math.min(card.quantity, card.owned_quantity), 0)
    return {
      required,
      owned,
      missing: Math.max(0, required - owned),
      complete: required === 0 ? 0 : Math.round((owned / required) * 100),
    }
  }, [activePlan])

  const createPlan = () => {
    setActivePlan({
      id: `experimental-${Date.now()}`,
      name: 'Nuovo deck sperimentale',
      cards: [],
      updatedAt: new Date().toISOString(),
    })
    setQuery('')
    setResults([])
    setMessage('')
  }

  const updateActiveCards = (cards: ExperimentCard[]) => {
    setActivePlan(current => current ? { ...current, cards, updatedAt: new Date().toISOString() } : current)
  }

  const addCard = (card: CatalogCard) => {
    if (!activePlan) return
    const existing = activePlan.cards.find(item => item.card_id === card.card_id)
    if (existing) {
      updateActiveCards(activePlan.cards.map(item => item.card_id === card.card_id
        ? { ...item, quantity: Math.min(4, item.quantity + 1) }
        : item))
      return
    }

    const owned = collectionByBase[baseDeckCardId(card.card_id)] || 0
    updateActiveCards([...activePlan.cards, { ...card, quantity: 1, owned_quantity: owned }])
  }

  const changeRequired = (cardId: string, delta: number) => {
    if (!activePlan) return
    updateActiveCards(activePlan.cards.map(card => card.card_id === cardId
      ? { ...card, quantity: Math.max(1, Math.min(4, card.quantity + delta)) }
      : card))
  }

  const changeOwned = (cardId: string, delta: number) => {
    if (!activePlan) return
    updateActiveCards(activePlan.cards.map(card => card.card_id === cardId
      ? { ...card, owned_quantity: Math.max(0, Math.min(card.quantity, card.owned_quantity + delta)) }
      : card))
  }

  const syncCollection = () => {
    if (!activePlan) return
    updateActiveCards(activePlan.cards.map(card => ({
      ...card,
      owned_quantity: Math.min(card.quantity, collectionByBase[baseDeckCardId(card.card_id)] || 0),
    })))
    setMessage('Copie aggiornate dalla collezione.')
  }

  const savePlan = async () => {
    if (!activePlan || !userId || saving) return
    const cleanName = activePlan.name.trim() || 'Deck sperimentale'
    const moderation = validateUserText(cleanName)
    if (!moderation.ok) {
      setMessage(moderation.message || 'Nome non valido.')
      return
    }

    setSaving(true)
    setMessage('')
    const updatedAt = new Date().toISOString()
    const saved = { ...activePlan, name: cleanName, updatedAt }
    const { error } = await supabase.from('user_decks').upsert({
      id: saved.id,
      user_id: userId,
      name: saved.name,
      leader: null,
      cards: saved.cards,
      source: 'experimental',
      source_url: null,
      player: null,
      placement: null,
      meta_total: String(stats.required),
      updated_at: updatedAt,
    }, { onConflict: 'user_id,id' })

    if (error) {
      setMessage('Non sono riuscito a salvare il progetto.')
    } else {
      setActivePlan(saved)
      setPlans(current => [saved, ...current.filter(plan => plan.id !== saved.id)])
      setMessage('Progetto salvato.')
    }
    setSaving(false)
  }

  const deletePlan = async (plan: ExperimentDeck) => {
    if (!userId || !window.confirm(`Eliminare "${plan.name}"?`)) return
    await supabase.from('user_decks').delete().eq('user_id', userId).eq('id', plan.id).eq('source', 'experimental')
    setPlans(current => current.filter(item => item.id !== plan.id))
    if (activePlan?.id === plan.id) setActivePlan(null)
  }

  const resetFilters = () => {
    setColorFilter('all')
    setCostFilter('all')
    setRarityFilter('all')
    setTypeFilter('all')
  }

  return (
    <div className="min-h-screen overflow-x-hidden pb-32 pt-14 text-white onepiece-wave-bg onepiece-clouds sm:pb-36">
      <Topbar />
      <Sidebar activePage="decks" />

      <main className="mx-auto max-w-7xl px-3 py-4 sm:px-6 lg:px-8">
        <header className="flex items-center gap-3">
          <button onClick={() => router.push('/decks')} className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl border border-white/10 bg-slate-950/55 text-slate-200 active:scale-95" aria-label="Torna ai deck">
            <ArrowLeft size={19} />
          </button>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 text-amber-200"><Beaker size={18} /><span className="text-[10px] font-black uppercase tracking-[0.24em]">Deck Lab</span></div>
            <h1 className="truncate text-xl font-black sm:text-3xl">Deck sperimentali</h1>
          </div>
          <button onClick={createPlan} className="flex items-center gap-2 rounded-2xl bg-cyan-300 px-3 py-2.5 text-xs font-black text-slate-950 shadow-lg active:scale-95 sm:px-4 sm:text-sm">
            <Plus size={17} />Nuovo
          </button>
        </header>

        {!activePlan ? (
          <section className="mt-4">
            {plans.length === 0 ? (
              <div className="rounded-[1.75rem] border border-dashed border-white/15 bg-slate-900/70 p-7 text-center backdrop-blur-xl">
                <div className="mx-auto grid h-16 w-16 place-items-center rounded-3xl bg-amber-300/12 text-amber-200"><Beaker size={31} /></div>
                <h2 className="mt-4 text-xl font-black">Prova combinazioni senza vincoli</h2>
                <p className="mx-auto mt-2 max-w-lg text-sm leading-6 text-slate-300">Imposta le copie che vuoi, segna quelle che possiedi e usa la lista delle mancanti mentre completi il deck.</p>
                <button onClick={createPlan} className="mt-5 rounded-2xl bg-cyan-300 px-5 py-3 text-sm font-black text-slate-950 active:scale-95">Crea il primo progetto</button>
              </div>
            ) : (
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                {plans.map(plan => {
                  const required = plan.cards.reduce((sum, card) => sum + card.quantity, 0)
                  const owned = plan.cards.reduce((sum, card) => sum + Math.min(card.quantity, card.owned_quantity), 0)
                  const progress = required ? Math.round((owned / required) * 100) : 0
                  return (
                    <article key={plan.id} className="rounded-[1.55rem] border border-white/10 bg-slate-900/72 p-3 backdrop-blur-xl">
                      <button onClick={() => setActivePlan(plan)} className="w-full text-left">
                        <div className="flex items-center gap-3">
                          <div className="grid h-16 w-16 shrink-0 place-items-center rounded-2xl bg-amber-300/12 text-amber-200"><Beaker size={28} /></div>
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-base font-black">{plan.name}</p>
                            <p className="mt-1 text-xs text-slate-400">{plan.cards.length} carte uniche · {Math.max(0, required - owned)} mancanti</p>
                            <div className="mt-3 h-2 overflow-hidden rounded-full bg-slate-800"><div className="h-full rounded-full bg-gradient-to-r from-cyan-300 to-emerald-300" style={{ width: `${progress}%` }} /></div>
                            <p className="mt-1 text-[10px] font-black text-cyan-100">{owned}/{required} · {progress}%</p>
                          </div>
                        </div>
                      </button>
                      <div className="mt-3 flex gap-2">
                        <button onClick={() => setActivePlan(plan)} className="flex-1 rounded-xl bg-cyan-300/12 px-3 py-2 text-xs font-black text-cyan-100">Apri</button>
                        <button onClick={() => void deletePlan(plan)} className="grid h-9 w-9 place-items-center rounded-xl bg-rose-400/10 text-rose-200" aria-label="Elimina progetto"><Trash2 size={15} /></button>
                      </div>
                    </article>
                  )
                })}
              </div>
            )}
          </section>
        ) : (
          <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,1fr)_380px]">
            <section className="min-w-0 space-y-4">
              <div className="rounded-[1.6rem] border border-white/10 bg-slate-900/75 p-3 backdrop-blur-xl sm:p-4">
                <div className="flex items-center gap-2">
                  <input value={activePlan.name} onChange={event => setActivePlan({ ...activePlan, name: event.target.value })} className="min-w-0 flex-1 rounded-2xl border border-white/10 bg-slate-950/60 px-3 py-3 text-sm font-black outline-none focus:border-cyan-300" aria-label="Nome deck sperimentale" />
                  <button onClick={() => void savePlan()} disabled={saving} className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-cyan-300 text-slate-950 disabled:opacity-50" aria-label="Salva"><Save size={18} /></button>
                  <button onClick={() => setActivePlan(null)} className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl border border-white/10 bg-slate-950/60" aria-label="Chiudi"><X size={18} /></button>
                </div>
                {message ? <p className="mt-2 rounded-xl bg-white/[0.06] px-3 py-2 text-xs font-bold text-slate-200">{message}</p> : null}
              </div>

              <div className="rounded-[1.6rem] border border-white/10 bg-slate-900/75 p-3 backdrop-blur-xl sm:p-4">
                <div className="flex gap-2">
                  <label className="relative min-w-0 flex-1">
                    <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
                    <input value={query} onChange={event => {
                      const value = event.target.value
                      setQuery(value)
                      if (!value.trim()) {
                        searchRun.current += 1
                        setResults([])
                        setSearching(false)
                      }
                    }} placeholder="Cerca nome o codice carta" className="w-full rounded-2xl border border-slate-700 bg-slate-950/70 py-3 pl-10 pr-3 text-base outline-none focus:border-cyan-300" />
                  </label>
                  <button onClick={() => setShowFilters(value => !value)} className={`relative grid h-12 w-12 shrink-0 place-items-center rounded-2xl border active:scale-95 ${showFilters || colorFilter !== 'all' || costFilter !== 'all' || rarityFilter !== 'all' || typeFilter !== 'all' ? 'border-amber-200/40 bg-amber-200/14 text-amber-100' : 'border-slate-700 bg-slate-950/70 text-slate-300'}`} aria-label="Filtri"><Filter size={18} /></button>
                </div>

                {showFilters ? (
                  <div className="mt-3 grid grid-cols-2 gap-2 rounded-2xl border border-white/10 bg-slate-950/45 p-3 sm:grid-cols-4">
                    <select value={colorFilter} onChange={event => setColorFilter(event.target.value)} className="rounded-xl border border-slate-700 bg-slate-900 px-2 py-2.5 text-xs font-bold"><option value="all">Tutti i colori</option>{colors.map(color => <option key={color} value={color}>{colorLabels[color]}</option>)}</select>
                    <select value={costFilter} onChange={event => setCostFilter(event.target.value)} className="rounded-xl border border-slate-700 bg-slate-900 px-2 py-2.5 text-xs font-bold"><option value="all">Tutti i costi</option>{[0,1,2,3,4,5,6].map(cost => <option key={cost} value={cost}>Costo {cost}</option>)}<option value="7+">Costo 7+</option></select>
                    <select value={rarityFilter} onChange={event => setRarityFilter(event.target.value)} className="rounded-xl border border-slate-700 bg-slate-900 px-2 py-2.5 text-xs font-bold"><option value="all">Tutte le rarità</option>{availableRarities.map(rarity => <option key={rarity} value={rarity}>{rarity}</option>)}</select>
                    <select value={typeFilter} onChange={event => setTypeFilter(event.target.value)} className="rounded-xl border border-slate-700 bg-slate-900 px-2 py-2.5 text-xs font-bold"><option value="all">Tutti i tipi</option>{availableTypes.map(type => <option key={type} value={type}>{type}</option>)}</select>
                    <button onClick={resetFilters} className="col-span-2 rounded-xl border border-slate-700 px-3 py-2 text-xs font-black text-slate-300 sm:col-span-4">Azzera filtri</button>
                  </div>
                ) : null}

                <div className="mt-3">
                  {searching ? <p className="rounded-2xl border border-slate-700 p-4 text-sm text-slate-400">Cerco nel catalogo...</p> : !query.trim() ? <p className="rounded-2xl border border-dashed border-slate-700 p-4 text-sm text-slate-400">Cerca una carta per nome o codice, poi restringi i risultati con i filtri.</p> : filteredResults.length === 0 ? <p className="rounded-2xl border border-dashed border-slate-700 p-4 text-sm text-slate-400">Nessuna carta corrisponde alla ricerca e ai filtri.</p> : (
                    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-4">
                      {filteredResults.map(card => {
                        const planned = activePlan.cards.find(item => item.card_id === card.card_id)?.quantity || 0
                        return (
                          <button key={card.card_id} onClick={() => addCard(card)} className="relative overflow-hidden rounded-2xl border border-slate-700 bg-slate-950/65 p-2 text-left transition hover:border-cyan-300/50 active:scale-[0.98]">
                            <CardImage src={card.image_url} cardId={card.card_id} alt={card.name} className="aspect-[5/7] w-full overflow-hidden rounded-xl bg-slate-900" />
                            {planned > 0 ? <span className="absolute right-3 top-3 rounded-full bg-cyan-300 px-2 py-1 text-[10px] font-black text-slate-950">x{planned}</span> : null}
                            <p className="mt-2 truncate text-xs font-black">{card.name}</p>
                            <div className="mt-1 flex items-center justify-between gap-1 text-[10px] text-slate-400"><span>{displayCardId(card.card_id)}</span><span>{card.card_cost == null ? '-' : `Costo ${card.card_cost}`}</span></div>
                          </button>
                        )
                      })}
                    </div>
                  )}
                </div>
              </div>
            </section>

            <aside className="min-w-0 lg:sticky lg:top-20 lg:self-start">
              <div className="rounded-[1.6rem] border border-white/10 bg-[#173842]/95 p-3 shadow-2xl backdrop-blur-xl sm:p-4">
                <div className="flex items-center justify-between gap-2">
                  <div><p className="text-xs font-black uppercase tracking-[0.18em] text-cyan-200">Avanzamento</p><p className="mt-1 text-2xl font-black">{stats.complete}%</p></div>
                  <button onClick={syncCollection} className="flex items-center gap-1.5 rounded-xl border border-cyan-300/25 bg-cyan-300/10 px-2.5 py-2 text-[10px] font-black text-cyan-100"><RefreshCw size={13} />Sincronizza</button>
                </div>
                <div className="mt-3 h-3 overflow-hidden rounded-full bg-slate-950/70"><div className="h-full rounded-full bg-gradient-to-r from-cyan-300 via-emerald-300 to-amber-200 transition-all" style={{ width: `${stats.complete}%` }} /></div>
                <div className="mt-3 grid grid-cols-3 gap-2 text-center">
                  <div className="rounded-xl bg-white/[0.06] p-2"><p className="text-lg font-black">{stats.required}</p><p className="text-[9px] font-bold uppercase text-slate-400">Copie richieste</p></div>
                  <div className="rounded-xl bg-emerald-300/10 p-2"><p className="text-lg font-black text-emerald-100">{stats.owned}</p><p className="text-[9px] font-bold uppercase text-emerald-200/70">Possedute</p></div>
                  <div className="rounded-xl bg-rose-400/10 p-2"><p className="text-lg font-black text-rose-100">{stats.missing}</p><p className="text-[9px] font-bold uppercase text-rose-200/70">Mancanti</p></div>
                </div>

                <div className="mt-4 flex items-center gap-2"><ShoppingBag size={15} className="text-amber-200" /><p className="text-sm font-black">Lista carte</p></div>
                <div className="mt-2 max-h-[58dvh] space-y-2 overflow-y-auto pr-1">
                  {activePlan.cards.length === 0 ? <p className="rounded-2xl border border-dashed border-slate-600 p-4 text-sm text-slate-400">Aggiungi carte dalla ricerca.</p> : activePlan.cards
                    .slice()
                    .sort((a, b) => (a.quantity - a.owned_quantity) === 0 ? 1 : (b.quantity - b.owned_quantity) === 0 ? -1 : (b.quantity - b.owned_quantity) - (a.quantity - a.owned_quantity))
                    .map(card => {
                      const missing = Math.max(0, card.quantity - card.owned_quantity)
                      return (
                        <article key={card.card_id} className={`rounded-2xl border p-2 ${missing === 0 ? 'border-emerald-300/25 bg-emerald-300/[0.06]' : 'border-rose-300/20 bg-slate-950/55'}`}>
                          <div className="flex gap-2">
                            <CardImage src={card.image_url} cardId={card.card_id} alt={card.name} className="h-20 w-14 shrink-0 overflow-hidden rounded-xl bg-slate-900" />
                            <div className="min-w-0 flex-1">
                              <div className="flex items-start justify-between gap-1"><div className="min-w-0"><p className="truncate text-xs font-black">{card.name}</p><p className="text-[9px] text-slate-400">{displayCardId(card.card_id)}</p></div><button onClick={() => updateActiveCards(activePlan.cards.filter(item => item.card_id !== card.card_id))} className="grid h-7 w-7 shrink-0 place-items-center rounded-lg text-rose-200" aria-label={`Rimuovi ${card.name}`}><Trash2 size={13} /></button></div>
                              <div className="mt-2 grid grid-cols-2 gap-2">
                                <div><p className="mb-1 text-[9px] font-bold uppercase text-slate-500">Nel deck</p><div className="flex items-center justify-between rounded-lg bg-slate-900 p-1"><button onClick={() => changeRequired(card.card_id, -1)} className="grid h-6 w-6 place-items-center rounded-md bg-white/[0.06]"><Minus size={11} /></button><span className="text-xs font-black">{card.quantity}</span><button onClick={() => changeRequired(card.card_id, 1)} className="grid h-6 w-6 place-items-center rounded-md bg-white/[0.06]"><Plus size={11} /></button></div></div>
                                <div><p className="mb-1 text-[9px] font-bold uppercase text-slate-500">Possedute</p><div className="flex items-center justify-between rounded-lg bg-slate-900 p-1"><button onClick={() => changeOwned(card.card_id, -1)} className="grid h-6 w-6 place-items-center rounded-md bg-white/[0.06]"><Minus size={11} /></button><span className="text-xs font-black text-emerald-100">{card.owned_quantity}</span><button onClick={() => changeOwned(card.card_id, 1)} className="grid h-6 w-6 place-items-center rounded-md bg-emerald-300/12 text-emerald-100"><Plus size={11} /></button></div></div>
                              </div>
                              <p className={`mt-2 flex items-center gap-1 text-[10px] font-black ${missing === 0 ? 'text-emerald-200' : 'text-rose-200'}`}>{missing === 0 ? <><Check size={11} />Completa</> : <><PackageCheck size={11} />Mancano x{missing}</>}</p>
                            </div>
                          </div>
                        </article>
                      )
                    })}
                </div>
              </div>
            </aside>
          </div>
        )}
      </main>
    </div>
  )
}
