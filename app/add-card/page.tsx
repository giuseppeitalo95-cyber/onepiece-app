'use client'

import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useRouter } from 'next/navigation'

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

        const seen = new Set<string>()

        const clean: Card[] = (data || [])
          .map((c: any) => ({
            id: String(c.card_set_id || c.id),
            name: c.card_name || c.name,
            image_url: c.card_image || c.image_url || null,
            rarity: c.rarity || '—',

            // 🔥 STATISTICHE API
            card_color: c.card_color ?? null,
            card_type: c.card_type ?? null,
            card_cost: c.card_cost ? Number(c.card_cost) : null,
            card_power: c.card_power ? Number(c.card_power) : null,
            market_price: c.market_price ? Number(c.market_price) : null,
            inventory_price: c.inventory_price ? Number(c.inventory_price) : null,
          }))
          .filter((c: Card) => {
            if (seen.has(c.id)) return false
            seen.add(c.id)
            return true
          })
          .slice(0, 24)

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
      market_price: card.market_price ?? null,
      inventory_price: card.inventory_price ?? null,
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
            <p className="text-sm text-slate-300">Aiutaci ad ampliare il nostro database: segnalala e la aggiungeremo.</p>
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

            {card.image_url ? (
              <img
                src={card.image_url}
                className="w-12 h-16 object-cover rounded"
              />
            ) : (
              <div className="w-12 h-16 bg-gray-700 rounded flex items-center justify-center text-xs">
                NO IMG
              </div>
            )}

            <div className="flex-1">
              <p className="font-bold">{card.name}</p>
              <p className="text-xs text-gray-400">
                {card.rarity} • {card.card_color}
              </p>
              <p className="text-[10px] text-gray-500">{card.id}</p>
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
    </div>
  )
}