'use client'

import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useRouter } from 'next/navigation'
import Sidebar from '@/app/components/Sidebar'
import { Search, X } from 'lucide-react'

type Card = {
  id: string
  name: string
  image_url: string | null
  rarity: string | null
  card_color?: string | null
  card_type?: string | null
  card_cost?: number | null
  card_power?: number | null
  market_price?: number | null
  inventory_price?: number | null
  [key: string]: any
}

type FriendOwner = {
  user_id: string
  username: string | null
}

export default function SearchPage() {
  const router = useRouter()
  const [query, setQuery] = useState('')
  const [cards, setCards] = useState<Card[]>([])
  const [selectedCard, setSelectedCard] = useState<Card | null>(null)
  const [friendOwners, setFriendOwners] = useState<FriendOwner[]>([])
  const [loading, setLoading] = useState(false)
  const [userId, setUserId] = useState<string | null>(null)
  const [searching, setSearching] = useState(false)
  const [showReportForm, setShowReportForm] = useState(false)
  const [reportCardName, setReportCardName] = useState('')
  const [reportCardOp, setReportCardOp] = useState('')
  const [reportCardNumber, setReportCardNumber] = useState('')
  const [reportStatus, setReportStatus] = useState('')
  const [reportSubmitting, setReportSubmitting] = useState(false)

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
  }, [router])

  useEffect(() => {
    const search = async () => {
      const q = query.trim()
      if (q.length < 2) {
        setCards([])
        setSearching(false)
        setLoading(false)
        return
      }

      setSearching(true)
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
            card_color: c.card_color ?? null,
            card_type: c.card_type ?? null,
            card_cost: c.card_cost ? Number(c.card_cost) : null,
            card_power: c.card_power ? Number(c.card_power) : null,
            market_price: c.market_price ? Number(c.market_price) : null,
            inventory_price: c.inventory_price ? Number(c.inventory_price) : null,
            ...c,
          }))
          .filter((c: Card) => {
            if (seen.has(c.id)) return false
            seen.add(c.id)
            return true
          })
          .slice(0, 24)

        setCards(clean)
      } catch (error) {
        console.error('Search error', error)
        setCards([])
      }

      setLoading(false)
    }

    const timeout = setTimeout(search, 300)
    return () => clearTimeout(timeout)
  }, [query])

  const loadFriendOwners = async (cardId: string) => {
    if (!userId) return []

    const { data: requests } = await supabase
      .from('friend_requests')
      .select('requester_id,receiver_id')
      .or(`requester_id.eq.${userId},receiver_id.eq.${userId}`)
      .eq('status', 'accepted')

    const friendIds = (requests || [])
      .map((request: any) => (request.requester_id === userId ? request.receiver_id : request.requester_id))
      .filter(Boolean)

    if (friendIds.length === 0) {
      return []
    }

    const { data: owners } = await supabase
      .from('user_cards')
      .select('user_id')
      .in('user_id', friendIds)
      .eq('card_id', cardId)

    const ownerIds = [...new Set((owners || []).map((owner: any) => owner.user_id))]
    if (ownerIds.length === 0) {
      return []
    }

    const { data: profiles } = await supabase
      .from('profiles')
      .select('id, username')
      .in('id', ownerIds)

    return (profiles || []).map((profile: any) => ({
      user_id: profile.id,
      username: profile.username || 'Giocatore'
    }))
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
      setReportStatus('Errore durante l’invio. Riprova tra poco.')
    }

    setReportSubmitting(false)
  }

  const openCard = async (card: Card) => {
    setSelectedCard(card)
    setFriendOwners([])

    if (typeof window !== 'undefined') {
      window.scrollTo({ top: 0, behavior: 'smooth' })
    }

    const owners = await loadFriendOwners(card.id)
    setFriendOwners(owners)
  }

  return (
    <div className="min-h-screen text-white onepiece-wave-bg onepiece-clouds">
      <Sidebar activePage="ricerca" />

      <div className="flex flex-col gap-4 px-4 pt-24 pb-8 sm:px-6 lg:px-8">
        <div className="mx-auto w-full max-w-6xl rounded-[2rem] border border-teal-800/30 bg-slate-900/80 p-6 shadow-2xl shadow-slate-950/40">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <p className="text-xs uppercase tracking-[0.35em] text-amber-300/80">Ricerca Carta</p>
              <h1 className="text-3xl font-extrabold text-white">Cerca carte</h1>
            </div>
            <div className="rounded-3xl border border-slate-800/70 bg-slate-950/70 px-4 py-3 text-sm text-slate-300">
              Cerca nomi o codici di carta da qualsiasi set e tocca un risultato per vedere i dettagli.
            </div>
          </div>

          <div className="mt-6">
            <label className="relative block">
              <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="OP01-001 o nome carta"
                className="w-full rounded-3xl border border-teal-700/80 bg-slate-900/90 py-4 pl-12 pr-4 text-sm text-white shadow-inner shadow-black/20 outline-none focus:border-amber-400"
              />
            </label>
          </div>

          <div className="mt-4 space-y-3">
            <div className="rounded-[1.75rem] border border-amber-400/20 bg-amber-400/5 p-5 text-slate-200 shadow-inner shadow-black/20">
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

            {searching && !loading && query.trim().length >= 2 && (
              <div className="rounded-3xl border border-slate-800/70 bg-slate-900/80 p-4 text-sm text-slate-400">
                Ricerca in corso...
              </div>
            )}

            {loading && (
              <div className="rounded-3xl border border-slate-800/70 bg-slate-900/80 p-4 text-sm text-slate-400">
                Caricamento risultati...
              </div>
            )}

            {!loading && cards.length === 0 && query.trim().length >= 2 && (
              <div className="rounded-3xl border border-slate-800/70 bg-slate-900/80 p-4 text-sm text-slate-400">
                Nessuna carta trovata. Prova con un nome diverso.
              </div>
            )}

            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {cards.map((card) => (
                <button
                  key={card.id}
                  onClick={() => openCard(card)}
                  className="group overflow-hidden rounded-[1.75rem] border border-slate-800/70 bg-slate-950/90 p-4 text-left transition hover:border-amber-400/50 hover:bg-slate-900/95"
                >
                  <div className="flex items-start gap-4">
                    <div className="aspect-[3/4] w-20 overflow-hidden rounded-3xl bg-slate-800">
                      {card.image_url ? (
                        <img src={card.image_url} alt={card.name} className="h-full w-full object-cover" />
                      ) : (
                        <div className="flex h-full items-center justify-center text-xs text-slate-500">Nessuna immagine</div>
                      )}
                    </div>

                    <div className="min-w-0 flex-1">
                      <p className="font-semibold text-white line-clamp-3 break-words whitespace-normal">{card.name}</p>
                      <p className="mt-2 text-xs uppercase tracking-[0.2em] text-slate-500">{card.rarity || '—'}</p>
                      <p className="mt-1 text-[11px] text-slate-400 break-words whitespace-normal">{card.id}</p>
                    </div>
                  </div>
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      {selectedCard ? (
        <div
          className="fixed inset-0 z-50 flex items-start sm:items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
          onClick={(event) => {
            if (event.target === event.currentTarget) {
              setSelectedCard(null)
              setFriendOwners([])
            }
          }}
          onTouchMove={(event) => event.preventDefault()}
        >
          <div
            className="relative w-full max-w-4xl max-h-[calc(100vh-2rem)] overflow-y-auto rounded-[2rem] border border-slate-800/80 bg-slate-950/95 shadow-2xl shadow-black/60"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-slate-800/70 bg-slate-900/80 p-5">
              <div>
                <p className="text-xs uppercase tracking-[0.25em] text-slate-500">Dettagli Carta</p>
                <h2 className="text-2xl font-semibold text-white">{selectedCard.name}</h2>
              </div>
              <button
                onClick={() => {
                  setSelectedCard(null)
                  setFriendOwners([])
                }}
                className="rounded-2xl border border-slate-700/70 px-3 py-2 text-sm text-slate-300 transition hover:bg-slate-900"
              >
                <X size={18} />
              </button>
            </div>

            <div className="grid gap-4 lg:grid-cols-[360px_1fr] p-5">
              <div className="space-y-5">
                <div className="rounded-[1.75rem] border border-slate-800/80 bg-slate-900/90 p-4">
                  <div className="aspect-[3/4] w-full overflow-hidden rounded-[1.75rem] bg-slate-800">
                    {selectedCard.image_url ? (
                      <img src={selectedCard.image_url} alt={selectedCard.name} className="h-full w-full object-cover" />
                    ) : (
                      <div className="flex h-full items-center justify-center text-slate-500">Nessuna immagine</div>
                    )}
                  </div>
                </div>

                <div className="rounded-[1.75rem] border border-slate-800/80 bg-slate-900/90 p-4">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="text-xs uppercase tracking-[0.25em] text-slate-500">Amici</p>
                      <h3 className="mt-2 text-lg font-semibold text-white">Chi ce l'ha</h3>
                    </div>
                    <span className="rounded-full bg-amber-400/10 px-3 py-1 text-[10px] uppercase tracking-[0.2em] text-amber-200">
                      Solo amici
                    </span>
                  </div>

                  {friendOwners.length === 0 ? (
                    <div className="mt-5 rounded-3xl border border-dashed border-slate-700/70 bg-slate-900/80 p-4 text-sm text-slate-400">
                      Nessuno dei tuoi amici ha questa carta in collezione.
                    </div>
                  ) : (
                    <div className="mt-5 space-y-3">
                      {friendOwners.map((owner) => (
                        <div key={owner.user_id} className="rounded-3xl border border-slate-800/70 bg-slate-950/90 p-4 text-sm text-slate-200">
                          <p className="font-semibold text-white">{owner.username}</p>
                          <p className="text-slate-400 text-xs">Amico con questa carta</p>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              <div className="space-y-5">
                <div className="rounded-[1.75rem] border border-slate-800/80 bg-slate-900/90 p-4">
                  <p className="text-sm uppercase tracking-[0.25em] text-slate-500">Informazioni</p>
                  <div className="mt-4 grid gap-3 sm:grid-cols-2">
                    {[
                      ['Rarità', selectedCard.rarity],
                      ['Colore', selectedCard.card_color],
                      ['Tipo', selectedCard.card_type],
                      ['Costo', selectedCard.card_cost?.toString() ?? '—'],
                      ['Power', selectedCard.card_power?.toString() ?? '—'],
                      ['Prezzo', selectedCard.market_price != null ? '€' + selectedCard.market_price : '—'],
                      ['Inventario', selectedCard.inventory_price != null ? '€' + selectedCard.inventory_price : '—'],
                    ].map(([label, value]) => (
                      <div key={label} className="rounded-3xl bg-slate-950/90 p-3 border border-slate-800/70">
                        <p className="text-[10px] uppercase tracking-[0.25em] text-slate-500">{label}</p>
                        <p className="mt-2 text-sm font-semibold text-white">{value}</p>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="rounded-[1.75rem] border border-slate-800/80 bg-slate-900/90 p-4">
                  <p className="text-xs uppercase tracking-[0.25em] text-slate-500">Dettagli API</p>
                  <div className="mt-3 space-y-2 text-sm text-slate-300">
                    {Object.entries(selectedCard).map(([key, value]) => (
                      key === 'image_url' || key === 'name' || key === 'id' ? null : (
                        <div key={key} className="grid grid-cols-[110px_1fr] gap-2">
                          <span className="text-slate-500 capitalize">{key.split('_').join(' ')}</span>
                          <span>{value ?? '—'}</span>
                        </div>
                      )
                    ))}
                  </div>
                </div>
              </div>
            </div>

            <div className="rounded-[1.75rem] border border-slate-800/80 bg-slate-900/90 p-4 text-sm leading-6 text-slate-300">
              Qui puoi consultare tutte le informazioni disponibili sull'API di One Piece e vedere se un tuo amico la possiede.
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}
