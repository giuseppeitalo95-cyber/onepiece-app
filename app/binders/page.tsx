'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { ArrowLeft, BookOpen, Check, Pencil, Plus, Save, Search, Share2, SlidersHorizontal, Square, Trash2, X } from 'lucide-react'
import Sidebar from '@/app/components/Sidebar'
import Topbar from '@/app/components/Topbar'
import BinderBook from '@/app/components/BinderBook'
import BinderCover from '@/app/components/BinderCover'
import BinderSocial from '@/app/components/BinderSocial'
import BinderCardDetail from '@/app/components/BinderCardDetail'
import CardImage from '@/app/components/CardImage'
import { supabase } from '@/lib/supabase'
import { isAdminAccount } from '@/lib/admin'
import { BINDER_COLORS, binderSpreadIndexes, normalizeBinder, normalizeBinderPages, type BinderCard, type BinderRecord } from '@/lib/binders'
import { shareBinder } from '@/lib/binderShare'
import { validateUserText } from '@/lib/textModeration'

type PickerSource = 'collection' | 'catalog'

const layouts = [
  { columns: 2, rows: 2, label: '2x2' },
  { columns: 3, rows: 3, label: '3x3' },
  { columns: 4, rows: 4, label: '4x4' },
  { columns: 4, rows: 5, label: '4x5' },
]

const cloneBinder = (binder: BinderRecord): BinderRecord => JSON.parse(JSON.stringify(binder))

const mapCatalogCard = (value: unknown): BinderCard => {
  const card = value && typeof value === 'object' ? value as Record<string, unknown> : {}
  return {
  card_id: String(card.card_set_id ?? card.card_id ?? card.id ?? ''),
  name: String(card.card_name || card.name || card.card_set_id || 'Carta'),
  image_url: card.card_image ? String(card.card_image) : card.image_url ? String(card.image_url) : null,
  rarity: card.rarity ? String(card.rarity) : null,
  card_color: card.card_color ? String(card.card_color) : null,
  card_cost: card.card_cost == null || !Number.isFinite(Number(card.card_cost)) ? null : Number(card.card_cost),
  card_power: card.card_power == null || !Number.isFinite(Number(card.card_power)) ? null : Number(card.card_power),
  }
}

const messageFromError = (error: unknown, fallback: string) => error instanceof Error ? error.message : fallback

export default function BindersPage() {
  const router = useRouter()
  const searchRunRef = useRef(0)
  const [userId, setUserId] = useState('')
  const [username, setUsername] = useState('')
  const [loading, setLoading] = useState(true)
  const [databaseReady, setDatabaseReady] = useState(true)
  const [binders, setBinders] = useState<BinderRecord[]>([])
  const [activeBinder, setActiveBinder] = useState<BinderRecord | null>(null)
  const [spreadIndex, setSpreadIndex] = useState(0)
  const [singlePageIndex, setSinglePageIndex] = useState(0)
  const [viewMode, setViewMode] = useState<'spread' | 'single'>('spread')
  const [editing, setEditing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [sharing, setSharing] = useState(false)
  const [status, setStatus] = useState('')
  const [introOpen, setIntroOpen] = useState(false)
  const [createOpen, setCreateOpen] = useState(false)
  const [newTitle, setNewTitle] = useState('Il mio raccoglitore')
  const [newColor, setNewColor] = useState(BINDER_COLORS[0])
  const [newLayout, setNewLayout] = useState(layouts[1])
  const [creating, setCreating] = useState(false)
  const [collectionCards, setCollectionCards] = useState<BinderCard[]>([])
  const [pickerSlot, setPickerSlot] = useState<{ page: number; slot: number } | null>(null)
  const [pickerSource, setPickerSource] = useState<PickerSource>('collection')
  const [query, setQuery] = useState('')
  const [catalogCards, setCatalogCards] = useState<BinderCard[]>([])
  const [searching, setSearching] = useState(false)
  const [selectedBinderCard, setSelectedBinderCard] = useState<BinderCard | null>(null)
  const [filtersOpen, setFiltersOpen] = useState(false)
  const [filterColor, setFilterColor] = useState('all')
  const [filterRarity, setFilterRarity] = useState('all')
  const [filterCost, setFilterCost] = useState('all')
  const [filterPower, setFilterPower] = useState('all')

  const pickerCards = pickerSource === 'catalog' ? catalogCards : collectionCards
  const availableRarities = useMemo(() => Array.from(new Set(pickerCards.map(card => card.rarity?.trim()).filter((value): value is string => Boolean(value)))).sort(), [pickerCards])
  const activeFilterCount = [filterColor, filterRarity, filterCost, filterPower].filter(value => value !== 'all').length

  const displayedCards = useMemo(() => {
    const normalized = query.trim().toLowerCase()
    return pickerCards.filter(card => {
      const matchesSearch = pickerSource === 'catalog' || !normalized || `${card.name} ${card.card_id}`.toLowerCase().includes(normalized)
      const matchesColor = filterColor === 'all' || (card.card_color || '').toLowerCase().includes(filterColor)
      const matchesRarity = filterRarity === 'all' || card.rarity?.trim() === filterRarity
      const cost = card.card_cost ?? -1
      const matchesCost = filterCost === 'all'
        || (filterCost === '0-2' && cost >= 0 && cost <= 2)
        || (filterCost === '3-5' && cost >= 3 && cost <= 5)
        || (filterCost === '6+' && cost >= 6)
      const power = card.card_power ?? -1
      const matchesPower = filterPower === 'all'
        || (filterPower === '0-4000' && power >= 0 && power <= 4000)
        || (filterPower === '5000-7000' && power >= 5000 && power <= 7000)
        || (filterPower === '8000+' && power >= 8000)
      return matchesSearch && matchesColor && matchesRarity && matchesCost && matchesPower
    })
  }, [filterColor, filterCost, filterPower, filterRarity, pickerCards, pickerSource, query])

  useEffect(() => {
    const load = async () => {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session?.user) {
        router.replace('/')
        return
      }

      const [{ data: profile }, { data: userCards }] = await Promise.all([
        supabase.from('profiles').select('username').eq('id', session.user.id).maybeSingle(),
        supabase.from('user_cards').select('card_id, name, image_url, rarity, card_color, card_cost, card_power').eq('user_id', session.user.id).order('name'),
      ])

      if (!isAdminAccount(session.user, profile)) {
        router.replace('/dashboard')
        return
      }

      setUserId(session.user.id)
      setUsername(profile?.username || 'Peppitalo')
      const seen = new Set<string>()
      setCollectionCards((userCards || []).map(mapCatalogCard).filter(card => {
        if (!card.card_id || seen.has(card.card_id)) return false
        seen.add(card.card_id)
        return true
      }))

      const { data, error } = await supabase
        .from('binders')
        .select('*')
        .eq('user_id', session.user.id)
        .order('updated_at', { ascending: false })

      if (error) setDatabaseReady(false)
      else setBinders((data || []).map(normalizeBinder))

      if (!window.localStorage.getItem('opv_binders_intro_seen_v1')) setIntroOpen(true)
      setLoading(false)
    }

    void load()
  }, [router])

  useEffect(() => {
    if (pickerSource !== 'catalog') return
    const clean = query.trim()
    if (clean.length < 2) {
      searchRunRef.current += 1
      const reset = window.setTimeout(() => {
        setCatalogCards([])
        setSearching(false)
      }, 0)
      return () => window.clearTimeout(reset)
    }

    const timer = window.setTimeout(async () => {
      const runId = ++searchRunRef.current
      setSearching(true)
      try {
        const response = await fetch(`/api/cards/search?q=${encodeURIComponent(clean)}`)
        const data = await response.json()
        if (runId !== searchRunRef.current) return
        const seen = new Set<string>()
        setCatalogCards((Array.isArray(data) ? data : []).map(mapCatalogCard).filter((card: BinderCard) => {
          if (!card.card_id || seen.has(card.card_id)) return false
          seen.add(card.card_id)
          return true
        }).slice(0, 50))
      } catch {
        if (runId === searchRunRef.current) setCatalogCards([])
      }
      if (runId === searchRunRef.current) setSearching(false)
    }, 180)

    return () => window.clearTimeout(timer)
  }, [pickerSource, query])

  const closeIntro = () => {
    window.localStorage.setItem('opv_binders_intro_seen_v1', '1')
    setIntroOpen(false)
  }

  const createBinder = async () => {
    const title = newTitle.trim()
    if (!userId || creating || !title) return
    const moderation = validateUserText(title)
    if (!moderation.ok) {
      setStatus(moderation.message)
      return
    }

    setCreating(true)
    setStatus('')
    try {
      const id = crypto.randomUUID()
      const record: BinderRecord = {
        id,
        user_id: userId,
        title,
        cover_color: newColor,
        cover_image_url: null,
        columns_count: newLayout.columns,
        rows_count: newLayout.rows,
        pages: normalizeBinderPages([], newLayout.columns, newLayout.rows),
        is_shared: false,
      }
      const { error } = await supabase.from('binders').insert(record)
      if (error) throw error
      setBinders(current => [record, ...current])
      setActiveBinder(record)
      setCreateOpen(false)
      setEditing(true)
      setSpreadIndex(0)
      setSinglePageIndex(0)
      setViewMode('spread')
      setStatus('Raccoglitore creato. Tocca una tasca per inserire una carta.')
    } catch (error: unknown) {
      setStatus(messageFromError(error, 'Raccoglitore non creato.'))
    }
    setCreating(false)
  }

  const updateActive = (updater: (binder: BinderRecord) => BinderRecord) => {
    setActiveBinder(current => current ? updater(cloneBinder(current)) : current)
  }

  const selectCard = (card: BinderCard) => {
    if (!pickerSlot) return
    updateActive(binder => {
      binder.pages[pickerSlot.page].slots[pickerSlot.slot] = card
      return binder
    })
    setPickerSlot(null)
    setQuery('')
  }

  const removeCard = (page: number, slot: number) => updateActive(binder => {
    binder.pages[page].slots[slot] = null
    return binder
  })

  const changeLayout = (columns: number, rows: number) => updateActive(binder => ({
    ...binder,
    columns_count: columns,
    rows_count: rows,
    pages: normalizeBinderPages(binder.pages, columns, rows),
  }))

  const addPage = () => {
    if (!activeBinder) return
    const pageIndex = activeBinder.pages.length
    updateActive(binder => {
      const capacity = binder.columns_count * binder.rows_count
      binder.pages.push({ slots: Array(capacity).fill(null) })
      return binder
    })
    setEditing(true)
    setSinglePageIndex(pageIndex)
    setSpreadIndex(Math.ceil(pageIndex / 2))
  }

  const saveActive = async () => {
    if (!activeBinder || saving) return false
    const title = activeBinder.title.trim()
    const moderation = validateUserText(title)
    if (!title || !moderation.ok) {
      setStatus(title ? moderation.message : 'Inserisci il nome del raccoglitore.')
      return false
    }
    setSaving(true)
    const now = new Date().toISOString()
    const { error } = await supabase.from('binders').update({
      title,
      cover_color: activeBinder.cover_color,
      cover_image_url: activeBinder.cover_image_url,
      columns_count: activeBinder.columns_count,
      rows_count: activeBinder.rows_count,
      pages: activeBinder.pages,
      is_shared: true,
      updated_at: now,
    }).eq('id', activeBinder.id).eq('user_id', userId)

    if (error) setStatus('Salvataggio non riuscito.')
    else {
      const saved = { ...activeBinder, title, is_shared: true, updated_at: now }
      const postData = {
        title,
        message: 'Ha creato un raccoglitore personalizzato',
        card_image_url: saved.cover_image_url,
      }
      let postFailed = false
      const existingPost = await supabase
        .from('board_posts')
        .select('id')
        .eq('user_id', userId)
        .eq('binder_id', saved.id)
        .limit(1)
      if (existingPost.error) postFailed = true
      else if (existingPost.data?.[0]?.id) {
        const result = await supabase.from('board_posts').update(postData).eq('id', existingPost.data[0].id)
        postFailed = Boolean(result.error)
      } else {
        const result = await supabase.from('board_posts').insert({ user_id: userId, type: 'binder', binder_id: saved.id, ...postData })
        postFailed = Boolean(result.error)
      }
      setActiveBinder(saved)
      setBinders(current => current.map(item => item.id === saved.id ? saved : item))
      setEditing(false)
      setStatus(postFailed ? 'Raccoglitore salvato. Attivita in bacheca non aggiornata.' : 'Raccoglitore salvato e pubblicato.')
    }
    setSaving(false)
    return !error
  }

  const shareActive = async () => {
    if (!activeBinder || sharing) return
    setSharing(true)
    setStatus("Preparo l'immagine...")
    try {
      if ((editing || !activeBinder.is_shared) && !(await saveActive())) throw new Error('Prima salva il raccoglitore.')
      const shared = { ...activeBinder, is_shared: true }
      setActiveBinder(shared)
      setBinders(current => current.map(item => item.id === shared.id ? shared : item))
      const message = await shareBinder(shared, spreadIndex, username)
      setStatus(message)
      window.setTimeout(() => setStatus(current => current === message ? '' : current), 2500)
    } catch (error: unknown) {
      if (error instanceof DOMException && error.name === 'AbortError') setStatus('')
      else setStatus(messageFromError(error, 'Condivisione non riuscita.'))
    }
    setSharing(false)
  }

  const deleteActive = async () => {
    if (!activeBinder || !window.confirm(`Eliminare "${activeBinder.title}"?`)) return
    const { error } = await supabase.from('binders').delete().eq('id', activeBinder.id).eq('user_id', userId)
    if (error) {
      setStatus('Raccoglitore non eliminato.')
      return
    }
    setBinders(current => current.filter(item => item.id !== activeBinder.id))
    setActiveBinder(null)
    setStatus('Raccoglitore eliminato.')
  }

  if (loading) {
    return <div className="grid min-h-screen place-items-center onepiece-wave-bg text-sm font-black text-cyan-50">Apro i raccoglitori...</div>
  }

  return (
    <div className="min-h-screen pb-32 pt-14 text-white onepiece-wave-bg onepiece-clouds sm:pb-36">
      <Topbar />
      <Sidebar activePage="binders" />
      <main className="mx-auto max-w-7xl px-3 py-4 sm:px-6 sm:py-7">
        {!activeBinder ? (
          <>
            <div className="flex items-end justify-between gap-3">
              <div>
                <h1 className="text-2xl font-black sm:text-3xl">Raccoglitori</h1>
                <p className="mt-1 text-sm text-slate-300">Costruisci e sfoglia le tue pagine.</p>
              </div>
              <button type="button" onClick={() => setCreateOpen(true)} disabled={!databaseReady} className="grid h-11 w-11 place-items-center rounded-2xl bg-cyan-300 text-slate-950 shadow-lg transition hover:bg-cyan-200 active:scale-90 disabled:opacity-35" aria-label="Crea raccoglitore">
                <Plus size={21} strokeWidth={3} />
              </button>
            </div>

            {!databaseReady ? (
              <div className="mt-5 rounded-3xl border border-amber-300/25 bg-amber-300/10 p-5 text-sm leading-6 text-amber-50">
                La beta e pronta, ma va eseguito una volta il file <strong>binders.sql</strong> nel SQL Editor di Supabase.
              </div>
            ) : binders.length === 0 ? (
              <button type="button" onClick={() => setCreateOpen(true)} className="mt-6 flex min-h-64 w-full flex-col items-center justify-center rounded-3xl border border-dashed border-cyan-200/25 bg-slate-950/42 p-8 text-center transition hover:bg-slate-950/60 active:scale-[0.99]">
                <BookOpen size={38} className="text-cyan-200" />
                <span className="mt-4 text-lg font-black">Crea il primo raccoglitore</span>
                <span className="mt-2 text-sm text-slate-400">Scegli formato e copertina, poi inserisci le carte nelle tasche.</span>
              </button>
            ) : (
              <div className="mt-5 grid grid-cols-3 gap-x-3 gap-y-5 sm:grid-cols-4 sm:gap-5 lg:grid-cols-6">
                {binders.map(binder => (
                  <button key={binder.id} type="button" onClick={() => { setActiveBinder(cloneBinder(binder)); setSpreadIndex(0); setSinglePageIndex(0); setViewMode('spread'); setEditing(false); setStatus('') }} className="group min-w-0 text-left transition hover:-translate-y-1 active:scale-95">
                    <BinderCover binder={binder} compact className="w-full transition group-hover:shadow-[0_22px_42px_rgba(103,232,249,0.22)]" />
                  </button>
                ))}
              </div>
            )}
          </>
        ) : (
          <>
            <div className="flex items-center gap-2">
              <button type="button" onClick={() => setActiveBinder(null)} className="grid h-10 w-10 place-items-center rounded-2xl border border-white/10 bg-slate-950/62 text-white transition active:scale-90" aria-label="Torna ai raccoglitori"><ArrowLeft size={19} /></button>
              <div className="min-w-0 flex-1">
                <p className="truncate text-xl font-black sm:text-2xl">{activeBinder.title}</p>
                <p className="text-[10px] font-bold uppercase tracking-[0.15em] text-slate-400">{activeBinder.columns_count}x{activeBinder.rows_count} / {activeBinder.pages.length} pagine</p>
              </div>
            </div>

            <div className="mt-2 overflow-x-hidden">
              <BinderBook binder={activeBinder} spreadIndex={spreadIndex} onSpreadChange={setSpreadIndex} viewMode={viewMode} singlePageIndex={singlePageIndex} onSinglePageChange={index => { setSinglePageIndex(index); setSpreadIndex(Math.ceil(index / 2)) }} editable={editing} onSelectSlot={(page, slot) => setPickerSlot({ page, slot })} onRemoveCard={removeCard} onOpenCard={card => setSelectedBinderCard(card)} />
            </div>

            <div className="mx-auto mt-3 flex w-fit rounded-2xl border border-white/10 bg-slate-950/55 p-1">
              <button type="button" onClick={() => setViewMode('spread')} className={`inline-flex items-center gap-2 rounded-xl px-3 py-2 text-xs font-black transition ${viewMode === 'spread' ? 'bg-cyan-300 text-slate-950' : 'text-slate-300'}`}><BookOpen size={16} /> Due pagine</button>
              <button type="button" onClick={() => { const indexes = binderSpreadIndexes(spreadIndex); setSinglePageIndex(indexes.right != null && activeBinder.pages[indexes.right] ? indexes.right : indexes.left || 0); setViewMode('single') }} className={`inline-flex items-center gap-2 rounded-xl px-3 py-2 text-xs font-black transition ${viewMode === 'single' ? 'bg-cyan-300 text-slate-950' : 'text-slate-300'}`}><Square size={15} /> Una pagina</button>
            </div>

            <button type="button" onClick={addPage} className="mx-auto mt-3 flex items-center gap-2 rounded-2xl border border-cyan-200/25 bg-cyan-300/10 px-4 py-2.5 text-sm font-black text-cyan-100 transition active:scale-95"><Plus size={17} /> Aggiungi pagina</button>

            <div className="mx-auto mt-3 grid max-w-xl grid-cols-4 gap-2">
              <button type="button" onClick={() => setEditing(value => !value)} className={`flex min-w-0 flex-col items-center gap-1 rounded-2xl border px-2 py-2.5 text-[10px] font-black transition active:scale-95 ${editing ? 'border-amber-200/35 bg-amber-300 text-slate-950' : 'border-white/10 bg-slate-950/60 text-white'}`}><Pencil size={17} /> Modifica</button>
              <button type="button" onClick={saveActive} disabled={saving} className="flex min-w-0 flex-col items-center gap-1 rounded-2xl bg-emerald-300 px-2 py-2.5 text-[10px] font-black text-slate-950 transition active:scale-95 disabled:opacity-45"><Save size={17} /> Salva</button>
              <button type="button" onClick={shareActive} disabled={sharing} className="flex min-w-0 flex-col items-center gap-1 rounded-2xl bg-cyan-300 px-2 py-2.5 text-[10px] font-black text-slate-950 transition active:scale-95 disabled:opacity-45"><Share2 size={17} /> Condividi</button>
              <button type="button" onClick={deleteActive} className="flex min-w-0 flex-col items-center gap-1 rounded-2xl border border-rose-200/25 bg-rose-400/10 px-2 py-2.5 text-[10px] font-black text-rose-100 transition active:scale-95"><Trash2 size={17} /> Elimina</button>
            </div>

            {editing ? (
              <div className="mx-auto mt-3 flex max-w-3xl flex-col gap-3 rounded-2xl border border-white/10 bg-slate-950/55 p-3">
                <input value={activeBinder.title} onChange={event => updateActive(binder => ({ ...binder, title: event.target.value }))} maxLength={60} className="w-full rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-base font-bold text-white outline-none focus:border-cyan-300" aria-label="Nome raccoglitore" />
                <div className="flex flex-wrap gap-2">{BINDER_COLORS.map(color => <button key={color} type="button" onClick={() => updateActive(binder => ({ ...binder, cover_color: color }))} className={`h-8 w-8 rounded-full border-2 transition active:scale-90 ${activeBinder.cover_color === color ? 'scale-110 border-white' : 'border-transparent'}`} style={{ backgroundColor: color }} aria-label={`Copertina ${color}`} />)}</div>
                <div className="flex w-fit rounded-xl border border-white/10 bg-slate-900 p-1">{layouts.map(layout => <button key={layout.label} type="button" onClick={() => changeLayout(layout.columns, layout.rows)} className={`rounded-lg px-3 py-1.5 text-xs font-black transition ${activeBinder.columns_count === layout.columns && activeBinder.rows_count === layout.rows ? 'bg-cyan-300 text-slate-950' : 'text-slate-300'}`}>{layout.label}</button>)}</div>
              </div>
            ) : null}

            {status ? <p className="mx-auto mt-3 max-w-3xl rounded-2xl border border-white/10 bg-slate-950/55 px-3 py-2 text-center text-xs font-bold text-slate-200">{status}</p> : null}
            <div className="mt-4"><BinderSocial binder={activeBinder} /></div>
          </>
        )}
      </main>

      {introOpen ? (
        <div className="fixed inset-0 z-[100] grid place-items-center bg-black/72 p-4 backdrop-blur-md">
          <div className="w-full max-w-md rounded-[1.75rem] border border-cyan-200/20 bg-[#173c46] p-5 shadow-2xl">
            <div className="grid h-12 w-12 place-items-center rounded-2xl bg-cyan-300 text-slate-950"><BookOpen /></div>
            <h2 className="mt-4 text-2xl font-black">Crea i tuoi raccoglitori personalizzati</h2>
            <p className="mt-4 text-sm leading-6 text-slate-200">Personalizza ogni raccoglitore scegliendo nome, colore, formato delle pagine e carte. Organizza la tua collezione e condividi i raccoglitori con i tuoi amici.</p>
            <button type="button" onClick={closeIntro} className="mt-5 w-full rounded-2xl bg-cyan-300 px-4 py-3 font-black text-slate-950 transition active:scale-[0.98]">Ho capito</button>
          </div>
        </div>
      ) : null}

      {createOpen ? (
        <div className="fixed inset-0 z-[95] flex items-end justify-center bg-black/72 p-2 backdrop-blur-md sm:items-center sm:p-4" onClick={() => setCreateOpen(false)}>
          <div className="w-full max-w-xl rounded-[1.75rem] border border-white/12 bg-[#173c46] p-4 shadow-2xl sm:p-5" onClick={event => event.stopPropagation()}>
            <div className="flex items-center justify-between"><h2 className="text-xl font-black">Nuovo raccoglitore</h2><button onClick={() => setCreateOpen(false)} className="grid h-9 w-9 place-items-center rounded-xl bg-white/[0.06]" aria-label="Chiudi"><X size={17} /></button></div>
            <input value={newTitle} onChange={event => setNewTitle(event.target.value)} maxLength={60} className="mt-4 w-full rounded-2xl border border-slate-700 bg-slate-900 px-4 py-3 text-base font-bold outline-none focus:border-cyan-300" placeholder="Nome raccoglitore" />
            <p className="mt-4 text-xs font-black uppercase tracking-[0.15em] text-slate-400">Copertina</p>
            <div className="mt-2 flex flex-wrap gap-2">{BINDER_COLORS.map(color => <button key={color} type="button" onClick={() => setNewColor(color)} className={`h-10 w-10 rounded-full border-2 transition active:scale-90 ${newColor === color ? 'border-white scale-110' : 'border-transparent'}`} style={{ backgroundColor: color }} aria-label={`Colore ${color}`} />)}</div>
            <p className="mt-4 text-xs font-black uppercase tracking-[0.15em] text-slate-400">Tasche per pagina</p>
            <div className="mt-2 grid grid-cols-4 gap-2">{layouts.map(layout => <button key={layout.label} type="button" onClick={() => setNewLayout(layout)} className={`rounded-xl border px-2 py-3 text-sm font-black transition active:scale-95 ${newLayout.label === layout.label ? 'border-cyan-200/40 bg-cyan-300 text-slate-950' : 'border-white/10 bg-white/[0.05] text-slate-200'}`}>{layout.label}</button>)}</div>
            {status ? <p className="mt-3 text-center text-xs font-bold text-rose-100">{status}</p> : null}
            <button type="button" onClick={createBinder} disabled={creating || !newTitle.trim()} className="mt-5 inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-cyan-300 px-4 py-3 font-black text-slate-950 transition active:scale-[0.98] disabled:opacity-45">{creating ? 'Creo...' : <><Check size={18} /> Crea</>}</button>
          </div>
        </div>
      ) : null}

      {pickerSlot ? (
        <div className="fixed inset-0 z-[105] flex items-end justify-center bg-black/76 p-2 backdrop-blur-md sm:items-center sm:p-4" onClick={() => setPickerSlot(null)}>
          <div className="flex max-h-[88dvh] w-full max-w-3xl flex-col overflow-hidden rounded-[1.75rem] border border-white/12 bg-[#163943] shadow-2xl" onClick={event => event.stopPropagation()}>
            <div className="flex items-center gap-2 border-b border-white/10 p-3">
              <div className="flex rounded-xl border border-white/10 bg-slate-950/40 p-1">
                <button type="button" onClick={() => { setPickerSource('collection'); setFilterRarity('all') }} className={`rounded-lg px-3 py-2 text-xs font-black ${pickerSource === 'collection' ? 'bg-cyan-300 text-slate-950' : 'text-slate-300'}`}>Mie carte</button>
                <button type="button" onClick={() => { setPickerSource('catalog'); setFilterRarity('all') }} className={`rounded-lg px-3 py-2 text-xs font-black ${pickerSource === 'catalog' ? 'bg-cyan-300 text-slate-950' : 'text-slate-300'}`}>Catalogo</button>
              </div>
              <button type="button" onClick={() => setPickerSlot(null)} className="ml-auto grid h-9 w-9 place-items-center rounded-xl bg-white/[0.06]" aria-label="Chiudi"><X size={17} /></button>
            </div>
            <label className="relative m-3 mb-0 block"><Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={17} /><input value={query} onChange={event => setQuery(event.target.value)} className="w-full rounded-2xl border border-slate-700 bg-slate-950/70 py-3 pl-10 pr-4 text-base outline-none focus:border-cyan-300" placeholder={pickerSource === 'catalog' ? 'Cerca nome o codice' : 'Cerca nella collezione'} /></label>
            <div className="mx-3 mt-2">
              <div className="flex items-center justify-between gap-2">
                <button type="button" onClick={() => setFiltersOpen(value => !value)} className={`inline-flex items-center gap-2 rounded-xl border px-3 py-2 text-xs font-black transition active:scale-95 ${activeFilterCount ? 'border-cyan-200/35 bg-cyan-300/15 text-cyan-100' : 'border-white/10 bg-white/[0.05] text-slate-300'}`}>
                  <SlidersHorizontal size={15} /> Filtri {activeFilterCount ? `(${activeFilterCount})` : ''}
                </button>
                {activeFilterCount ? <button type="button" onClick={() => { setFilterColor('all'); setFilterRarity('all'); setFilterCost('all'); setFilterPower('all') }} className="px-2 py-2 text-xs font-black text-slate-400 transition active:scale-95">Azzera</button> : null}
              </div>
              {filtersOpen ? (
                <div className="mt-2 grid grid-cols-2 gap-2 rounded-2xl border border-white/10 bg-slate-950/45 p-2 sm:grid-cols-4">
                  <label className="min-w-0"><span className="mb-1 block text-[9px] font-black uppercase text-slate-400">Colore</span><select value={filterColor} onChange={event => setFilterColor(event.target.value)} className="w-full rounded-xl border border-slate-700 bg-slate-900 px-2 py-2 text-base font-bold text-white outline-none sm:text-xs"><option value="all">Tutti</option>{['red', 'blue', 'green', 'purple', 'black', 'yellow'].map(color => <option key={color} value={color}>{color.charAt(0).toUpperCase() + color.slice(1)}</option>)}</select></label>
                  <label className="min-w-0"><span className="mb-1 block text-[9px] font-black uppercase text-slate-400">Rarita</span><select value={filterRarity} onChange={event => setFilterRarity(event.target.value)} className="w-full rounded-xl border border-slate-700 bg-slate-900 px-2 py-2 text-base font-bold text-white outline-none sm:text-xs"><option value="all">Tutte</option>{availableRarities.map(rarity => <option key={rarity} value={rarity}>{rarity}</option>)}</select></label>
                  <label className="min-w-0"><span className="mb-1 block text-[9px] font-black uppercase text-slate-400">Costo</span><select value={filterCost} onChange={event => setFilterCost(event.target.value)} className="w-full rounded-xl border border-slate-700 bg-slate-900 px-2 py-2 text-base font-bold text-white outline-none sm:text-xs"><option value="all">Qualsiasi</option><option value="0-2">0 - 2</option><option value="3-5">3 - 5</option><option value="6+">6+</option></select></label>
                  <label className="min-w-0"><span className="mb-1 block text-[9px] font-black uppercase text-slate-400">Forza</span><select value={filterPower} onChange={event => setFilterPower(event.target.value)} className="w-full rounded-xl border border-slate-700 bg-slate-900 px-2 py-2 text-base font-bold text-white outline-none sm:text-xs"><option value="all">Qualsiasi</option><option value="0-4000">0 - 4000</option><option value="5000-7000">5000 - 7000</option><option value="8000+">8000+</option></select></label>
                </div>
              ) : null}
            </div>
            <div className="mt-3 min-h-44 flex-1 overflow-y-auto p-3 pt-0">
              {searching ? <p className="py-10 text-center text-sm text-slate-400">Cerco carte...</p> : displayedCards.length === 0 ? <p className="py-10 text-center text-sm text-slate-400">{pickerSource === 'catalog' && query.trim().length < 2 ? 'Scrivi almeno 2 caratteri.' : 'Nessuna carta trovata.'}</p> : (
                <div className="grid grid-cols-3 gap-2 sm:grid-cols-5 lg:grid-cols-7">{displayedCards.map(card => <button key={card.card_id} type="button" onClick={() => selectCard(card)} className="min-w-0 rounded-xl border border-white/10 bg-slate-950/45 p-1.5 text-left transition hover:border-cyan-200/50 active:scale-95"><CardImage src={card.image_url} cardId={card.card_id} alt={card.name} className="aspect-[3/4] overflow-hidden rounded-lg bg-slate-900" /><p className="mt-1 line-clamp-1 text-[10px] font-black text-white">{card.name}</p><p className="truncate text-[8px] text-slate-400">{card.card_id}</p></button>)}</div>
              )}
            </div>
          </div>
        </div>
      ) : null}

      <BinderCardDetail card={selectedBinderCard} onClose={() => setSelectedBinderCard(null)} />
    </div>
  )
}
