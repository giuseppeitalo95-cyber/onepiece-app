'use client'

import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useRouter } from 'next/navigation'
import CardImage from '@/app/components/CardImage'

type Card = {
  id: string
  name: string
  image_url: string | null
  rarity: string | null

  // 🔥 NUOVI CAMPI API
  card_color?: string
  card_type?: string
  card_cost?: number
  card_power?: number
  market_price?: number
  inventory_price?: number
}

export default function AddCard() {
  const router = useRouter()

  const [query, setQuery] = useState('')
  const [cards, setCards] = useState<Card[]>([])
  const [userId, setUserId] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [addingId, setAddingId] = useState<string | null>(null)
  const [showReportForm, setShowReportForm] = useState(false)
  const [reportCardName, setReportCardName] = useState('')
  const [reportCardOp, setReportCardOp] = useState('')
  const [reportCardNumber, setReportCardNumber] = useState('')
  const [reportStatus, setReportStatus] = useState('')
  const [reportSubmitting, setReportSubmitting] = useState(false)
  const [selectedCard, setSelectedCard] = useState<Card | null>(null)
  const displayCardId = (value?: string | null) =>
    (value || '')
      .replace(/_p\d+$/i, '')
      .replace(/^((?:OP|ST|EB|PRB|SP|EX|CP)\d{2}-\d{3}|P-\d{3}|DON-\d{3})p\d+$/i, '$1')
  const formatPrice = (value?: number | null) =>
    value == null ? '---' : new Intl.NumberFormat('it-IT', { style: 'currency', currency: 'USD' }).format(value)

  // USER
  useEffect(() => {
    const loadUser = async () => {
      const { data } = await supabase.auth.getSession()

      if (!data.session?.user) {
        router.push('/')
        return
      }

      setUserId(data.session.user.id)
    }

    loadUser()
  }, [])

  // SEARCH
// SEARCH
useEffect(() => {
  const search = async () => {
    const q = query.trim()

    if (q.length < 2) {
      setCards([])
      return
    }

    setLoading(true)

    try {
      const res = await fetch(`/api/cards/search?q=${encodeURIComponent(q)}`)
      const data = await res.json()

      const clean: Card[] = (data || [])
        .map((c: any) => ({
          
          id: String(c.card_set_id ?? c.card_id ?? c.id),
          name: c.card_name || c.name,
          image_url: c.card_image || c.image_url || null,
          rarity: c.rarity || '—',

          card_color: c.card_color ?? null,
          card_type: c.card_type ?? null,
          card_cost: c.card_cost ? Number(c.card_cost) : null,
          card_power: c.card_power ? Number(c.card_power) : null,
          market_price: c.market_price ? Number(c.market_price) : null,
          inventory_price: c.inventory_price ? Number(c.inventory_price) : null,
        }))
        .slice(0, 50)

      setCards(clean)

    } catch {
      setCards([])
    }

    setLoading(false)
  }

  const t = setTimeout(search, 300)
  return () => clearTimeout(t)
}, [query])

  // ADD CARD
  const addCard = async (card: Card) => {
    if (!userId || addingId) return

    setAddingId(card.id)

    let livePriceForSave: number | null = null
    try {
      const params = new URLSearchParams()
      params.set('cardId', card.id)
      params.set('name', card.name)
      const res = await fetch(`/api/cards/price?${params.toString()}`)
      const data = await res.json()
      const price = data?.price
      livePriceForSave = price?.marketPrice ?? price?.midPrice ?? price?.lowPrice ?? null
    } catch {
      livePriceForSave = null
    }

    const { data: existing } = await supabase
      .from('user_cards')
      .select('id, quantity')
      .eq('user_id', userId)
      .eq('card_id', card.id)
      .maybeSingle()

    const payload = {
      user_id: userId,
      card_id: card.id,
      name: card.name,
      image_url: card.image_url,
      rarity: card.rarity,

      // 🔥 NUOVE STATISTICHE SALVATE
      card_color: card.card_color ?? null,
      card_type: card.card_type ?? null,
      card_cost: card.card_cost ?? null,
      card_power: card.card_power ?? null,
      market_price: livePriceForSave,
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

    setAddingId(null)
  }

  const submitMissingCardReport = async () => {
    if (!reportCardName.trim() || !reportCardOp.trim() || !reportCardNumber.trim()) {
      setReportStatus('Compila tutti i campi per inviare la segnalazione.')
      return
    }

    setReportSubmitting(true)
    setReportStatus('')

    try {
      const response = await fetch('/api/cards/report-missing', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          card_name: reportCardName.trim(),
          card_op: reportCardOp.trim(),
          card_number: reportCardNumber.trim(),
          user_id: userId,
        }),
      })

      if (!response.ok) {
        throw new Error('Errore invio segnalazione')
      }

      setReportStatus('Segnalazione inviata! Grazie per aver aiutato a migliorare il database.')
      setShowReportForm(false)
      setReportCardName('')
      setReportCardOp('')
      setReportCardNumber('')
    } catch (error) {
      console.error('Report error', error)
      setReportStatus('Errore durante l\'invio. Riprova tra poco.')
    }

    setReportSubmitting(false)
  }

  return (
    <div className="min-h-screen text-white onepiece-wave-bg onepiece-clouds flex flex-col items-center pt-20 px-4 sm:px-0">

      <div className="w-full max-w-[420px] flex justify-center mb-6 px-2">
        <h1 className="text-xl font-bold text-amber-300 text-center">
          Aggiungi Carta
        </h1>
      </div>

      <input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="OP01-001"
        className="w-full max-w-[420px] px-4 py-3 rounded-xl bg-slate-900 border border-teal-700"
      />

      <div className="w-full max-w-[420px] mt-4 rounded-[1.75rem] border border-amber-400/20 bg-amber-400/5 p-5 text-slate-200 shadow-inner shadow-black/20">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-sm font-semibold text-white">Carta assente?</p>
            <p className="text-sm text-slate-300">Cercala sia per nome carta che per OP-Numero, stiamo risolvendo i problemi di ricerca. In caso non ci fosse propio aiutaci ad ampliare il nostro database: segnalala e la aggiungeremo.</p>
          </div>
          <button
            onClick={() => setShowReportForm((prev) => !prev)}
            className="rounded-2xl bg-amber-400 px-4 py-2 text-sm font-semibold text-slate-950 transition hover:bg-amber-300"
          >
            {showReportForm ? 'Chiudi segnalazione' : 'Segnala carta mancante'}
          </button>
        </div>

        {showReportForm && (
          <div className="mt-4 space-y-3 rounded-3xl border border-amber-300/20 bg-slate-950/90 p-4">
            <div className="grid gap-3 sm:grid-cols-3">
              <input
                value={reportCardName}
                onChange={(e) => setReportCardName(e.target.value)}
                placeholder="Nome carta"
                className="w-full rounded-2xl border border-slate-700 bg-slate-900/90 px-3 py-2 text-sm text-white outline-none"
              />
              <input
                value={reportCardOp}
                onChange={(e) => setReportCardOp(e.target.value)}
                placeholder="OP della carta"
                className="w-full rounded-2xl border border-slate-700 bg-slate-900/90 px-3 py-2 text-sm text-white outline-none"
              />
              <input
                value={reportCardNumber}
                onChange={(e) => setReportCardNumber(e.target.value)}
                placeholder="Numero carta"
                className="w-full rounded-2xl border border-slate-700 bg-slate-900/90 px-3 py-2 text-sm text-white outline-none"
              />
            </div>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <button
                onClick={submitMissingCardReport}
                disabled={reportSubmitting}
                className="rounded-2xl bg-amber-400 px-4 py-2 text-sm font-semibold text-slate-950 transition hover:bg-amber-300 disabled:opacity-60 disabled:cursor-not-allowed"
              >
                {reportSubmitting ? 'Invio...' : 'Invia segnalazione'}
              </button>
              {reportStatus && (
                <p className="text-sm text-slate-300">{reportStatus}</p>
              )}
            </div>
          </div>
        )}
      </div>

      {loading && <p className="text-gray-400 mt-3">Ricerca...</p>}

      <div className="w-full max-w-[420px] mt-4 flex flex-col gap-3 px-2">

        {cards.map((card, index) => (
          <div
            key={`${card.id}-${index}`}
            className="flex items-center gap-3 bg-slate-900 rounded-xl p-3"
          >

            <button onClick={() => setSelectedCard(card)} className="shrink-0">
              <CardImage
                src={card.image_url}
                cardId={card.id}
                alt={card.name}
                className="h-16 w-12 overflow-hidden rounded bg-gray-700"
                imgClassName="h-full w-full object-cover"
                fallbackClassName="flex h-full w-full items-center justify-center text-xs"
              />
            </button>

            <div className="flex-1">
              <p className="font-bold">{card.name}</p>
              <p className="text-xs text-gray-400">
                {card.rarity} • {card.card_color}
              </p>
              <p className="text-[10px] text-gray-500">{displayCardId(card.id)}</p>
            </div>

            <button
              onClick={() => addCard(card)}
              disabled={addingId === card.id}
              className="px-3 py-1 bg-amber-400 text-black rounded-lg"
            >
              {addingId === card.id ? '...' : 'Aggiungi'}
            </button>

          </div>
        ))}

      </div>
      {selectedCard ? (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/72 p-2 backdrop-blur-md sm:items-center sm:p-4" onClick={() => setSelectedCard(null)}>
          <div className="w-full max-w-3xl overflow-hidden rounded-[1.75rem] border border-slate-700 bg-slate-950/97 shadow-2xl" onClick={event => event.stopPropagation()}>
            <div className="flex items-center justify-between border-b border-slate-800 p-3">
              <div className="min-w-0">
                <p className="text-[10px] font-black uppercase tracking-[0.24em] text-cyan-200">Carta</p>
                <h3 className="truncate text-lg font-black text-white">{selectedCard.name}</h3>
              </div>
              <button onClick={() => setSelectedCard(null)} className="grid h-10 w-10 place-items-center rounded-2xl border border-slate-700 bg-slate-800 text-slate-100" aria-label="Chiudi carta">
                X
              </button>
            </div>
            <div className="grid max-h-[82dvh] gap-4 overflow-y-auto p-3 sm:grid-cols-[240px_1fr]">
              <CardImage src={selectedCard.image_url} cardId={selectedCard.id} alt={selectedCard.name} className="aspect-[3/4] overflow-hidden rounded-3xl bg-slate-950" />
              <div className="space-y-3">
                <div>
                  <p className="text-2xl font-black text-white">{selectedCard.name}</p>
                  <p className="mt-1 text-sm font-bold text-cyan-100">{displayCardId(selectedCard.id)}</p>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  {[
                    ['Rarita', selectedCard.rarity || '-'],
                    ['Colore', selectedCard.card_color || '-'],
                    ['Tipo', selectedCard.card_type || '-'],
                    ['Prezzo', formatPrice(selectedCard.market_price ?? selectedCard.inventory_price)],
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
