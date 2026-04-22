'use client'

import { useEffect, useState } from 'react'
import { Plus, LogOut, Trash2 } from 'lucide-react'
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
  const router = useRouter()

  const [username, setUsername] = useState('')
  const [loading, setLoading] = useState(true)

  const [userId, setUserId] = useState<string | null>(null)
  const [cards, setCards] = useState<UserCard[]>([])
  const [loadingCards, setLoadingCards] = useState(true)

  const activePage = 'collezione'

 useEffect(() => {
  document.body.style.overflow = (addOpen || selectedCard) ? 'hidden' : 'auto'
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
      .select('card_id, quantity, name, image_url, rarity')
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
  }: {
    label: string
    active?: boolean
  }) => (
    <button
      className={`
        text-left px-3 py-2 rounded-lg transition
        ${active
          ? 'bg-amber-400/10 text-amber-300 font-semibold'
          : 'text-gray-300 hover:text-amber-300 hover:bg-slate-800/40'
        }
      `}
    >
      {label}
    </button>
  )

  return (
    <div className="min-h-screen bg-[#070A12] text-white flex">

      {/* SIDEBAR */}
      <aside className="w-60 fixed left-0 top-0 h-screen bg-slate-900 border-r border-teal-800/30 flex flex-col">

        <div className="p-6 border-b border-teal-800/20 text-center">
          <div className="text-amber-300 font-bold tracking-[0.3em]">
            MENU
          </div>
        </div>

        <nav className="flex flex-col gap-2 p-4 text-sm flex-1">

          <NavItem label="Collezione" active={activePage === 'collezione'} />
          <NavItem label="Amici" />
          <NavItem label="Ricerca Carta" />
          <NavItem label="Statistiche" />
          <NavItem label="Deck Meta" />

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
      <div className="ml-60 flex-1">

        {/* TOPBAR */}
        <div className="fixed top-0 left-60 right-0 h-14 z-40 bg-slate-900/85 backdrop-blur-md border-b border-teal-800/30 flex items-center">

          <div className="w-1/3" />

          <div className="w-1/3 flex items-center justify-center gap-2">

            <span className="text-xl font-extrabold tracking-[0.25em] bg-gradient-to-r from-amber-200 via-yellow-400 to-amber-500 text-transparent bg-clip-text">
              ONE PIECE
            </span>

            <img
              src="/luffyhatlogo.webp"
              className="w-16 h-16 object-contain -mt-4"
            />

            <span className="text-xl font-extrabold tracking-[0.25em] bg-gradient-to-r from-amber-200 via-yellow-400 to-amber-500 text-transparent bg-clip-text">
              VAULT
            </span>

          </div>

          <div className="w-1/3 flex justify-end pr-4">
            <button
  onClick={() => router.push('/profile')}
  className="flex items-center gap-2 bg-slate-800/60 px-3 py-1 rounded-full border border-slate-700 transition-all duration-200 hover:border-amber-400 hover:bg-slate-700/80 hover:scale-105 active:scale-95"
>
              <div className="w-7 h-7 rounded-full bg-gradient-to-br from-amber-300 to-yellow-500" />
              <span className="text-xs font-semibold text-amber-300">
                {loading ? '...' : username}
              </span>
            </button>
          </div>

        </div>

        {/* CONTENT */}
        <div className="pt-20 px-6">

          {loadingCards && (
            <p className="text-gray-400">Caricamento collezione...</p>
          )}

          <div className="grid grid-cols-2 md:grid-cols-5 lg:grid-cols-6 gap-3 mt-4">

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
                className="relative bg-slate-900 rounded-xl p-3 border border-slate-700 hover:border-amber-400/40 transition"
              >

                {/* DELETE BUTTON */}
                {/* MENU DELETE (3 PUNTINI) */}
<div className="absolute bottom-2 right-2 group">
  
  <button className="text-gray-400 hover:text-red-400 text-lg leading-none px-1">
    ⋯
  </button>

  <div className="hidden group-hover:block absolute bottom-6 right-0 bg-slate-800 border border-slate-700 rounded-md shadow-lg overflow-hidden">
    
    <button
      onClick={() => removeCard(item.card_id, item.quantity)}
      className="flex items-center gap-2 px-3 py-2 text-red-400 hover:bg-slate-700 text-xs w-full"
    >
      <Trash2 size={14} />
      Elimina
    </button>
<button
  onClick={() => setSelectedCard(item)}
  className="flex items-center gap-2 px-3 py-2 text-white hover:bg-slate-700 text-xs w-full"
>
  Info
</button>
  </div>
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

                <p className="font-bold mt-2 text-xs">{item.name || 'Unknown'}</p>
                <p className="text-[10px] text-gray-400">{item.rarity || '?'}</p>
                <p className="text-[9px] text-gray-500">{item.card_id}</p>
                <p className="text-xs text-amber-300 mt-1">x{item.quantity}</p>

              </div>
            ))}

          </div>

        </div>

      </div>

      {/* ADD BUTTON */}
      <button
        onClick={() => setAddOpen(true)}
        className="fixed bottom-6 left-1/2 -translate-x-1/2 flex flex-col items-center z-50 group"
      >
        <div className="w-16 h-16 rounded-full bg-gradient-to-br from-amber-300 via-yellow-400 to-amber-500 flex items-center justify-center shadow-lg transition group-hover:scale-110">
          <Plus className="text-black" size={28} />
        </div>

        <span className="text-xs mt-2 text-amber-300 font-semibold">
          Aggiungi carta
        </span>
      </button>
{selectedCard && (
  <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-md flex items-center justify-center">

    <div className="w-[90%] max-w-2xl bg-slate-900 rounded-xl border border-slate-700 p-5 relative">

      <button
        onClick={() => setSelectedCard(null)}
        className="absolute top-3 right-3 text-white"
      >
        ✕
      </button>

      <h2 className="text-xl font-bold text-amber-300 mb-4">
        {selectedCard.name}
      </h2>

      <img
        src={selectedCard.image_url || ''}
        className="w-full max-h-[400px] object-contain mb-4"
      />

      <div className="text-sm text-gray-300 space-y-1">
        <p>Nome: {selectedCard.name}</p>
        <p>Rarità: {selectedCard.rarity}</p>
        <p>Colore: {selectedCard.card_color}</p>
        <p>Costo: {selectedCard.card_cost}</p>
        <p>Power: {selectedCard.card_power}</p>
        <p>Prezzo: {selectedCard.market_price}</p>
        <p>PrezzoInv: {selectedCard.inventory_price}</p>
        <p>Quantità: {selectedCard.quantity}</p>
      </div>

    </div>

  </div>
)}
      {/* MODAL */}
      {addOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-md">

          <div className="relative w-[95%] max-w-2xl h-[85vh] bg-slate-900 rounded-xl overflow-hidden border border-slate-700">

            <button
              onClick={refreshAfterAdd}
              className="absolute top-3 right-3 z-50 bg-black/50 p-2 rounded-full"
            >
              ✕
            </button>

            <iframe
              src="/add-card"
              className="w-full h-full"
            />
            
          </div>

        </div>
      )}

    </div>
  )
}