'use client'

import { useEffect, useState } from 'react'
import { Plus, LogOut, Trash2, Menu, X } from 'lucide-react'
import { supabase } from '@/lib/supabase'
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
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [openMenuId, setOpenMenuId] = useState<string | null>(null)
  const router = useRouter()

  const [username, setUsername] = useState('')
  const [loading, setLoading] = useState(true)

  const [userId, setUserId] = useState<string | null>(null)
  const [cards, setCards] = useState<UserCard[]>([])
  const [loadingCards, setLoadingCards] = useState(true)

  const activePage = 'collezione'

 useEffect(() => {
  if (addOpen || selectedCard || sidebarOpen) {
    document.body.style.overflow = 'hidden'
    document.documentElement.style.overflowX = 'hidden'
    document.body.style.overflowX = 'hidden'
  } else {
    document.body.style.overflow = 'auto'
    document.documentElement.style.overflowX = 'auto'
    document.body.style.overflowX = 'auto'
  }
}, [addOpen, selectedCard, sidebarOpen])

  useEffect(() => {
    const load = async () => {
      const { data: { session } } = await supabase.auth.getSession()

      if (!session?.user) {
        router.push('/')
        return
      }

      const id = session.user.id
      setUserId(id)

      const { data } = await supabase
        .from('profiles')
        .select('username')
        .eq('id', id)
        .single()

      setUsername(data?.username || 'Utente')
      setLoading(false)
    }

    load()
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

  const logout = async () => {
    await supabase.auth.signOut()
    router.push('/')
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

  const NavItem = ({
  label,
  active,
  onClick
}: {
  label: string
  active?: boolean
  onClick?: () => void
}) => (
  <button
    onClick={onClick}
    className={`
      text-left px-3 py-2 rounded-lg transition
      ${active
        ? 'bg-amber-400/10 text-amber-300 font-semibold'
        : 'text-gray-300 hover:text-amber-300 hover:bg-slate-800/40'}
    `}
  >
    {label}
  </button>
)

  return (
    <div className="min-h-screen bg-[#070A12] text-white flex">

      {/* OVERLAY SIDEBAR */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-30 bg-black/50 backdrop-blur-sm"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* SIDEBAR */}
      <aside className={`fixed left-0 top-0 h-screen w-60 bg-slate-900 border-r border-teal-800/30 flex flex-col z-40 transition-transform duration-300 ${sidebarOpen ? 'translate-x-0' : '-translate-x-full'}`}>

        <div className="p-6 border-b border-teal-800/20 text-center">
          <div className="text-amber-300 font-bold tracking-[0.3em]">
            MENU
          </div>
        </div>

        <nav className="flex flex-col gap-2 p-4 text-sm flex-1">

          <NavItem label="Collezione" active={activePage === 'collezione'} onClick={() => setSidebarOpen(false)} />
          <NavItem label="Amici" onClick={() => setSidebarOpen(false)} />
          <NavItem label="Ricerca Carta" onClick={() => setSidebarOpen(false)} />
          <NavItem label="Statistiche" onClick={() => setSidebarOpen(false)} />
          <NavItem label="Deck Meta" onClick={() => setSidebarOpen(false)} />

        </nav>

        <div className="p-4 border-t border-slate-800">
          <button
            onClick={logout}
            className="w-full text-left text-red-500 hover:text-red-400 font-semibold flex items-center gap-2"
          >
            <LogOut size={16} />
            Disconnettiti
          </button>
        </div>

      </aside>

      {/* MAIN */}
      <div className="flex-1 w-full">

        {/* TOPBAR */}
        <div className="fixed top-0 left-0 right-0 h-14 z-40 bg-slate-900/85 backdrop-blur-md border-b border-teal-800/30 flex items-center px-3 sm:px-4 gap-2 sm:gap-4">

          <button
            onClick={() => setSidebarOpen(!sidebarOpen)}
            className="text-amber-300 hover:text-amber-400 transition flex-shrink-0"
          >
            {sidebarOpen ? <X size={20} className="sm:w-6 sm:h-6" /> : <Menu size={20} className="sm:w-6 sm:h-6" />}
          </button>

          <div className="hidden sm:flex flex-1" />

          <div className="flex-1 flex items-center justify-center gap-2 min-w-0">
            <img
              src="/luffyhatlogo.webp"
              className="w-10 h-10 sm:w-12 sm:h-12 object-contain flex-shrink-0"
            />
            <span className="text-base sm:text-2xl font-extrabold tracking-[0.25em] bg-gradient-to-r from-amber-200 via-yellow-400 to-amber-500 text-transparent bg-clip-text truncate">
              OPV
            </span>
          </div>

          <div className="hidden sm:flex flex-1" />

          <div className="flex justify-end flex-shrink-0">
            <button
  onClick={() => router.push('/profile')}
  className="flex items-center gap-2 bg-slate-800/60 px-2 sm:px-3 py-1 rounded-full border border-slate-700 transition-all duration-200 hover:border-amber-400 hover:bg-slate-700/80 hover:scale-105 active:scale-95"
>
              <div className="w-7 h-7 sm:w-8 sm:h-8 rounded-full bg-gradient-to-br from-amber-300 to-yellow-500 flex-shrink-0" />
              <span className="text-[10px] sm:text-xs font-semibold text-amber-300 truncate max-w-[90px]">
                {loading ? '...' : username}
              </span>
            </button>
          </div>

        </div>

        {/* CONTENT */}
        <div className="pt-20 px-3 sm:px-6">

          {loadingCards && (
            <p className="text-gray-400 text-sm">Caricamento collezione...</p>
          )}

          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-2 sm:gap-3 mt-4">

            {[...cards]
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
                className="relative bg-slate-900 rounded-xl p-2 sm:p-3 border border-slate-700 hover:border-amber-400/40 transition"
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
      <button
        onClick={() => setAddOpen(true)}
        className="fixed bottom-4 sm:bottom-6 left-1/2 -translate-x-1/2 flex flex-col items-center z-50 group"
      >
        <div className="w-14 h-14 sm:w-16 sm:h-16 rounded-full bg-gradient-to-br from-amber-300 via-yellow-400 to-amber-500 flex items-center justify-center shadow-lg transition group-hover:scale-110">
          <Plus className="text-black sm:w-7 sm:h-7" size={24} />
        </div>

        <span className="text-[10px] sm:text-xs mt-1 sm:mt-2 text-amber-300 font-semibold">
          Aggiungi carta
        </span>
      </button>
{selectedCard && (
  <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-md flex items-center justify-center p-4">

    <div className="w-full max-w-sm sm:max-w-2xl bg-slate-900 rounded-xl border border-slate-700 p-3 sm:p-5 relative max-h-[90vh] overflow-y-auto">

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

          <div className="rounded-2xl bg-slate-900/90 border border-slate-700 p-3">
            <p className="text-[10px] uppercase tracking-[0.24em] text-gray-500 mb-2">Prezzi</p>
            <p className="text-sm text-gray-200"><span className="text-amber-300">Market:</span> {selectedCard.market_price != null ? `€${selectedCard.market_price}` : '—'}</p>
            <p className="text-sm text-gray-200"><span className="text-amber-300">Inventario:</span> {selectedCard.inventory_price != null ? `€${selectedCard.inventory_price}` : '—'}</p>
          </div>
        </div>
      </div>

    </div>

  </div>
)}
      {/* MODAL */}
      {addOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-md p-2 sm:p-4 overflow-hidden">

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