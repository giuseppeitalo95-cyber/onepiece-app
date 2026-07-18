'use client'

import { useEffect, useState } from 'react'
import { X } from 'lucide-react'
import CardImage from './CardImage'
import CardErrorReport from './CardErrorReport'
import { getRarityLabel } from '@/lib/rarity'
import type { BinderCard } from '@/lib/binders'

type CardDetails = BinderCard & {
  card_type?: string | null
  card_text?: string | null
}

const exactCode = (value: string) => value.trim().toUpperCase().replace(/\s+/g, '')
const cleanCode = (value: string) => exactCode(value).replace(/[^A-Z0-9]/g, '')
const displayCode = (value: string) => value.replace(/_p\d+$/i, '')
const priceNumber = (value: unknown): number | null => {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) return value
  if (!value || typeof value !== 'object') return null
  const price = value as Record<string, unknown>
  for (const key of ['marketPrice', 'midPrice', 'directLowPrice', 'lowPrice']) {
    const number = Number(price[key])
    if (Number.isFinite(number) && number > 0) return number
  }
  return null
}

function BinderCardDetailContent({ card, onClose }: { card: BinderCard; onClose: () => void }) {
  const [details, setDetails] = useState<CardDetails>(card)
  const [price, setPrice] = useState<number | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false

    void Promise.all([
      fetch(`/api/cards/search?q=${encodeURIComponent(card.card_id)}`).then(response => response.json()).catch(() => []),
      fetch(`/api/cards/price?cardId=${encodeURIComponent(card.card_id)}&name=${encodeURIComponent(card.name)}`).then(response => response.json()).catch(() => null),
    ]).then(([catalog, priceResponse]) => {
      if (cancelled) return
      const cards = Array.isArray(catalog) ? catalog : []
      const exact = cards.find(item => exactCode(String(item.card_set_id ?? item.card_id ?? item.id ?? '')) === exactCode(card.card_id))
        || cards.find(item => cleanCode(String(item.card_set_id ?? item.card_id ?? item.id ?? '')) === cleanCode(card.card_id))
      if (exact) setDetails({
        ...card,
        name: String(exact.card_name || exact.name || card.name),
        image_url: exact.card_image || exact.image_url || card.image_url,
        rarity: exact.rarity || card.rarity,
        card_color: exact.card_color || null,
        card_type: exact.card_type || null,
        card_cost: exact.card_cost ?? null,
        card_power: exact.card_power ?? null,
        card_text: exact.card_text || null,
      })
      setPrice(priceNumber(priceResponse?.price))
      setLoading(false)
    })

    return () => { cancelled = true }
  }, [card])

  return (
    <div className="fixed inset-0 z-[120] flex items-end justify-center bg-black/75 p-2 backdrop-blur-md sm:items-center sm:p-4" onClick={onClose}>
      <div className="relative max-h-[90dvh] w-full max-w-sm overflow-y-auto rounded-[1.5rem] border border-slate-700 bg-slate-950/98 p-3 shadow-2xl sm:max-w-2xl sm:p-5 lg:max-w-5xl" onClick={event => event.stopPropagation()}>
        <button type="button" onClick={onClose} className="absolute right-3 top-3 z-10 grid h-10 w-10 place-items-center rounded-2xl border border-white/10 bg-slate-950/80 text-white" aria-label="Chiudi carta"><X size={18} /></button>
        <div className="grid gap-4 lg:grid-cols-[360px_1fr] lg:gap-6">
          <CardImage src={details.image_url} cardId={details.card_id} alt={details.name} className="aspect-[3/4] overflow-hidden rounded-3xl border border-slate-700 bg-slate-900 p-2 lg:max-h-[70vh]" imgClassName="h-full w-full object-contain" loading="eager" />
          <div className="min-w-0 space-y-4 pt-1 lg:pt-3">
            <div><h2 className="pr-12 text-2xl font-black text-white">{details.name}</h2><p className="mt-1 text-sm font-black text-cyan-100">{displayCode(details.card_id)}</p></div>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {[
                ['Prezzo Medio', loading ? '...' : price == null ? '-' : new Intl.NumberFormat('it-IT', { style: 'currency', currency: 'EUR' }).format(price)],
                ['Rarita', getRarityLabel(details) || '-'],
                ['Colore', details.card_color || '-'],
                ['Tipo', details.card_type || '-'],
                ['Costo', details.card_cost ?? '-'],
                ['Power', details.card_power ?? '-'],
              ].map(([label, value]) => <div key={String(label)} className="rounded-2xl border border-white/10 bg-white/[0.05] p-3"><p className="text-[9px] font-black uppercase tracking-[0.15em] text-slate-400">{label}</p><p className="mt-1 truncate text-sm font-black text-white">{value}</p></div>)}
            </div>
            {details.card_text ? <p className="rounded-2xl border border-white/10 bg-white/[0.04] p-3 text-sm leading-6 text-slate-300">{details.card_text}</p> : null}
            <CardErrorReport cardId={details.card_id} cardName={details.name} pagePath="/binders" />
          </div>
        </div>
      </div>
    </div>
  )
}

export default function BinderCardDetail({ card, onClose }: { card: BinderCard | null; onClose: () => void }) {
  if (!card) return null
  return <BinderCardDetailContent key={`${card.card_id}-${card.image_url || ''}`} card={card} onClose={onClose} />
}
