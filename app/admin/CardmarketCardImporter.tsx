'use client'

import { useState } from 'react'
import { CheckCircle2, ExternalLink, Link2, LoaderCircle, Save, Search, TriangleAlert } from 'lucide-react'
import CardImage from '@/app/components/CardImage'
import { supabase } from '@/lib/supabase'

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

type Duplicate = {
  variant_id: string
  name: string
  rarity: string | null
  image_url: string | null
  cardmarket_product_id: number | null
  is_manual: boolean
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
  variant_label: string
  cardmarket_product_id: number
  cardmarket_url: string
  market_price: number | null
}

type Analysis = {
  parsed: {
    card_code: string
    version: number
    set_folder: string
    cardmarket_url: string
  }
  selected_product_id: number
  candidates: Candidate[]
  duplicates: Duplicate[]
  card: CardDraft
}

const formatPrice = (value?: number | null) => value == null
  ? '-'
  : new Intl.NumberFormat('it-IT', { style: 'currency', currency: 'EUR' }).format(value)

const fieldClass = 'w-full rounded-2xl border border-slate-700 bg-slate-950/80 px-3.5 py-3 text-sm text-white outline-none transition focus:border-cyan-200'

export default function CardmarketCardImporter() {
  const [url, setUrl] = useState('')
  const [analysis, setAnalysis] = useState<Analysis | null>(null)
  const [card, setCard] = useState<CardDraft | null>(null)
  const [loading, setLoading] = useState<'analyze' | 'save' | ''>('')
  const [message, setMessage] = useState('')
  const [saved, setSaved] = useState<{ variant_id: string; name: string; image_url: string; market_price: number | null } | null>(null)

  const token = async () => (await supabase.auth.getSession()).data.session?.access_token || ''

  const analyze = async () => {
    if (!url.trim() || loading) return
    setLoading('analyze')
    setMessage('')
    setSaved(null)
    setAnalysis(null)
    setCard(null)

    try {
      const accessToken = await token()
      const response = await fetch('/api/admin/card-import', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({ action: 'analyze', url: url.trim() }),
      })
      const data = await response.json()
      if (!response.ok || !data?.ok) throw new Error(data?.error || 'Analisi non riuscita.')
      setAnalysis(data)
      setCard(data.card)
      setMessage(data.duplicates?.length
        ? 'Ho trovato carte con lo stesso codice. Controllale prima di salvare la nuova variante.'
        : 'Scheda elaborata. Controlla i dati e salvala nel catalogo.')
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Analisi non riuscita.')
    }

    setLoading('')
  }

  const chooseCandidate = (candidate: Candidate) => {
    if (!card) return
    setAnalysis(current => current ? { ...current, selected_product_id: candidate.product_id } : current)
    setCard({
      ...card,
      cardmarket_product_id: candidate.product_id,
      market_price: candidate.price,
      source_image_url: candidate.image_url || card.source_image_url,
      name: candidate.product_name.replace(/\s*\([A-Z0-9-]+\)\s*$/i, '').trim() || card.name,
    })
  }

  const update = (key: keyof CardDraft, value: string | number) => {
    setCard(current => current ? { ...current, [key]: value } : current)
  }

  const save = async () => {
    if (!card || !analysis || loading) return
    const force = analysis.duplicates.length > 0
    if (force && !window.confirm(`Esistono ${analysis.duplicates.length} carte con codice ${card.base_card_id}. Salvare comunque questa variante?`)) return

    setLoading('save')
    setMessage('Salvataggio carta e copia immagine su Cloudflare...')
    setSaved(null)

    try {
      const accessToken = await token()
      const response = await fetch('/api/admin/card-import', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({ action: 'save', card, force }),
      })
      const responseText = await response.text()
      const data = responseText ? JSON.parse(responseText) : null
      if (!response.ok || !data?.ok) throw new Error(data?.error || 'Salvataggio non riuscito.')
      setSaved(data.card)
      setMessage(`Carta salvata come ${data.card.variant_id}. Il prezzo seguira gli aggiornamenti Cardmarket.`)
      setAnalysis(null)
      setCard(null)
      setUrl('')
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Salvataggio non riuscito.')
    }

    setLoading('')
  }

  return (
    <div className="space-y-5">
      <section className="rounded-[1.75rem] border border-cyan-200/20 bg-slate-900/90 p-5">
        <div className="flex items-start gap-3">
          <span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-cyan-300/10 text-cyan-100">
            <Link2 size={20} />
          </span>
          <div>
            <h2 className="text-xl font-black text-white">Importa da Cardmarket</h2>
            <p className="mt-1 max-w-3xl text-sm leading-6 text-slate-400">
              Incolla il link della variante. OPV trova il prodotto esatto, prepara la scheda, controlla i doppioni e collega il prezzo aggiornato.
            </p>
          </div>
        </div>

        <div className="mt-5 flex flex-col gap-3 sm:flex-row">
          <input
            value={url}
            onChange={event => setUrl(event.target.value)}
            onKeyDown={event => {
              if (event.key === 'Enter') void analyze()
            }}
            placeholder="https://www.cardmarket.com/it/OnePiece/Products/Singles/..."
            className={`${fieldClass} min-w-0 flex-1`}
          />
          <button
            type="button"
            onClick={() => void analyze()}
            disabled={!url.trim() || Boolean(loading)}
            className="inline-flex min-h-12 items-center justify-center gap-2 rounded-2xl bg-cyan-300 px-5 text-sm font-black text-slate-950 transition active:scale-[0.98] disabled:opacity-40"
          >
            {loading === 'analyze' ? <LoaderCircle size={17} className="animate-spin" /> : <Search size={17} />}
            {loading === 'analyze' ? 'Elaboro...' : 'Elabora link'}
          </button>
        </div>

        {message ? (
          <div className={`mt-4 rounded-2xl border px-4 py-3 text-sm ${saved ? 'border-emerald-300/20 bg-emerald-300/10 text-emerald-100' : analysis?.duplicates.length ? 'border-amber-300/20 bg-amber-300/10 text-amber-100' : 'border-white/10 bg-white/[0.04] text-slate-300'}`}>
            {message}
          </div>
        ) : null}

        {saved ? (
          <div className="mt-4 flex items-center gap-4 rounded-3xl border border-emerald-300/20 bg-slate-950/70 p-4">
            <CardImage src={saved.image_url} cardId={saved.variant_id} alt={saved.name} className="h-24 w-17 overflow-hidden rounded-xl bg-slate-900" imgClassName="h-full w-full object-cover" />
            <div className="min-w-0">
              <div className="flex items-center gap-2 text-emerald-100"><CheckCircle2 size={17} /><span className="text-xs font-black uppercase">Nel catalogo OPV</span></div>
              <p className="mt-1 truncate font-black text-white">{saved.name}</p>
              <p className="text-xs text-slate-400">{saved.variant_id} · {formatPrice(saved.market_price)}</p>
            </div>
          </div>
        ) : null}
      </section>

      {analysis && card ? (
        <>
          {analysis.duplicates.length > 0 ? (
            <section className="rounded-[1.75rem] border border-amber-300/25 bg-amber-300/[0.06] p-5">
              <div className="flex items-center gap-2 text-amber-100">
                <TriangleAlert size={19} />
                <h3 className="font-black">Carta gia presente?</h3>
              </div>
              <p className="mt-2 text-sm text-slate-300">Queste carte condividono il codice {analysis.parsed.card_code}. Verifica immagine e variante; potrai comunque salvarne una nuova.</p>
              <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
                {analysis.duplicates.map(duplicate => (
                  <div key={duplicate.variant_id} className="rounded-2xl border border-white/10 bg-slate-950/70 p-2.5">
                    <CardImage src={duplicate.image_url} cardId={duplicate.variant_id} alt={duplicate.name} className="aspect-[5/7] w-full overflow-hidden rounded-xl bg-slate-900" imgClassName="h-full w-full object-cover" />
                    <p className="mt-2 truncate text-xs font-black text-white">{duplicate.name}</p>
                    <p className="truncate text-[10px] text-slate-500">{duplicate.variant_id}</p>
                    {duplicate.cardmarket_product_id ? <p className="text-[10px] text-cyan-200">CM {duplicate.cardmarket_product_id}</p> : null}
                  </div>
                ))}
              </div>
            </section>
          ) : null}

          <section className="rounded-[1.75rem] border border-violet-200/20 bg-slate-900/90 p-5">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h3 className="text-lg font-black text-white">Prodotto e prezzo esatti</h3>
                <p className="mt-1 text-xs text-slate-400">Quello riconosciuto dal link e gia selezionato. Cambialo solo se foto o versione non coincidono.</p>
              </div>
              <span className="rounded-full bg-violet-300/10 px-3 py-1 text-xs font-black text-violet-100">V.{analysis.parsed.version}</span>
            </div>
            <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {analysis.candidates.map(candidate => {
                const selected = candidate.product_id === card.cardmarket_product_id
                return (
                  <button
                    key={candidate.product_id}
                    type="button"
                    onClick={() => chooseCandidate(candidate)}
                    className={`flex min-h-28 items-center gap-3 rounded-2xl border p-3 text-left transition active:scale-[0.985] ${selected ? 'border-cyan-200 bg-cyan-300/10' : 'border-slate-700 bg-slate-950/70 hover:border-slate-500'}`}
                  >
                    <CardImage src={candidate.image_url} cardId={analysis.parsed.card_code} alt={candidate.product_name} className="h-24 w-17 shrink-0 overflow-hidden rounded-xl bg-slate-900" imgClassName="h-full w-full object-cover" />
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
            <a href={analysis.candidates.find(candidate => candidate.product_id === card.cardmarket_product_id)?.product_url} target="_blank" rel="noreferrer" className="mt-3 inline-flex items-center gap-1.5 text-xs font-bold text-cyan-100 hover:text-white">
              Apri prodotto selezionato <ExternalLink size={13} />
            </a>
          </section>

          <section className="rounded-[1.75rem] border border-white/10 bg-slate-900/90 p-5">
            <div className="grid gap-5 lg:grid-cols-[230px_1fr]">
              <div>
                <CardImage src={card.source_image_url} cardId={card.variant_id} alt={card.name} className="mx-auto aspect-[5/7] w-full max-w-[230px] overflow-hidden rounded-2xl bg-slate-950" imgClassName="h-full w-full object-cover" />
                <p className="mt-2 text-center text-2xl font-black text-cyan-100">{formatPrice(card.market_price)}</p>
                <p className="text-center text-[10px] font-black uppercase text-slate-500">Prezzo Medio aggiornabile</p>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <label className="sm:col-span-2"><span className="mb-1 block text-xs font-bold text-slate-400">Nome</span><input className={fieldClass} value={card.name} onChange={event => update('name', event.target.value)} /></label>
                <label><span className="mb-1 block text-xs font-bold text-slate-400">Codice carta</span><input className={fieldClass} value={card.base_card_id} onChange={event => update('base_card_id', event.target.value.toUpperCase())} /></label>
                <label><span className="mb-1 block text-xs font-bold text-slate-400">ID variante OPV</span><input className={fieldClass} value={card.variant_id} onChange={event => update('variant_id', event.target.value)} /></label>
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
                <label className="sm:col-span-2"><span className="mb-1 block text-xs font-bold text-slate-400">URL immagine</span><input className={fieldClass} value={card.source_image_url} onChange={event => update('source_image_url', event.target.value)} /></label>
              </div>
            </div>

            <button
              type="button"
              onClick={() => void save()}
              disabled={Boolean(loading)}
              className={`mt-5 inline-flex w-full items-center justify-center gap-2 rounded-2xl px-5 py-3.5 text-sm font-black transition active:scale-[0.985] disabled:opacity-50 sm:w-auto ${analysis.duplicates.length ? 'bg-amber-300 text-slate-950' : 'bg-emerald-300 text-slate-950'}`}
            >
              {loading === 'save' ? <LoaderCircle size={17} className="animate-spin" /> : <Save size={17} />}
              {loading === 'save' ? 'Salvo...' : analysis.duplicates.length ? 'Salva comunque' : 'Salva nel catalogo'}
            </button>
          </section>
        </>
      ) : null}
    </div>
  )
}
