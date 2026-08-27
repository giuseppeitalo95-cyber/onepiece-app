'use client'

import { useEffect, useRef, useState } from 'react'
import { CheckCircle2, ExternalLink, LoaderCircle, Pencil, Save, Search } from 'lucide-react'
import CardImage from '@/app/components/CardImage'
import { supabase } from '@/lib/supabase'

type SearchCard = {
  id: string
  name: string
  image_url: string | null
  rarity: string | null
  card_color: string | null
}

type Candidate = {
  product_id: number
  product_name: string
  expansion_id: number | null
  variant_rank: number
  url_version: number | null
  price: number | null
  price_low: number | null
  price_trend: number | null
  price_avg_1: number | null
  price_avg_7: number | null
  price_avg_30: number | null
  synced_at: string
  image_url: string | null
  product_url: string
}

type CardDraft = {
  variant_id: string
  base_card_id: string
  name: string
  rarity: string
  card_color: string
  card_type: string
  card_cost: number | string
  card_power: number | string
  card_counter: number | string
  life: number | string
  attribute: string
  card_text: string
  set_name: string
  sub_types: string
  source_image_url: string
  preview_image_url: string
  variant_label: string
  cardmarket_product_id: number | string
  cardmarket_url: string
  market_price: number | null
  manual_price_enabled: boolean
  manual_price_override: number | string
  price_mapping_locked?: boolean
}

const fieldClass = 'w-full rounded-2xl border border-slate-700 bg-slate-950/80 px-3.5 py-3 text-sm text-white outline-none transition focus:border-cyan-200'
const formatPrice = (value?: number | null) => value == null
  ? '-'
  : new Intl.NumberFormat('it-IT', { style: 'currency', currency: 'EUR' }).format(value)

export default function CatalogCardEditor() {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<SearchCard[]>([])
  const [card, setCard] = useState<CardDraft | null>(null)
  const [candidates, setCandidates] = useState<Candidate[]>([])
  const [loading, setLoading] = useState<'search' | 'load' | 'save' | ''>('')
  const [message, setMessage] = useState('')
  const searchRun = useRef(0)

  const getToken = async () => (await supabase.auth.getSession()).data.session?.access_token || ''

  useEffect(() => {
    const text = query.trim()
    if (text.length < 2) {
      searchRun.current += 1
      return
    }

    const run = ++searchRun.current
    const timer = window.setTimeout(async () => {
      setLoading('search')
      try {
        const response = await fetch(`/api/cards/search?q=${encodeURIComponent(text)}`)
        const data = await response.json()
        if (run !== searchRun.current) return
        const cards = Array.isArray(data) ? data : []
        setResults(cards.slice(0, 40).map(item => ({
          id: String(item.card_set_id ?? item.card_id ?? item.id ?? ''),
          name: String(item.card_name ?? item.name ?? 'Carta'),
          image_url: item.card_image ?? item.image_url ?? null,
          rarity: item.rarity ?? null,
          card_color: item.card_color ?? null,
        })).filter(item => item.id))
      } catch {
        if (run === searchRun.current) setResults([])
      } finally {
        if (run === searchRun.current) setLoading('')
      }
    }, 250)

    return () => window.clearTimeout(timer)
  }, [query])

  const loadCard = async (variantId: string) => {
    setLoading('load')
    setMessage('')
    try {
      const response = await fetch('/api/admin/card-import', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${await getToken()}`,
        },
        body: JSON.stringify({ action: 'load', variant_id: variantId }),
      })
      const data = await response.json()
      if (!response.ok || !data?.ok) throw new Error(data?.error || 'Carta non caricata.')
      setCard(data.card)
      setCandidates(Array.isArray(data.candidates) ? data.candidates : [])
      setResults([])
      setQuery('')
      setMessage('Modifica i dati e salva. Le correzioni saranno applicate anche alle copie gia in collezione.')
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Carta non caricata.')
    }
    setLoading('')
  }

  const update = (key: keyof CardDraft, value: string | number | boolean) => {
    setCard(current => current ? { ...current, [key]: value } : current)
  }

  const chooseCandidate = (candidate: Candidate) => {
    setCard(current => current ? {
      ...current,
      cardmarket_product_id: candidate.product_id,
      cardmarket_url: candidate.product_url,
      market_price: candidate.price,
      manual_price_enabled: false,
      manual_price_override: '',
      price_mapping_locked: true,
    } : current)
    setMessage(`Prodotto Cardmarket ${candidate.product_id} selezionato. Salva per collegarlo alla carta.`)
  }

  const save = async () => {
    if (!card || loading) return
    setLoading('save')
    setMessage('Salvataggio correzioni...')
    try {
      const response = await fetch('/api/admin/card-import', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${await getToken()}`,
        },
        body: JSON.stringify({ action: 'update', card }),
      })
      const data = await response.json()
      if (!response.ok || !data?.ok) throw new Error(data?.error || 'Modifica non riuscita.')
      setCard(current => current ? {
        ...current,
        preview_image_url: data.card.image_url || current.preview_image_url,
        market_price: data.card.market_price,
        cardmarket_product_id: data.card.cardmarket_product_id ?? current.cardmarket_product_id,
        price_mapping_locked: Boolean(data.card.price_mapping_locked),
      } : current)
      setMessage(`Carta ${data.card.variant_id} aggiornata correttamente.`)
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Modifica non riuscita.')
    }
    setLoading('')
  }

  return (
    <div className="space-y-5">
      <section className="rounded-[1.75rem] border border-violet-200/20 bg-slate-900/90 p-5">
        <div className="flex items-start gap-3">
          <span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-violet-300/10 text-violet-100"><Pencil size={20} /></span>
          <div>
            <h2 className="text-xl font-black text-white">Modifica carta catalogo</h2>
            <p className="mt-1 text-sm leading-6 text-slate-400">Cerca una carta per nome o codice, correggi dati, immagine e prezzo.</p>
          </div>
        </div>

        <div className="relative mt-5">
          <Search className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-slate-500" size={18} />
          <input value={query} onChange={event => {
            const value = event.target.value
            setQuery(value)
            if (value.trim().length < 2) {
              setResults([])
              setLoading('')
            }
          }} placeholder="Cerca nome o codice carta" className={`${fieldClass} pl-11`} />
          {loading === 'search' ? <LoaderCircle className="absolute right-4 top-1/2 -translate-y-1/2 animate-spin text-cyan-100" size={18} /> : null}
        </div>

        {results.length > 0 ? (
          <div className="mt-4 grid max-h-[420px] gap-2 overflow-y-auto pr-1 sm:grid-cols-2">
            {results.map(result => (
              <button key={result.id} type="button" onClick={() => void loadCard(result.id)} disabled={loading === 'load'} className="flex items-center gap-3 rounded-2xl border border-slate-700 bg-slate-950/75 p-2.5 text-left transition hover:border-cyan-200/60 active:scale-[0.985]">
                <CardImage src={result.image_url} cardId={result.id} alt={result.name} className="h-20 w-14 shrink-0 overflow-hidden rounded-xl bg-slate-900" imgClassName="h-full w-full object-cover" />
                <span className="min-w-0">
                  <span className="block truncate text-sm font-black text-white">{result.name}</span>
                  <span className="mt-1 block text-xs text-cyan-100">{result.id}</span>
                  <span className="block text-[10px] text-slate-500">{result.rarity || '-'} · {result.card_color || '-'}</span>
                </span>
              </button>
            ))}
          </div>
        ) : null}

        {message ? <p className="mt-4 rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 text-sm text-slate-300">{message}</p> : null}
      </section>

      {card ? (
        <div className="space-y-5">
          <section className="rounded-[1.75rem] border border-violet-200/20 bg-slate-900/90 p-5">
            <div>
              <h3 className="text-lg font-black text-white">Seleziona variante e prezzo</h3>
              <p className="mt-1 text-xs text-slate-400">Tutti i prodotti Cardmarket con codice {card.base_card_id}. Seleziona la variante corretta guardando immagine e prezzo.</p>
            </div>
            {candidates.length > 0 ? (
              <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                {candidates.map(candidate => {
                  const selected = Number(candidate.product_id) === Number(card.cardmarket_product_id)
                  return (
                    <button
                      key={candidate.product_id}
                      type="button"
                      onClick={() => chooseCandidate(candidate)}
                      className={`flex min-h-28 items-center gap-3 rounded-2xl border p-3 text-left transition active:scale-[0.985] ${selected ? 'border-cyan-200 bg-cyan-300/10' : 'border-slate-700 bg-slate-950/70 hover:border-slate-500'}`}
                    >
                      <CardImage src={candidate.image_url} cardId={card.base_card_id} alt={candidate.product_name} className="h-24 w-17 shrink-0 overflow-hidden rounded-xl bg-slate-900" imgClassName="h-full w-full object-cover" />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-black text-white">{candidate.product_name}</span>
                        <span className="mt-1 block text-xs text-slate-400">Prodotto {candidate.product_id}{candidate.url_version ? ` · V.${candidate.url_version}` : ''}</span>
                        <span className="mt-2 block text-lg font-black text-cyan-100">{formatPrice(candidate.price)}</span>
                        <span className="block text-[10px] text-slate-500">Media 7g {formatPrice(candidate.price_avg_7)} · minimo {formatPrice(candidate.price_low)}</span>
                      </span>
                      {selected ? <CheckCircle2 size={19} className="shrink-0 text-cyan-100" /> : null}
                    </button>
                  )
                })}
              </div>
            ) : (
              <p className="mt-4 rounded-2xl border border-amber-300/20 bg-amber-300/[0.06] px-4 py-3 text-sm text-amber-100">Nessuna variante di prezzo trovata per questo codice.</p>
            )}
            {card.cardmarket_product_id ? (
              <div className="mt-3 flex flex-wrap items-center gap-3">
                <a href={candidates.find(candidate => candidate.product_id === Number(card.cardmarket_product_id))?.product_url || card.cardmarket_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 text-xs font-bold text-cyan-100 hover:text-white">
                  Apri prodotto selezionato <ExternalLink size={13} />
                </a>
                <span className="rounded-full border border-emerald-300/25 bg-emerald-300/10 px-3 py-1 text-[10px] font-black uppercase text-emerald-100">
                  Collegamento fisso ID {card.cardmarket_product_id}
                </span>
              </div>
            ) : null}
            {card.cardmarket_product_id ? <p className="mt-2 text-xs text-slate-400">Gli aggiornamenti cambieranno il prezzo, ma non il prodotto o la variante selezionata.</p> : null}
          </section>

        <section className="rounded-[1.75rem] border border-white/10 bg-slate-900/90 p-5">
          <div className="grid gap-5 lg:grid-cols-[230px_1fr]">
            <div>
              <CardImage src={card.preview_image_url || card.source_image_url} cardId={card.variant_id} alt={card.name} className="mx-auto aspect-[5/7] w-full max-w-[230px] overflow-hidden rounded-2xl bg-slate-950" imgClassName="h-full w-full object-cover" />
              <p className="mt-2 text-center text-2xl font-black text-cyan-100">{formatPrice(card.manual_price_enabled ? Number(card.manual_price_override) : card.market_price)}</p>
              <p className="text-center text-[10px] font-black uppercase text-slate-500">{card.manual_price_enabled ? 'Prezzo manuale' : 'Prezzo automatico'}</p>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <label className="sm:col-span-2"><span className="mb-1 block text-xs font-bold text-slate-400">Nome</span><input className={fieldClass} value={card.name} onChange={event => update('name', event.target.value)} /></label>
              <label><span className="mb-1 block text-xs font-bold text-slate-400">Codice carta</span><input className={fieldClass} value={card.base_card_id} onChange={event => update('base_card_id', event.target.value.toUpperCase())} /></label>
              <label><span className="mb-1 block text-xs font-bold text-slate-400">ID variante OPV</span><input className={`${fieldClass} cursor-not-allowed opacity-60`} value={card.variant_id} readOnly /></label>
              <label><span className="mb-1 block text-xs font-bold text-slate-400">Variante</span><input className={fieldClass} value={card.variant_label} onChange={event => update('variant_label', event.target.value)} /></label>
              <label><span className="mb-1 block text-xs font-bold text-slate-400">Rarita</span><input className={fieldClass} value={card.rarity} onChange={event => update('rarity', event.target.value)} /></label>
              <label><span className="mb-1 block text-xs font-bold text-slate-400">Colore</span><input className={fieldClass} value={card.card_color} onChange={event => update('card_color', event.target.value)} /></label>
              <label><span className="mb-1 block text-xs font-bold text-slate-400">Tipo carta</span><input className={fieldClass} value={card.card_type} onChange={event => update('card_type', event.target.value)} /></label>
              <label className="sm:col-span-2"><span className="mb-1 block text-xs font-bold text-slate-400">Espansione</span><input className={fieldClass} value={card.set_name} onChange={event => update('set_name', event.target.value)} /></label>
              {(['card_cost', 'card_power', 'card_counter', 'life'] as const).map(key => (
                <label key={key}><span className="mb-1 block text-xs font-bold capitalize text-slate-400">{key.replace('card_', '')}</span><input type="number" className={fieldClass} value={card[key]} onChange={event => update(key, event.target.value)} /></label>
              ))}
              <label><span className="mb-1 block text-xs font-bold text-slate-400">Attributo</span><input className={fieldClass} value={card.attribute} onChange={event => update('attribute', event.target.value)} /></label>
              <label><span className="mb-1 block text-xs font-bold text-slate-400">Sottotipi</span><input className={fieldClass} value={card.sub_types} onChange={event => update('sub_types', event.target.value)} /></label>
              <label className="sm:col-span-2"><span className="mb-1 block text-xs font-bold text-slate-400">Effetto</span><textarea rows={5} className={`${fieldClass} resize-y`} value={card.card_text} onChange={event => update('card_text', event.target.value)} /></label>
              <label className="sm:col-span-2"><span className="mb-1 block text-xs font-bold text-slate-400">URL immagine</span><input className={fieldClass} value={card.source_image_url} onChange={event => { update('source_image_url', event.target.value); update('preview_image_url', event.target.value) }} /></label>
              <label><span className="mb-1 block text-xs font-bold text-slate-400">ID prodotto Cardmarket</span><input type="number" className={fieldClass} value={card.cardmarket_product_id} onChange={event => update('cardmarket_product_id', event.target.value)} /></label>
              <label><span className="mb-1 block text-xs font-bold text-slate-400">Link Cardmarket</span><input className={fieldClass} value={card.cardmarket_url} onChange={event => update('cardmarket_url', event.target.value)} /></label>

              <div className="sm:col-span-2 rounded-2xl border border-amber-200/20 bg-amber-300/[0.06] p-4">
                <label className="flex cursor-pointer items-center justify-between gap-4">
                  <span><span className="block text-sm font-black text-white">Usa prezzo manuale</span><span className="mt-1 block text-xs text-slate-400">Ha priorita su Cardmarket finche resta attivo.</span></span>
                  <input type="checkbox" checked={card.manual_price_enabled} onChange={event => update('manual_price_enabled', event.target.checked)} className="h-5 w-5 accent-amber-300" />
                </label>
                {card.manual_price_enabled ? <input type="number" min="0" step="0.01" value={card.manual_price_override} onChange={event => update('manual_price_override', event.target.value)} placeholder="Prezzo in euro" className={`${fieldClass} mt-3`} /> : null}
              </div>
            </div>
          </div>

          <button type="button" onClick={() => void save()} disabled={Boolean(loading)} className="mt-5 inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-emerald-300 px-5 py-3.5 text-sm font-black text-slate-950 transition active:scale-[0.985] disabled:opacity-50 sm:w-auto">
            {loading === 'save' ? <LoaderCircle size={17} className="animate-spin" /> : message.includes('correttamente') ? <CheckCircle2 size={17} /> : <Save size={17} />}
            {loading === 'save' ? 'Salvo...' : 'Salva modifiche'}
          </button>
        </section>
        </div>
      ) : null}
    </div>
  )
}
