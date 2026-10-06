'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { ArrowLeft, Beaker, ChevronDown, ChevronUp, Filter, Minus, Plus, RefreshCw, Save, Search, SlidersHorizontal, Sparkles, Trash2, X } from 'lucide-react'
import CardImage from '@/app/components/CardImage'
import Sidebar from '@/app/components/Sidebar'
import Topbar from '@/app/components/Topbar'
import { baseDeckCardId, buildOwnedQuantityByBase, reconcileDeckOwnedQuantities } from '@/lib/deckAvailability'
import { DECK_SIZE, hasUnlimitedDeckCopies, maxDeckCopies } from '@/lib/deckRules'
import { recommendDeckCard, type RecommendationCard, type RecommendationDeck } from '@/lib/deckRecommendation'
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

type ExperimentCard = CatalogCard & { quantity: number; owned_quantity: number }
type ExperimentDeck = { id: string; name: string; cards: ExperimentCard[]; updatedAt: string }
type DeckRow = { id: string; name: string; cards: ExperimentCard[] | null; updated_at: string | null }
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
type DeckFilter = 'all' | 'missing' | 'complete'
type OwnershipFilter = 'all' | 'owned' | 'missing'

const colors = ['red', 'green', 'blue', 'purple', 'black', 'yellow']
const colorLabels: Record<string, string> = { red: 'Rosso', green: 'Verde', blue: 'Blu', purple: 'Viola', black: 'Nero', yellow: 'Giallo' }

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
const displayCardId = (value: string) => value.replace(/_p\d+$/i, '').replace(/^((?:OP|ST|EB|PRB|SP|EX|CP)\d{2}-\d{3}|P-\d{3}|DON-\d{3})p\d+$/i, '$1')
const parseCardColors = (value?: string | null) => {
  const normalized = (value || '').toLowerCase()
  return colors.filter(color => normalized.includes(color))
}
const isDon = (card: CatalogCard) => {
  const normalized = `${card.card_id} ${card.name} ${card.card_type}`.toLowerCase().replace(/[^a-z0-9]/g, '')
  return normalized.startsWith('don') || normalized.includes('doncard')
}
const isUnlimitedCopiesCard = (card: Pick<CatalogCard, 'card_id'>) => hasUnlimitedDeckCopies(card.card_id)
const maxCopiesForCard = (card: Pick<CatalogCard, 'card_id'>) => maxDeckCopies(card.card_id)

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
  const [selectedCardId, setSelectedCardId] = useState<string | null>(null)
  const [searchExpanded, setSearchExpanded] = useState(false)
  const [showFilters, setShowFilters] = useState(false)
  const [deckFilter, setDeckFilter] = useState<DeckFilter>('all')
  const [ownershipFilter, setOwnershipFilter] = useState<OwnershipFilter>('all')
  const [colorFilter, setColorFilter] = useState('all')
  const [costFilter, setCostFilter] = useState('all')
  const [powerFilter, setPowerFilter] = useState('all')
  const [rarityFilter, setRarityFilter] = useState('all')
  const [typeFilter, setTypeFilter] = useState('all')
  const [metaDecks, setMetaDecks] = useState<RecommendationDeck[]>([])
  const [metaLoading, setMetaLoading] = useState(false)
  const metaLoaded = useRef(false)
  const searchRun = useRef(0)

  useEffect(() => {
    const load = async () => {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session?.user) { router.push('/'); return }
      setUserId(session.user.id)
      const [deckResponse, collectionResponse] = await Promise.all([
        supabase.from('user_decks').select('id, name, cards, updated_at').eq('user_id', session.user.id).eq('source', 'experimental').order('updated_at', { ascending: false }),
        supabase.from('user_cards').select('card_id, quantity').eq('user_id', session.user.id),
      ])
      const normalizedCollection = (collectionResponse.data || []).map(card => ({ card_id: String(card.card_id || ''), quantity: Math.max(0, Number(card.quantity || 0)) }))
      setPlans((deckResponse.data || []).map(row => {
        const value = row as DeckRow
        return {
          id: value.id,
          name: value.name || 'Deck sperimentale',
          cards: reconcileDeckOwnedQuantities(Array.isArray(value.cards) ? value.cards.map(card => ({
            ...card,
            quantity: Math.max(1, Math.min(maxCopiesForCard(card), Number(card.quantity || 1))),
            owned_quantity: Math.max(0, Number(card.owned_quantity || 0)),
          })) : [], normalizedCollection),
          updatedAt: value.updated_at || new Date().toISOString(),
        }
      }))
      setCollectionCards(normalizedCollection)
    }
    void load()
  }, [router])

  useEffect(() => {
    const trimmed = query.trim()
    if (!trimmed) { searchRun.current += 1; return }
    const timer = window.setTimeout(async () => {
      const run = ++searchRun.current
      setSearching(true)
      try {
        const response = await fetch(`/api/cards/search?q=${encodeURIComponent(trimmed)}`)
        const data = await response.json()
        if (run !== searchRun.current) return
        setResults((Array.isArray(data) ? data : []).map((card: SearchCard) => toCatalogCard(card)).filter(card => card.card_id && !isDon(card)))
      } catch { if (run === searchRun.current) setResults([]) }
      finally { if (run === searchRun.current) setSearching(false) }
    }, 180)
    return () => window.clearTimeout(timer)
  }, [query])

  useEffect(() => {
    if (!activePlan?.cards.length || metaLoaded.current || metaLoading) return
    metaLoaded.current = true
    const loadMetaDecks = async () => {
      setMetaLoading(true)
      try {
        const response = await fetch('/api/decks/meta')
        const data = await response.json()
        setMetaDecks(Array.isArray(data?.decks) ? data.decks : [])
      } catch {
        setMetaDecks([])
      } finally {
        setMetaLoading(false)
      }
    }
    void loadMetaDecks()
  }, [activePlan?.cards.length, metaLoading])

  const collectionByBase = useMemo(() => buildOwnedQuantityByBase(collectionCards), [collectionCards])
  const totalRequired = activePlan?.cards.reduce((sum, card) => sum + card.quantity, 0) || 0
  const stats = useMemo(() => {
    if (!activePlan) return { required: 0, owned: 0, missing: 0, complete: 0, missingTypes: 0 }
    const required = activePlan.cards.reduce((sum, card) => sum + card.quantity, 0)
    const owned = activePlan.cards.reduce((sum, card) => sum + Math.min(card.quantity, card.owned_quantity), 0)
    return { required, owned, missing: Math.max(0, required - owned), complete: required ? Math.round((owned / required) * 100) : 0, missingTypes: activePlan.cards.filter(card => card.owned_quantity < card.quantity).length }
  }, [activePlan])
  const filteredDeckCards = useMemo(() => {
    if (!activePlan) return []
    return activePlan.cards.filter(card => deckFilter === 'all' || (deckFilter === 'missing' && card.owned_quantity < card.quantity) || (deckFilter === 'complete' && card.owned_quantity >= card.quantity)).sort((left, right) => {
      const leftMissing = left.quantity - left.owned_quantity
      const rightMissing = right.quantity - right.owned_quantity
      if (deckFilter === 'all' && Boolean(leftMissing) !== Boolean(rightMissing)) return rightMissing - leftMissing
      return (left.card_cost ?? 99) - (right.card_cost ?? 99) || left.name.localeCompare(right.name)
    })
  }, [activePlan, deckFilter])
  const selectedDeckCard = activePlan?.cards.find(card => card.card_id === selectedCardId) || null
  const recommendation = useMemo(() => recommendDeckCard(activePlan?.cards || [], metaDecks), [activePlan?.cards, metaDecks])
  const availableRarities = useMemo(() => [...new Set(results.map(card => card.rarity).filter(Boolean) as string[])].sort(), [results])
  const availableTypes = useMemo(() => [...new Set(results.map(card => card.card_type).filter(Boolean) as string[])].sort(), [results])
  const filteredResults = useMemo(() => results.filter(card => {
    const owned = collectionByBase[baseDeckCardId(card.card_id)] || 0
    if (ownershipFilter === 'owned' && owned === 0) return false
    if (ownershipFilter === 'missing' && owned > 0) return false
    if (colorFilter !== 'all' && !parseCardColors(card.card_color).includes(colorFilter)) return false
    if (costFilter !== 'all') { const cost = card.card_cost ?? -1; if (costFilter === '7+' ? cost < 7 : cost !== Number(costFilter)) return false }
    if (powerFilter !== 'all') { const power = card.card_power ?? -1; if (powerFilter === '8000+' ? power < 8000 : power !== Number(powerFilter)) return false }
    if (rarityFilter !== 'all' && card.rarity !== rarityFilter) return false
    if (typeFilter !== 'all' && card.card_type !== typeFilter) return false
    return true
  }), [results, collectionByBase, ownershipFilter, colorFilter, costFilter, powerFilter, rarityFilter, typeFilter])

  const createPlan = () => {
    setActivePlan({ id: `experimental-${Date.now()}`, name: 'Nuovo deck sperimentale', cards: [], updatedAt: new Date().toISOString() })
    setQuery(''); setResults([]); setMessage(''); setSelectedCardId(null); setSearchExpanded(true)
  }
  const updateActiveCards = (cards: ExperimentCard[], reconcile = true) => setActivePlan(current => current ? {
    ...current,
    cards: reconcile ? reconcileDeckOwnedQuantities(cards, collectionCards) : cards,
    updatedAt: new Date().toISOString(),
  } : current)
  const addCard = (card: CatalogCard) => {
    if (!activePlan || totalRequired >= DECK_SIZE) return
    const existing = activePlan.cards.find(item => item.card_id === card.card_id)
    if (existing) {
      const maxCopies = maxCopiesForCard(existing)
      if (existing.quantity >= maxCopies) return
      updateActiveCards(activePlan.cards.map(item => item.card_id === card.card_id ? { ...item, quantity: Math.min(maxCopies, item.quantity + 1) } : item))
      return
    }
    const owned = collectionByBase[baseDeckCardId(card.card_id)] || 0
    updateActiveCards([...activePlan.cards, { ...card, quantity: 1, owned_quantity: Math.min(1, owned) }])
  }
  const changeRequired = (cardId: string, delta: number) => {
    if (!activePlan) return
    updateActiveCards(activePlan.cards.map(card => {
      if (card.card_id !== cardId) return card
      const maxAllowed = Math.min(maxCopiesForCard(card), card.quantity + Math.max(0, DECK_SIZE - totalRequired))
      const quantity = Math.max(1, Math.min(maxAllowed, card.quantity + delta))
      return { ...card, quantity, owned_quantity: Math.min(card.owned_quantity, quantity) }
    }))
  }
  const changeOwned = (cardId: string, delta: number) => {
    if (!activePlan) return
    updateActiveCards(activePlan.cards.map(card => card.card_id === cardId ? { ...card, owned_quantity: Math.max(0, Math.min(card.quantity, card.owned_quantity + delta)) } : card), false)
  }
  const syncCollection = () => {
    if (!activePlan) return
    updateActiveCards(reconcileDeckOwnedQuantities(activePlan.cards, collectionCards, { preserveManual: false }), false)
    setMessage('Copie aggiornate dalla collezione.')
  }
  const savePlan = async () => {
    if (!activePlan || !userId || saving) return
    const cleanName = activePlan.name.trim() || 'Deck sperimentale'
    const moderation = validateUserText(cleanName)
    if (!moderation.ok) { setMessage(moderation.message || 'Nome non valido.'); return }
    setSaving(true); setMessage('')
    const updatedAt = new Date().toISOString()
    const saved = { ...activePlan, name: cleanName, updatedAt }
    const { error } = await supabase.from('user_decks').upsert({ id: saved.id, user_id: userId, name: saved.name, leader: null, cards: saved.cards, source: 'experimental', source_url: null, player: null, placement: null, meta_total: String(stats.required), updated_at: updatedAt }, { onConflict: 'user_id,id' })
    if (error) setMessage('Non sono riuscito a salvare il progetto.')
    else { setActivePlan(saved); setPlans(current => [saved, ...current.filter(plan => plan.id !== saved.id)]); setMessage('Progetto salvato.') }
    setSaving(false)
  }
  const deletePlan = async (plan: ExperimentDeck) => {
    if (!userId || !window.confirm(`Eliminare "${plan.name}"?`)) return
    await supabase.from('user_decks').delete().eq('user_id', userId).eq('id', plan.id).eq('source', 'experimental')
    setPlans(current => current.filter(item => item.id !== plan.id)); if (activePlan?.id === plan.id) setActivePlan(null)
  }
  const resetFilters = () => { setOwnershipFilter('all'); setColorFilter('all'); setCostFilter('all'); setPowerFilter('all'); setRarityFilter('all'); setTypeFilter('all') }
  const activeSearchFilters = [ownershipFilter, colorFilter, costFilter, powerFilter, rarityFilter, typeFilter].filter(value => value !== 'all').length

  return (
    <div className={`min-h-screen overflow-x-hidden pt-14 text-white onepiece-wave-bg onepiece-clouds ${activePlan ? 'pb-52' : 'pb-32 sm:pb-36'}`}>
      <Topbar /><Sidebar activePage="decks" />
      <main className="mx-auto max-w-7xl px-3 py-4 sm:px-6 lg:px-8">
        <header className="flex items-center gap-3">
          <button onClick={() => router.push('/decks')} className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl border border-white/10 bg-slate-950/55 text-slate-200 active:scale-95" aria-label="Torna ai deck"><ArrowLeft size={19} /></button>
          <div className="min-w-0 flex-1"><div className="flex items-center gap-2 text-amber-200"><Beaker size={18} /><span className="text-[10px] font-black uppercase tracking-[0.24em]">Deck Lab</span></div><h1 className="truncate text-xl font-black sm:text-3xl">Deck sperimentali</h1></div>
          {activePlan?.cards.length ? <RecommendationPill recommendation={recommendation} loading={metaLoading} disabled={totalRequired >= DECK_SIZE} onAdd={card => addCard({ card_id: card.card_id, name: card.name || 'Carta', image_url: card.image_url || null, rarity: card.rarity || null, card_color: card.card_color || null, card_type: card.card_type || null, card_cost: card.card_cost ?? null, card_power: card.card_power ?? null })} /> : null}
          <button onClick={createPlan} className="flex items-center gap-2 rounded-2xl bg-cyan-300 px-3 py-2.5 text-xs font-black text-slate-950 shadow-lg active:scale-95 sm:px-4 sm:text-sm"><Plus size={17} />Nuovo</button>
        </header>

        {!activePlan ? (
          <section className="mt-4">
            {plans.length === 0 ? (
              <div className="rounded-[1.75rem] border border-dashed border-white/15 bg-slate-900/70 p-7 text-center backdrop-blur-xl"><div className="mx-auto grid h-16 w-16 place-items-center rounded-3xl bg-amber-300/12 text-amber-200"><Beaker size={31} /></div><h2 className="mt-4 text-xl font-black">Prova combinazioni senza vincoli</h2><p className="mx-auto mt-2 max-w-lg text-sm leading-6 text-slate-300">Costruisci il mazzo, confrontalo con la collezione e tieni sotto controllo ogni carta ancora da acquistare.</p><button onClick={createPlan} className="mt-5 rounded-2xl bg-cyan-300 px-5 py-3 text-sm font-black text-slate-950 active:scale-95">Crea il primo progetto</button></div>
            ) : (
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">{plans.map(plan => {
                const required = plan.cards.reduce((sum, card) => sum + card.quantity, 0)
                const owned = plan.cards.reduce((sum, card) => sum + Math.min(card.quantity, card.owned_quantity), 0)
                const progress = required ? Math.round((owned / required) * 100) : 0
                return <article key={plan.id} className="overflow-hidden rounded-[1.55rem] border border-white/10 bg-slate-900/72 p-3 backdrop-blur-xl"><button onClick={() => setActivePlan(plan)} className="w-full text-left"><div className="flex h-24 gap-1 overflow-hidden rounded-2xl bg-slate-950/60 p-1">{plan.cards.slice(0, 4).length ? plan.cards.slice(0, 4).map(card => <CardImage key={card.card_id} src={card.image_url} cardId={card.card_id} alt={card.name} className="min-w-0 flex-1 overflow-hidden rounded-xl" imgClassName="h-full w-full object-cover object-top" />) : <div className="grid w-full place-items-center text-amber-200"><Beaker size={31} /></div>}</div><p className="mt-3 truncate text-base font-black">{plan.name}</p><p className="mt-1 text-xs text-slate-400">{required}/{DECK_SIZE} carte · {Math.max(0, required - owned)} copie mancanti</p><div className="mt-3 h-2 overflow-hidden rounded-full bg-slate-800"><div className="h-full rounded-full bg-gradient-to-r from-cyan-300 to-emerald-300" style={{ width: `${progress}%` }} /></div><p className="mt-1 text-[10px] font-black text-cyan-100">{owned}/{required} possedute · {progress}%</p></button><div className="mt-3 flex gap-2"><button onClick={() => setActivePlan(plan)} className="flex-1 rounded-xl bg-cyan-300/12 px-3 py-2 text-xs font-black text-cyan-100">Apri</button><button onClick={() => void deletePlan(plan)} className="grid h-9 w-9 place-items-center rounded-xl bg-rose-400/10 text-rose-200" aria-label="Elimina progetto"><Trash2 size={15} /></button></div></article>
              })}</div>
            )}
          </section>
        ) : (
          <section className="mt-4 space-y-3">
            <div className="sticky top-14 z-20 rounded-[1.5rem] border border-white/12 bg-[#173842]/95 p-3 shadow-xl backdrop-blur-2xl"><div className="flex items-center gap-2"><input value={activePlan.name} onChange={event => setActivePlan({ ...activePlan, name: event.target.value })} className="min-w-0 flex-1 rounded-2xl border border-white/10 bg-slate-950/55 px-3 py-2.5 text-sm font-black outline-none focus:border-cyan-300" aria-label="Nome deck sperimentale" /><button onClick={() => void savePlan()} disabled={saving} className="grid h-10 w-10 shrink-0 place-items-center rounded-2xl bg-cyan-300 text-slate-950 disabled:opacity-50" aria-label="Salva"><Save size={17} /></button><button onClick={() => setActivePlan(null)} className="grid h-10 w-10 shrink-0 place-items-center rounded-2xl border border-white/10 bg-slate-950/55" aria-label="Chiudi"><X size={17} /></button></div>{message ? <p className="mt-2 rounded-xl bg-white/[0.06] px-3 py-2 text-xs font-bold text-slate-200">{message}</p> : null}</div>
            <div className="rounded-[1.35rem] border border-white/10 bg-slate-900/75 p-3 backdrop-blur-xl"><div className="flex items-center gap-3"><div className="grid h-14 w-14 shrink-0 place-items-center rounded-2xl bg-cyan-300/10 text-center"><span><span className="block text-lg font-black leading-none text-cyan-100">{stats.required}</span><span className="text-[8px] font-black text-cyan-200/65">/{DECK_SIZE}</span></span></div><div className="min-w-0 flex-1"><div className="flex items-center justify-between gap-2"><p className="text-[10px] font-black uppercase text-slate-400">Deck {stats.complete}% completo</p><button onClick={syncCollection} className="flex items-center gap-1 rounded-lg bg-cyan-300/10 px-2 py-1.5 text-[9px] font-black text-cyan-100"><RefreshCw size={11} />Aggiorna</button></div><div className="mt-2 h-2 overflow-hidden rounded-full bg-slate-950/70"><div className="h-full rounded-full bg-gradient-to-r from-cyan-300 via-emerald-300 to-amber-200" style={{ width: `${stats.complete}%` }} /></div><div className="mt-2 flex gap-3 text-[9px] font-bold"><span className="text-emerald-200">{stats.owned} possedute</span><span className="text-rose-200">{stats.missing} mancanti</span><span className="text-amber-200">{stats.missingTypes} tipi</span></div></div></div></div>
            <div className="flex items-center justify-between gap-2"><div className="grid flex-1 grid-cols-3 rounded-2xl border border-white/10 bg-slate-950/45 p-1 text-[10px] font-black sm:max-w-md sm:text-xs">{([['all', `Tutte ${activePlan.cards.length}`], ['missing', `Mancanti ${stats.missingTypes}`], ['complete', 'Complete']] as Array<[DeckFilter, string]>).map(([value, label]) => <button key={value} onClick={() => setDeckFilter(value)} className={`rounded-xl px-2 py-2 ${deckFilter === value ? 'bg-cyan-300 text-slate-950' : 'text-slate-300'}`}>{label}</button>)}</div><button onClick={() => setSearchExpanded(true)} className="flex shrink-0 items-center gap-2 rounded-2xl bg-amber-200 px-3 py-2.5 text-xs font-black text-slate-950"><Plus size={15} /><span className="hidden min-[380px]:inline">Carte</span></button></div>
            {filteredDeckCards.length === 0 ? <button onClick={() => setSearchExpanded(true)} className="grid min-h-52 w-full place-items-center rounded-[1.6rem] border border-dashed border-slate-600 bg-slate-950/35 p-6 text-center"><span><span className="mx-auto grid h-14 w-14 place-items-center rounded-3xl bg-cyan-300/10 text-cyan-200"><Plus size={27} /></span><span className="mt-3 block text-base font-black">Aggiungi le prime carte</span><span className="mt-1 block text-sm text-slate-400">La ricerca resta sempre disponibile nella barra in basso.</span></span></button> : (
              <div className="rounded-[1.35rem] border border-white/10 bg-slate-950/25 p-2"><div className="grid grid-cols-5 gap-1.5 min-[390px]:grid-cols-6 sm:grid-cols-7 lg:grid-cols-9 xl:grid-cols-10">{filteredDeckCards.map(card => {
                const missing = Math.max(0, card.quantity - card.owned_quantity)
                const unlimited = isUnlimitedCopiesCard(card)
                return <button key={card.card_id} onClick={() => { setSearchExpanded(false); setSelectedCardId(card.card_id) }} className={`group min-w-0 text-left active:scale-[0.97] ${missing ? 'text-rose-100' : 'text-emerald-100'}`}><span className={`relative block overflow-hidden rounded-lg border-2 bg-slate-900 shadow-lg ${missing ? 'border-rose-400/65' : 'border-emerald-300/35'}`}><CardImage src={card.image_url} cardId={card.card_id} alt={card.name} className="aspect-[5/7] w-full" /><span className="absolute left-0.5 top-0.5 rounded-md bg-slate-950/92 px-1.5 py-0.5 text-[9px] font-black text-white">x{card.quantity}</span>{missing > 0 ? <span className="absolute bottom-0.5 right-0.5 rounded-md bg-rose-500 px-1.5 py-0.5 text-[8px] font-black text-white">-{missing}</span> : <span className="absolute bottom-0.5 right-0.5 grid h-4 w-4 place-items-center rounded-full bg-emerald-300 text-[9px] font-black text-slate-950">✓</span>}{unlimited ? <span className="absolute right-0.5 top-0.5 rounded-md bg-amber-200 px-1 py-0.5 text-[9px] font-black text-slate-950">∞</span> : null}</span><span className="mt-1 block truncate text-[8px] font-black sm:text-[10px]">{card.name}</span><span className="block truncate text-[7px] text-slate-500 sm:text-[9px]">{displayCardId(card.card_id)}</span></button>
              })}</div></div>
            )}
          </section>
        )}
      </main>

      {activePlan ? <SearchDrawer expanded={searchExpanded} setExpanded={setSearchExpanded} query={query} setQuery={value => { setQuery(value); if (!value.trim()) { searchRun.current += 1; setResults([]); setSearching(false) } }} searching={searching} showFilters={showFilters} setShowFilters={setShowFilters} activeSearchFilters={activeSearchFilters} totalRequired={totalRequired} results={filteredResults} activePlan={activePlan} collectionByBase={collectionByBase} addCard={addCard} filters={{ ownershipFilter, colorFilter, costFilter, powerFilter, rarityFilter, typeFilter }} setters={{ setOwnershipFilter, setColorFilter, setCostFilter, setPowerFilter, setRarityFilter, setTypeFilter }} availableRarities={availableRarities} availableTypes={availableTypes} resetFilters={resetFilters} /> : null}
      {activePlan && selectedDeckCard ? <DeckCardEditor card={selectedDeckCard} totalRequired={totalRequired} onClose={() => setSelectedCardId(null)} onRequiredChange={delta => changeRequired(selectedDeckCard.card_id, delta)} onOwnedChange={delta => changeOwned(selectedDeckCard.card_id, delta)} onRemove={() => { updateActiveCards(activePlan.cards.filter(item => item.card_id !== selectedDeckCard.card_id)); setSelectedCardId(null) }} /> : null}
    </div>
  )
}

function RecommendationPill({ recommendation, loading, disabled, onAdd }: { recommendation: ReturnType<typeof recommendDeckCard>; loading: boolean; disabled: boolean; onAdd: (card: RecommendationCard) => void }) {
  if (loading) return <div className="flex h-11 w-[104px] shrink-0 items-center gap-2 rounded-xl border border-amber-200/20 bg-amber-200/[0.07] px-2 min-[390px]:w-[145px]"><Sparkles size={14} className="shrink-0 animate-pulse text-amber-200" /><span className="truncate text-[9px] font-black text-amber-100">Calcolo consiglio...</span></div>
  if (!recommendation) return null
  return <button onClick={() => onAdd(recommendation.card)} disabled={disabled} className="flex h-11 w-[104px] shrink-0 items-center gap-1.5 overflow-hidden rounded-xl border border-amber-200/30 bg-amber-200/10 p-1 text-left shadow-[0_0_20px_rgba(253,230,138,0.08)] active:scale-[0.97] disabled:opacity-45 min-[390px]:w-[145px]" title={`Presente nel ${recommendation.percentage}% di ${recommendation.matchingDecks} deck simili`}><CardImage src={recommendation.card.image_url || null} cardId={recommendation.card.card_id} alt={recommendation.card.name || 'Carta consigliata'} className="h-9 w-7 shrink-0 overflow-hidden rounded-md bg-slate-900" /><span className="min-w-0 flex-1"><span className="flex items-center gap-1 text-[7px] font-black uppercase text-amber-200"><Sparkles size={8} />Consigliata {recommendation.percentage}%</span><span className="block truncate text-[9px] font-black text-white">{recommendation.card.name || recommendation.card.card_id}</span><span className="block truncate text-[7px] text-slate-400">x{recommendation.recommendedCopies} · {recommendation.matchingDecks} deck</span></span><Plus size={11} className="shrink-0 text-amber-200" /></button>
}

function DeckCardEditor({ card, totalRequired, onClose, onRequiredChange, onOwnedChange, onRemove }: { card: ExperimentCard; totalRequired: number; onClose: () => void; onRequiredChange: (delta: number) => void; onOwnedChange: (delta: number) => void; onRemove: () => void }) {
  const missing = Math.max(0, card.quantity - card.owned_quantity)
  const unlimited = isUnlimitedCopiesCard(card)
  const canIncrease = totalRequired < DECK_SIZE && card.quantity < maxCopiesForCard(card)
  const otherCards = Math.max(0, totalRequired - card.quantity)
  const freeSlots = Math.max(0, DECK_SIZE - totalRequired)
  return <div className="fixed inset-0 z-[70] flex items-end justify-center bg-slate-950/75 p-2 backdrop-blur-sm sm:items-center" onClick={onClose}><section className="w-full max-w-lg rounded-[1.6rem] border border-white/15 bg-[#12313a] p-3 shadow-2xl" onClick={event => event.stopPropagation()}><div className="flex items-start gap-3"><CardImage src={card.image_url} cardId={card.card_id} alt={card.name} className="aspect-[5/7] w-24 shrink-0 overflow-hidden rounded-xl bg-slate-900 sm:w-32" /><div className="min-w-0 flex-1"><div className="flex items-start justify-between gap-2"><div className="min-w-0"><h2 className="truncate text-base font-black sm:text-xl">{card.name}</h2><p className="text-xs font-bold text-cyan-100">{displayCardId(card.card_id)}</p></div><button onClick={onClose} className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-white/[0.07]" aria-label="Chiudi"><X size={17} /></button></div><div className={`mt-3 rounded-xl px-3 py-2 text-xs font-black ${missing ? 'bg-rose-400/12 text-rose-100' : 'bg-emerald-300/12 text-emerald-100'}`}>{missing ? `Ti mancano ${missing} copie` : 'Hai tutte le copie richieste'}</div>{unlimited ? <div className="mt-2 rounded-xl bg-amber-200/10 px-3 py-2 text-[10px] font-bold leading-4 text-amber-100"><p className="font-black">Nessun limite personale di copie</p><p>{otherCards} altre carte nel deck · {freeSlots} posti ancora liberi su 50.</p>{freeSlots === 0 ? <p className="mt-1 text-rose-200">Per aggiungerne altre devi ridurre o rimuovere un&apos;altra carta.</p> : null}</div> : null}</div></div><div className="mt-3 grid grid-cols-2 gap-2"><QuantityControl label="Copie nel deck" value={card.quantity} onMinus={() => onRequiredChange(-1)} onPlus={() => onRequiredChange(1)} plusDisabled={!canIncrease} /><QuantityControl label="Copie possedute" value={card.owned_quantity} onMinus={() => onOwnedChange(-1)} onPlus={() => onOwnedChange(1)} plusDisabled={card.owned_quantity >= card.quantity} green /></div><button onClick={onRemove} className="mt-3 flex w-full items-center justify-center gap-2 rounded-xl bg-rose-400/12 px-3 py-2.5 text-xs font-black text-rose-100"><Trash2 size={14} />Rimuovi dal deck</button></section></div>
}

function QuantityControl({ label, value, onMinus, onPlus, plusDisabled, green = false }: { label: string; value: number; onMinus: () => void; onPlus: () => void; plusDisabled: boolean; green?: boolean }) {
  return <div className={`rounded-xl p-1.5 ${green ? 'bg-emerald-300/[0.06]' : 'bg-white/[0.05]'}`}><p className={`mb-1 text-center text-[8px] font-black uppercase ${green ? 'text-emerald-200/65' : 'text-slate-500'}`}>{label}</p><div className="flex items-center justify-between"><button onClick={onMinus} className="grid h-7 w-7 place-items-center rounded-lg bg-white/[0.07]"><Minus size={12} /></button><span className={`text-sm font-black ${green ? 'text-emerald-100' : ''}`}>{value}</span><button onClick={onPlus} disabled={plusDisabled} className={`grid h-7 w-7 place-items-center rounded-lg disabled:opacity-25 ${green ? 'bg-emerald-300/12 text-emerald-100' : 'bg-cyan-300/12 text-cyan-100'}`}><Plus size={12} /></button></div></div>
}

type SearchDrawerProps = {
  expanded: boolean; setExpanded: (value: boolean | ((value: boolean) => boolean)) => void
  query: string; setQuery: (value: string) => void; searching: boolean
  showFilters: boolean; setShowFilters: (value: boolean | ((value: boolean) => boolean)) => void
  activeSearchFilters: number; totalRequired: number; results: CatalogCard[]; activePlan: ExperimentDeck
  collectionByBase: Record<string, number>; addCard: (card: CatalogCard) => void
  filters: { ownershipFilter: OwnershipFilter; colorFilter: string; costFilter: string; powerFilter: string; rarityFilter: string; typeFilter: string }
  setters: { setOwnershipFilter: (value: OwnershipFilter) => void; setColorFilter: (value: string) => void; setCostFilter: (value: string) => void; setPowerFilter: (value: string) => void; setRarityFilter: (value: string) => void; setTypeFilter: (value: string) => void }
  availableRarities: string[]; availableTypes: string[]; resetFilters: () => void
}

function SearchDrawer({ expanded, setExpanded, query, setQuery, searching, showFilters, setShowFilters, activeSearchFilters, totalRequired, results, activePlan, collectionByBase, addCard, filters, setters, availableRarities, availableTypes, resetFilters }: SearchDrawerProps) {
  return <section className={`fixed inset-x-2 z-40 mx-auto w-[min(calc(100%-1rem),1120px)] overflow-hidden rounded-[1.6rem] border border-white/15 bg-[#102c35]/97 shadow-[0_22px_70px_rgba(0,0,0,0.5)] backdrop-blur-2xl transition-[max-height] duration-300 ${expanded ? 'max-h-[76dvh]' : 'max-h-16'}`} style={{ bottom: 'calc(max(0.5rem, env(safe-area-inset-bottom)) + 4.75rem)' }}>
    <button onClick={() => setExpanded(value => !value)} className="flex h-16 w-full items-center gap-3 px-4 text-left"><span className="grid h-10 w-10 shrink-0 place-items-center rounded-2xl bg-gradient-to-r from-cyan-300 to-rose-300 text-slate-950"><Search size={18} /></span><span className="min-w-0 flex-1"><span className="block text-sm font-black">Cerca e aggiungi carte</span><span className="block truncate text-[10px] text-slate-400">{totalRequired}/{DECK_SIZE} nel deck{activeSearchFilters ? ` · ${activeSearchFilters} filtri attivi` : ''}</span></span><span className="grid h-9 w-9 place-items-center rounded-xl border border-white/10 bg-white/[0.05]">{expanded ? <ChevronDown size={18} /> : <ChevronUp size={18} />}</span></button>
    <div className="border-t border-white/10 px-3 pb-3 pt-2 sm:px-4"><div className="flex gap-2"><label className="relative min-w-0 flex-1"><Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" /><input value={query} onChange={event => setQuery(event.target.value)} placeholder="Nome, codice o testo effetto" className="w-full rounded-2xl border border-slate-700 bg-slate-950/70 py-3 pl-10 pr-3 text-base outline-none focus:border-cyan-300" /></label><button onClick={() => setShowFilters(value => !value)} className={`relative grid h-12 w-12 shrink-0 place-items-center rounded-2xl border ${showFilters || activeSearchFilters ? 'border-amber-200/40 bg-amber-200/14 text-amber-100' : 'border-slate-700 bg-slate-950/70 text-slate-300'}`} aria-label="Filtri"><SlidersHorizontal size={18} />{activeSearchFilters ? <span className="absolute -right-1 -top-1 grid h-5 min-w-5 place-items-center rounded-full bg-rose-400 px-1 text-[9px] font-black text-white">{activeSearchFilters}</span> : null}</button></div>
      {showFilters ? <div className="mt-2 grid grid-cols-2 gap-2 rounded-2xl border border-white/10 bg-slate-950/45 p-2 sm:grid-cols-4 lg:grid-cols-7"><select value={filters.ownershipFilter} onChange={event => setters.setOwnershipFilter(event.target.value as OwnershipFilter)} className="rounded-xl border border-slate-700 bg-slate-900 px-2 py-2.5 text-xs font-bold"><option value="all">Tutte le carte</option><option value="owned">Già possedute</option><option value="missing">Non possedute</option></select><select value={filters.colorFilter} onChange={event => setters.setColorFilter(event.target.value)} className="rounded-xl border border-slate-700 bg-slate-900 px-2 py-2.5 text-xs font-bold"><option value="all">Tutti i colori</option>{colors.map(color => <option key={color} value={color}>{colorLabels[color]}</option>)}</select><select value={filters.costFilter} onChange={event => setters.setCostFilter(event.target.value)} className="rounded-xl border border-slate-700 bg-slate-900 px-2 py-2.5 text-xs font-bold"><option value="all">Tutti i costi</option>{[0,1,2,3,4,5,6].map(cost => <option key={cost} value={cost}>Costo {cost}</option>)}<option value="7+">Costo 7+</option></select><select value={filters.powerFilter} onChange={event => setters.setPowerFilter(event.target.value)} className="rounded-xl border border-slate-700 bg-slate-900 px-2 py-2.5 text-xs font-bold"><option value="all">Tutte le forze</option>{[0,1000,2000,3000,4000,5000,6000,7000].map(power => <option key={power} value={power}>{power}</option>)}<option value="8000+">8000+</option></select><select value={filters.rarityFilter} onChange={event => setters.setRarityFilter(event.target.value)} className="rounded-xl border border-slate-700 bg-slate-900 px-2 py-2.5 text-xs font-bold"><option value="all">Tutte le rarità</option>{availableRarities.map(rarity => <option key={rarity} value={rarity}>{rarity}</option>)}</select><select value={filters.typeFilter} onChange={event => setters.setTypeFilter(event.target.value)} className="rounded-xl border border-slate-700 bg-slate-900 px-2 py-2.5 text-xs font-bold"><option value="all">Tutti i tipi</option>{availableTypes.map(type => <option key={type} value={type}>{type}</option>)}</select><button onClick={resetFilters} className="flex items-center justify-center gap-1 rounded-xl border border-slate-700 px-3 py-2 text-xs font-black text-slate-300"><Filter size={13} />Azzera</button></div> : null}
      <div className="mt-2 max-h-[48dvh] overflow-y-auto pb-2">{searching ? <p className="rounded-2xl border border-slate-700 p-4 text-sm text-slate-400">Cerco nel catalogo...</p> : !query.trim() ? <p className="rounded-2xl border border-dashed border-slate-700 p-4 text-sm text-slate-400">Cerca per nome, codice o una parola dell&apos;effetto. Il mazzo resta visibile dietro questa finestra.</p> : results.length === 0 ? <p className="rounded-2xl border border-dashed border-slate-700 p-4 text-sm text-slate-400">Nessuna carta corrisponde alla ricerca e ai filtri.</p> : <div className="grid grid-cols-3 gap-2 sm:grid-cols-5 lg:grid-cols-7">{results.map(card => {
        const planned = activePlan.cards.find(item => item.card_id === card.card_id)?.quantity || 0
        const owned = collectionByBase[baseDeckCardId(card.card_id)] || 0
        const disabled = totalRequired >= DECK_SIZE || planned >= maxCopiesForCard(card)
        return <button key={card.card_id} onClick={() => addCard(card)} disabled={disabled} className="relative overflow-hidden rounded-2xl border border-slate-700 bg-slate-950/65 p-1.5 text-left transition hover:border-cyan-300/50 active:scale-[0.98] disabled:opacity-45"><CardImage src={card.image_url} cardId={card.card_id} alt={card.name} className="aspect-[5/7] w-full overflow-hidden rounded-xl bg-slate-900" />{planned > 0 ? <span className="absolute right-2 top-2 rounded-full bg-cyan-300 px-2 py-1 text-[9px] font-black text-slate-950">deck x{planned}</span> : null}<span className={`absolute left-2 top-2 rounded-full px-2 py-1 text-[9px] font-black ${owned > 0 ? 'bg-emerald-300 text-slate-950' : 'bg-slate-950/85 text-slate-300'}`}>hai x{owned}</span><p className="mt-1.5 truncate text-[10px] font-black">{card.name}</p><div className="mt-0.5 flex items-center justify-between gap-1 text-[8px] text-slate-400"><span>{displayCardId(card.card_id)}</span>{isUnlimitedCopiesCard(card) ? <span className="font-black text-amber-200">∞</span> : null}</div></button>
      })}</div>}</div>
    </div>
  </section>
}
