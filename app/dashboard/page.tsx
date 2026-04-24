'use client'

import { useEffect, useState } from 'react'
import { Plus, Trash2 } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import Sidebar from '@/app/components/Sidebar'
import { useRouter } from 'next/navigation'

type UserCard = {
  card_id: string
  quantity: number
  name: string | null
  image_url: string | null
  rarity: string | null

  // 🔥 AGGIUNTE
  card_color?: string | null
  card_type?: string | null
  card_cost?: number | null
  card_power?: number | null
  market_price?: number | null
  inventory_price?: number | null
}

export default function Dashboard() {
  const [addOpen, setAddOpen] = useState(false)
  const [selectedCard, setSelectedCard] = useState<UserCard | null>(null)
  const [openMenuId, setOpenMenuId] = useState<string | null>(null)
  const router = useRouter()
  const [avatarUrl, setAvatarUrl] = useState('')
  const [username, setUsername] = useState('')
  const [loading, setLoading] = useState(true)

  const [userId, setUserId] = useState<string | null>(null)
  const [cards, setCards] = useState<UserCard[]>([])
  const [loadingCards, setLoadingCards] = useState(true)
  const [searchTerm, setSearchTerm] = useState('')
  const [filterColor, setFilterColor] = useState('all')
  const [filterRarity, setFilterRarity] = useState('all')
  const [filterCost, setFilterCost] = useState('all')
  const [isAdmin, setIsAdmin] = useState(false)
  const [adminNotificationsCount, setAdminNotificationsCount] = useState(0)

 const loadAdminNotifications = async () => {
    const { count, error } = await supabase
      .from('missing_card_reports')
      .select('id', { count: 'exact' })
      .eq('status', 'new')

    if (!error && typeof count === 'number') {
      setAdminNotificationsCount(count)
    }
  }

 useEffect(() => {
  if (addOpen || selectedCard) {
    document.body.style.overflow = 'hidden'
    document.documentElement.style.overflow = 'hidden'
  } else {
    document.body.style.overflow = 'auto'
    document.documentElement.style.overflow = 'auto'
  }
}, [addOpen, selectedCard])

  useEffect(() => {
    const load = async () => {
      const { data: { session } } = await supabase.auth.getSession()

      if (!session?.user) {
        router.push('/')
        return
      }

      const id = session.user.id
      setUserId(id)

      const isAdminUser = id === 'fcade84e-6413-4009-91df-a8c839a170cc'
      setIsAdmin(isAdminUser)
      if (isAdminUser) {
        loadAdminNotifications()
      }

      const { data } = await supabase
        .from('profiles')
        .select('username, avatar_url')
        .eq('id', id)
        .single()

      setUsername(data?.username || 'Utente')
      setAvatarUrl(data?.avatar_url || '')
      setLoading(false)
    }

    load()
  }, [])

  // Ricarica i dati del profilo quando la pagina diventa visibile
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (!document.hidden) {
        // Ricarica i dati del profilo quando la pagina diventa visibile
        const reloadProfile = async () => {
          const { data: { session } } = await supabase.auth.getSession()
          if (session?.user) {
            const { data } = await supabase
              .from('profiles')
              .select('username, avatar_url')
              .eq('id', session.user.id)
              .single()

            setUsername(data?.username || 'Utente')
            setAvatarUrl(data?.avatar_url || '')
          }
        }
        reloadProfile()
      }
    }

    document.addEventListener('visibilitychange', handleVisibilityChange)
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange)
  }, [])

  const loadCards = async (uid: string) => {
    setLoadingCards(true)

    const { data, error } = await supabase
      .from('user_cards')
      .select(
        'card_id, quantity, name, image_url, rarity, card_color, card_type, card_cost, card_power, market_price, inventory_price'
      )
      .eq('user_id', uid)

    if (error) {
      console.error('LOAD ERROR:', error)
      setCards([])
      setLoadingCards(false)
      return
    }

    setCards(data || [])
    setLoadingCards(false)
  }

  useEffect(() => {
    if (!userId) return
    loadCards(userId)
  }, [userId])

  const refreshAfterAdd = async () => {
    setAddOpen(false)
    if (userId) await loadCards(userId)
  }

  // 🔥 DELETE FIX DEFINITIVO
  const removeCard = async (cardId: string, qty: number) => {
    if (!userId) return

    console.log('DELETE CLICK:', cardId, qty)

    if (qty > 1) {
      const { error } = await supabase
        .from('user_cards')
        .update({ quantity: qty - 1 })
        .eq('user_id', userId)
        .eq('card_id', cardId)

      if (error) {
        console.error('UPDATE ERROR:', error)
        return
      }
    } else {
      const { error } = await supabase
        .from('user_cards')
        .delete()
        .eq('user_id', userId)
        .eq('card_id', cardId)

      if (error) {
        console.error('DELETE ERROR:', error)
        return
      }
    }

    await loadCards(userId)
  }

  const searchTermNormalized = searchTerm.trim().toLowerCase()
  const availableColors = Array.from(new Set(cards.map(card => card.card_color || 'Unknown'))).filter(Boolean)
  const availableRarities = Array.from(new Set(cards.map(card => card.rarity || 'Unknown'))).filter(Boolean)

  const filteredCards = cards.filter((item) => {
    const matchesSearch =
      !searchTermNormalized ||
      item.name?.toLowerCase().includes(searchTermNormalized) ||
      item.card_id.toLowerCase().includes(searchTermNormalized)

    const matchesColor =
      filterColor === 'all' ||
      (item.card_color || 'Unknown').toLowerCase() === filterColor.toLowerCase()

    const matchesRarity =
      filterRarity === 'all' ||
      (item.rarity || 'Unknown').toLowerCase() === filterRarity.toLowerCase()

    const cost = item.card_cost ?? -1
    let matchesCost = true
    if (filterCost === '0-2') matchesCost = cost >= 0 && cost <= 2
    if (filterCost === '3-5') matchesCost = cost >= 3 && cost <= 5
    if (filterCost === '6+') matchesCost = cost >= 6

    return matchesSearch && matchesColor && matchesRarity && matchesCost
  })

  return (
    <div className="min-h-screen text-white onepiece-wave-bg onepiece-clouds">
      <Sidebar activePage="collezione" />
      <div className="flex-1 w-full">

        {/* TOPBAR */}
        <div className="fixed top-0 left-0 right-0 h-14 z-40 bg-slate-900/85 backdrop-blur-md border-b border-teal-800/30 flex items-center px-3 sm:px-4 gap-2 sm:gap-4">

          <div className="hidden sm:flex flex-1" />

          <div className="flex-1 flex items-center justify-center min-w-0">
            <div className="relative flex flex-col items-center justify-center px-2">
              <img
                src="/luffyhatlogo.webp"
                className="absolute -top-2 w-10 h-10 sm:w-12 sm:h-12 object-contain onepiece-float"
                alt="Logo Cap"
              />
              <span className="pt-4 sm:pt-5 text-base sm:text-2xl font-extrabold tracking-[0.25em] bg-gradient-to-r from-amber-200 via-yellow-400 to-amber-500 text-transparent bg-clip-text whitespace-nowrap">
                OPV
              </span>
            </div>
          </div>

          <div className="hidden sm:flex flex-1" />

          <div className="flex items-center justify-end flex-shrink-0 gap-2">
            {isAdmin && (
              <button
                onClick={() => router.push('/admin')}
                className="inline-flex items-center gap-2 rounded-full border border-amber-400/30 bg-amber-400/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-amber-200 transition hover:bg-amber-400/15"
              >
                ADMIN
                {adminNotificationsCount > 0 && (
                  <span className="rounded-full bg-amber-300 px-2 py-0.5 text-[10px] font-bold text-slate-950">
                    {adminNotificationsCount}
                  </span>
                )}
              </button>
            )}
            <button
              onClick={() => router.push('/profile')}
              className="flex items-center gap-2 bg-slate-800/60 px-2 sm:px-3 py-1 rounded-full border border-slate-700 transition-all duration-200 hover:border-amber-400 hover:bg-slate-700/80 hover:scale-105 active:scale-95"
            >
              <div className="w-7 h-7 sm:w-8 sm:h-8 rounded-full bg-gradient-to-br from-amber-300 to-yellow-500 flex-shrink-0 overflow-hidden border border-amber-400/30">
                {avatarUrl ? (
                  <img
                    src={avatarUrl}
                    alt="Avatar"
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <div className="w-full h-full flex items-center justify-center text-slate-900 font-bold text-sm">
                    {(username || 'U').charAt(0).toUpperCase()}
                  </div>
                )}
              </div>
              <span className="text-[10px] sm:text-xs font-semibold text-amber-300 truncate max-w-[90px]">
                {loading ? '...' : username}
              </span>
            </button>
          </div>

        </div>

        {/* CONTENT */}
        <div className="pt-20 px-3 sm:px-6">

          <div className="space-y-3">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="text-sm font-semibold text-white">Cerca nella collezione</p>
                <p className="text-xs text-gray-400">Usa testo, colore, rarità o costo per trovare le carte che possiedi.</p>
              </div>

              <div className="grid gap-2 sm:grid-cols-4 min-w-0">
                <input
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  placeholder="Cerca nome o codice"
                  className="min-w-0 w-full rounded-2xl border border-slate-700 bg-slate-900/90 px-3 py-2 text-sm text-white placeholder:text-slate-500 focus:border-amber-400 focus:outline-none focus:ring-2 focus:ring-amber-400/20"
                />

                <select
                  value={filterColor}
                  onChange={(e) => setFilterColor(e.target.value)}
                  className="w-full rounded-2xl border border-slate-700 bg-slate-900/90 px-3 py-2 text-sm text-white focus:border-amber-400 focus:outline-none focus:ring-2 focus:ring-amber-400/20"
                >
                  <option value="all">Tutti i colori</option>
                  {availableColors.map((color) => (
                    <option key={color} value={color.toLowerCase()}>{color}</option>
                  ))}
                </select>

                <select
                  value={filterRarity}
                  onChange={(e) => setFilterRarity(e.target.value)}
                  className="w-full rounded-2xl border border-slate-700 bg-slate-900/90 px-3 py-2 text-sm text-white focus:border-amber-400 focus:outline-none focus:ring-2 focus:ring-amber-400/20"
                >
                  <option value="all">Tutte le rarità</option>
                  {availableRarities.map((rarity) => (
                    <option key={rarity} value={rarity.toLowerCase()}>{rarity}</option>
                  ))}
                </select>

                <select
                  value={filterCost}
                  onChange={(e) => setFilterCost(e.target.value)}
                  className="w-full rounded-2xl border border-slate-700 bg-slate-900/90 px-3 py-2 text-sm text-white focus:border-amber-400 focus:outline-none focus:ring-2 focus:ring-amber-400/20"
                >
                  <option value="all">Tutti i costi</option>
                  <option value="0-2">Costo 0–2</option>
                  <option value="3-5">Costo 3–5</option>
                  <option value="6+">Costo 6+</option>
                </select>
              </div>
            </div>

            {!loadingCards && filteredCards.length === 0 && (
              <div className="rounded-3xl border border-slate-700 bg-slate-900/80 p-4 text-sm text-gray-300">
                Nessuna carta trovata con i filtri selezionati.
              </div>
            )}
          </div>

          {loadingCards && (
            <p className="text-gray-400 text-sm">Caricamento collezione...</p>
          )}

          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-2 sm:gap-3 mt-4">

            {[...filteredCards]
  .sort((a, b) => {
    const parse = (id: string) => {
      const match = id.match(/OP(\d+)-(\d+)/i)
      if (!match) return { set: 0, num: 0 }

      return {
        set: parseInt(match[1], 10),
        num: parseInt(match[2], 10),
      }
    }

    const A = parse(a.card_id)
    const B = parse(b.card_id)

    // OP15 sopra OP14 ecc
    if (A.set !== B.set) return B.set - A.set

    // dentro set: 001 → 002 → 025
    return A.num - B.num
  })
  .map((item) => (
              <div
                key={item.card_id}
                className="relative bg-slate-900 rounded-xl p-2 sm:p-3 border border-slate-700 hover:border-amber-400/60 transition onepiece-card-hover onepiece-border-glow"
              >

                {/* DELETE BUTTON */}
                {/* MENU DELETE (3 PUNTINI) */}
<div className="absolute bottom-1 sm:bottom-2 right-1 sm:right-2">
  
  <button 
    onClick={() => setOpenMenuId(openMenuId === item.card_id ? null : item.card_id)}
    className="text-gray-400 hover:text-red-400 text-base sm:text-lg leading-none px-1"
  >
    ⋯
  </button>

  {openMenuId === item.card_id && (
    <>
      <div 
        className="fixed inset-0 z-20"
        onClick={() => setOpenMenuId(null)}
      />
      <div className="absolute bottom-6 right-0 bg-slate-800 border border-slate-700 rounded-md shadow-lg overflow-hidden z-30">
    
        <button
          onClick={() => {
            removeCard(item.card_id, item.quantity)
            setOpenMenuId(null)
          }}
          className="flex items-center gap-2 px-2 sm:px-3 py-1 sm:py-2 text-red-400 hover:bg-slate-700 text-xs w-full whitespace-nowrap"
        >
          <Trash2 size={12} className="sm:w-3.5 sm:h-3.5" />
          Elimina
        </button>
        <button
          onClick={() => {
            setSelectedCard(item)
            setOpenMenuId(null)
          }}
          className="flex items-center gap-2 px-2 sm:px-3 py-1 sm:py-2 text-white hover:bg-slate-700 text-xs w-full whitespace-nowrap"
        >
          Info
        </button>
      </div>
    </>
  )}
</div>

                <div className="w-full aspect-[3/4] overflow-hidden rounded-md bg-black">
                  {item.image_url ? (
                    <img src={item.image_url} className="w-full h-full object-contain" />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center text-[10px] text-gray-400">
                      NO IMAGE
                    </div>
                  )}
                </div>

                <p className="font-bold mt-1 sm:mt-2 text-[10px] sm:text-xs line-clamp-2">{item.name || 'Unknown'}</p>
                <p className="text-[8px] sm:text-[10px] text-gray-400">{item.rarity || '?'}</p>
                <p className="text-[7px] sm:text-[9px] text-gray-500 truncate">{item.card_id}</p>
                <p className="text-[10px] sm:text-xs text-amber-300 mt-1">x{item.quantity}</p>

              </div>
            ))}

          </div>

        </div>

      </div>

      {/* ADD BUTTON */}
      <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-[60]">
        <button
          onClick={() => setAddOpen(true)}
          className="pointer-events-auto flex flex-col items-center group"
        >
          <div className="w-14 h-14 sm:w-16 sm:h-16 rounded-full bg-gradient-to-br from-amber-300 via-yellow-400 to-amber-500 flex items-center justify-center shadow-lg transition group-hover:scale-110 onepiece-glow onepiece-decoration">
            <Plus className="text-black sm:w-7 sm:h-7" size={24} />
          </div>

          <span className="text-[10px] sm:text-xs mt-1 sm:mt-2 text-amber-300 font-semibold">
            Aggiungi carta
          </span>
        </button>
      </div>
{selectedCard && (
  <div
    className="fixed inset-0 z-50 bg-black/70 backdrop-blur-md flex items-center justify-center p-4"
    onClick={(event) => {
      if (event.target === event.currentTarget) {
        setSelectedCard(null)
      }
    }}
    onTouchMove={(event) => event.preventDefault()}
  >

    <div
      className="w-full max-w-sm sm:max-w-2xl bg-slate-900 rounded-xl border border-slate-700 p-3 sm:p-5 relative max-h-[90vh] overflow-y-auto"
      onClick={(event) => event.stopPropagation()}
    >

      <button
        onClick={() => setSelectedCard(null)}
        className="absolute top-2 right-2 sm:top-3 sm:right-3 text-white hover:text-gray-300"
      >
        ✕
      </button>

      <div className="grid gap-4 lg:grid-cols-[1fr_1.2fr]">
        <div className="rounded-3xl overflow-hidden bg-slate-800 border border-slate-700 p-3">
          <img
            src={selectedCard.image_url || ''}
            className="w-full aspect-[3/4] object-contain"
          />
        </div>

        <div className="space-y-4">
          <div>
            <h2 className="text-lg sm:text-xl font-bold text-amber-300 mb-2">
              {selectedCard.name || 'Carta sconosciuta'}
            </h2>
            <p className="text-xs uppercase tracking-[0.25em] text-gray-400 mb-3">
              {selectedCard.card_id}
            </p>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-2xl bg-slate-900/90 border border-slate-700 p-3">
              <p className="text-[10px] uppercase tracking-[0.24em] text-gray-500 mb-2">Generale</p>
              <p className="text-sm text-gray-200"><span className="text-amber-300">Rarità:</span> {selectedCard.rarity || '—'}</p>
              <p className="text-sm text-gray-200"><span className="text-amber-300">Colore:</span> {selectedCard.card_color || '—'}</p>
              <p className="text-sm text-gray-200"><span className="text-amber-300">Tipo:</span> {selectedCard.card_type || '—'}</p>
            </div>

            <div className="rounded-2xl bg-slate-900/90 border border-slate-700 p-3">
              <p className="text-[10px] uppercase tracking-[0.24em] text-gray-500 mb-2">Statistiche</p>
              <p className="text-sm text-gray-200"><span className="text-amber-300">Costo:</span> {selectedCard.card_cost ?? '—'}</p>
              <p className="text-sm text-gray-200"><span className="text-amber-300">Power:</span> {selectedCard.card_power ?? '—'}</p>
              <p className="text-sm text-gray-200"><span className="text-amber-300">Quantità:</span> {selectedCard.quantity}</p>
            </div>
          </div>

        </div>
      </div>

    </div>

  </div>
)}
      {/* MODAL */}
      {addOpen && (
        <div
          className="fixed inset-0 z-[5000] flex items-center justify-center bg-black/70 backdrop-blur-md p-2 sm:p-4 overflow-hidden"
          onClick={(event) => {
            if (event.target === event.currentTarget) {
              refreshAfterAdd()
            }
          }}
          onTouchMove={(event) => event.preventDefault()}
        >

          <div className="relative w-[calc(100vw-1.5rem)] sm:w-[min(95vw,1024px)] h-[70vh] sm:h-[90vh] max-w-[1024px] bg-slate-900 rounded-xl overflow-hidden border border-slate-700">

            <button
              onClick={refreshAfterAdd}
              className="absolute top-3 right-3 sm:top-4 sm:right-4 z-50 bg-black/80 hover:bg-black/95 p-2 rounded-full transition flex-shrink-0 text-white"
            >
              ✕
            </button>

            <iframe
              title="add-card-form"
              src="/add-card"
              className="w-full h-full"
              style={{
                display: 'block',
                border: 'none',
                overflow: 'hidden'
              }}
            />
          </div>
        </div>
      )}

    </div>
  )
}