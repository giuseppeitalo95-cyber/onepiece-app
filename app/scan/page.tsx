'use client'

import { useEffect, useState, useRef } from 'react'
import { supabase } from '@/lib/supabase'
import { useRouter } from 'next/navigation'
import Sidebar from '@/app/components/Sidebar'
import { Camera, Search, X, Plus, Trash2, ShoppingCart } from 'lucide-react'

type ScannedCard = {
  id: string
  card_id: string
  name: string | null
  image_url: string | null
  rarity: string | null
  card_color?: string | null
  card_type?: string | null
  card_cost?: number | null
  card_power?: number | null
  market_price?: number | null
  inventory_price?: number | null
}

export default function ScanPage() {
  const router = useRouter()
  const videoRef = useRef<HTMLVideoElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)

  const [userId, setUserId] = useState<string | null>(null)
  const [cameraActive, setCameraActive] = useState(false)
  const [searchInput, setSearchInput] = useState('')
  const [scannedCards, setScannedCards] = useState<ScannedCard[]>([])
  const [searching, setSearching] = useState(false)
  const [adding, setAdding] = useState<string | null>(null)

  // AUTH CHECK
  useEffect(() => {
    const checkUser = async () => {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session?.user) {
        router.push('/')
        return
      }
      setUserId(session.user.id)
    }
    checkUser()
  }, [])

  // CLEANUP CAMERA
  useEffect(() => {
    return () => {
      if (videoRef.current?.srcObject) {
        const tracks = (videoRef.current.srcObject as MediaStream).getTracks()
        tracks.forEach(track => track.stop())
      }
    }
  }, [])

  // CAMERA START
  const startCamera = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: 'environment',
          width: { ideal: 1280 },
          height: { ideal: 720 }
        }
      })
      if (videoRef.current) {
        videoRef.current.srcObject = stream
        setCameraActive(true)
      }
    } catch (err) {
      console.error('Camera error:', err)
      alert('Accesso alla fotocamera rifiutato')
    }
  }

  // CAMERA STOP
  const stopCamera = () => {
    if (videoRef.current?.srcObject) {
      const tracks = (videoRef.current.srcObject as MediaStream).getTracks()
      tracks.forEach(track => track.stop())
      setCameraActive(false)
    }
  }

  // SEARCH CARD
  const searchCard = async (query: string) => {
    if (!query.trim()) return

    setSearching(true)
    try {
      const res = await fetch(`/api/cards/search?q=${encodeURIComponent(query)}`)
      const results = await res.json()

      if (results.length === 0) {
        alert('Carta non trovata')
        setSearching(false)
        return
      }

      // Prendi il primo risultato
      const card = results[0]
      
      const newCard: ScannedCard = {
        id: `${Date.now()}-${Math.random()}`,
        card_id: String(card.card_set_id ?? card.card_id ?? card.id),
        name: card.card_name || card.name,
        image_url: card.card_image || card.image_url || null,
        rarity: card.rarity || '—',
        card_color: card.card_color ?? null,
        card_type: card.card_type ?? null,
        card_cost: card.card_cost ? Number(card.card_cost) : null,
        card_power: card.card_power ? Number(card.card_power) : null,
        market_price: card.market_price ? Number(card.market_price) : null,
        inventory_price: card.inventory_price ? Number(card.inventory_price) : null,
      }

      setScannedCards([...scannedCards, newCard])
      setSearchInput('')
    } catch (err) {
      console.error('Search error:', err)
      alert('Errore ricerca carta')
    }
    setSearching(false)
  }

  // REMOVE FROM SCAN
  const removeCard = (id: string) => {
    setScannedCards(scannedCards.filter(c => c.id !== id))
  }

  // ADD TO COLLECTION
  const addToCollection = async (card: ScannedCard) => {
    if (!userId || adding) return

    setAdding(card.id)

    try {
      const { data: existing } = await supabase
        .from('user_cards')
        .select('id, quantity')
        .eq('user_id', userId)
        .eq('card_id', card.card_id)
        .maybeSingle()

      const payload = {
        user_id: userId,
        card_id: card.card_id,
        name: card.name,
        image_url: card.image_url,
        rarity: card.rarity,
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

      removeCard(card.id)
    } catch (err) {
      console.error('Add error:', err)
      alert('Errore aggiunta carta')
    }

    setAdding(null)
  }

  // CALCULATE TOTALS
  const totalValue = scannedCards.reduce((sum, card) => {
    const price = card.market_price || card.inventory_price || 0
    return sum + price
  }, 0)

  return (
    <div className="h-dvh overflow-hidden text-white onepiece-wave-bg onepiece-clouds flex">
      <Sidebar activePage="scan" />

      {/* MAIN CONTENT */}
      <div className="flex-1 flex flex-col overflow-hidden">
        
        {/* TOP BAR */}
        <div className="h-14 z-40 bg-slate-900/85 backdrop-blur-md border-b border-teal-800/30 flex items-center px-3 sm:px-4 gap-2">
          <div className="flex-1 flex items-center justify-center">
            <div className="relative flex flex-col items-center justify-center">
              <img
                src="/luffyhatlogo.webp"
                className="absolute -top-6 w-12 h-12 object-contain drop-shadow-lg"
                alt="Logo"
              />
              <span className="pt-3 text-base font-bold tracking-[0.15em] text-amber-300">
                SCANNER
              </span>
            </div>
          </div>
        </div>

        {/* CONTENT */}
        <div className="flex-1 overflow-hidden flex flex-col">
          
          {/* CAMERA AREA - Centered with card shape */}
          <div className="flex-1 flex items-center justify-center px-3 sm:px-6 py-4">
            <div className="relative w-full max-w-sm">
              {/* CARD FRAME */}
              <div className="relative bg-slate-950 rounded-2xl shadow-2xl overflow-hidden border-4 border-amber-400/30" style={{aspectRatio: '3/4'}}>
                {cameraActive ? (
                  <>
                    <video
                      ref={videoRef}
                      autoPlay
                      playsInline
                      className="w-full h-full object-cover"
                    />
                    {/* OVERLAY FRAME */}
                    <div className="absolute inset-0 border-2 border-amber-400/50 rounded-xl pointer-events-none" />
                    <div className="absolute inset-0 bg-gradient-to-b from-amber-400/5 via-transparent to-amber-400/5 pointer-events-none" />
                  </>
                ) : (
                  <div className="w-full h-full bg-gradient-to-b from-slate-900 to-slate-800 flex flex-col items-center justify-center gap-4 p-6 text-center">
                    <Camera className="text-amber-400" size={64} />
                    <div>
                      <p className="text-lg font-semibold text-amber-300">Scanner Disattivo</p>
                      <p className="text-sm text-gray-400 mt-2">Premi il tasto per avviare la fotocamera</p>
                    </div>
                  </div>
                )}
              </div>

              {/* HUD - Below card */}
              <div className="mt-4 space-y-3">
                {/* BUTTONS */}
                <div className="flex gap-2">
                  {!cameraActive ? (
                    <button
                      onClick={startCamera}
                      className="flex-1 flex items-center justify-center gap-2 bg-gradient-to-r from-amber-400 to-amber-500 text-slate-900 py-2.5 px-4 rounded-xl font-bold hover:shadow-lg hover:shadow-amber-400/50 transition text-sm"
                    >
                      <Camera size={18} />
                      Avvia Scan
                    </button>
                  ) : (
                    <button
                      onClick={stopCamera}
                      className="flex-1 bg-red-500/20 hover:bg-red-500/30 text-red-300 border border-red-500/50 py-2.5 px-4 rounded-xl font-bold transition text-sm"
                    >
                      Ferma
                    </button>
                  )}
                </div>

                {/* SEARCH INPUT */}
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={searchInput}
                    onChange={(e) => setSearchInput(e.target.value)}
                    onKeyPress={(e) => {
                      if (e.key === 'Enter') searchCard(searchInput)
                    }}
                    placeholder="OP01-001"
                    className="flex-1 px-3 py-2.5 rounded-xl bg-slate-800/80 border border-slate-700 text-white placeholder:text-gray-500 focus:border-amber-400 focus:outline-none focus:ring-2 focus:ring-amber-400/20 text-sm"
                  />
                  <button
                    onClick={() => searchCard(searchInput)}
                    disabled={searching || !searchInput.trim()}
                    className="px-4 py-2.5 bg-amber-400 text-slate-900 rounded-xl font-bold hover:bg-amber-300 transition disabled:opacity-60 text-sm"
                  >
                    <Search size={18} />
                  </button>
                </div>

                {/* STATS */}
                {scannedCards.length > 0 && (
                  <div className="bg-slate-800/60 border border-slate-700 rounded-xl p-3 flex justify-between items-center">
                    <div>
                      <p className="text-xs text-gray-400">Carte Scannerizzate</p>
                      <p className="text-lg font-bold text-amber-300">{scannedCards.length}</p>
                    </div>
                    <div className="text-right">
                      <p className="text-xs text-gray-400">Valore Totale</p>
                      <p className="text-lg font-bold text-green-400">{totalValue.toFixed(2)}€</p>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* CARDS LIST - Below */}
          {scannedCards.length > 0 && (
            <div className="flex-1 overflow-y-auto border-t border-slate-700 bg-slate-900/40 px-3 sm:px-6 py-4">
              <div className="max-w-6xl mx-auto">
                <h3 className="text-sm font-bold text-amber-300 mb-3">
                  Carte Scannerizzate ({scannedCards.length})
                </h3>
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-2">
                  {scannedCards.map((card) => {
                    const price = card.market_price || card.inventory_price || 0
                    return (
                      <div
                        key={card.id}
                        className="bg-slate-800/60 border border-slate-700 rounded-lg p-2 flex flex-col"
                      >
                        {card.image_url && (
                          <div className="w-full aspect-[3/4] bg-black rounded mb-1 overflow-hidden">
                            <img
                              src={card.image_url}
                              alt={card.name || 'Card'}
                              className="w-full h-full object-contain"
                            />
                          </div>
                        )}
                        <p className="font-bold text-xs line-clamp-1">{card.name}</p>
                        <p className="text-[10px] text-gray-400 truncate">{card.card_id}</p>
                        <div className="my-1 p-1 bg-amber-400/10 rounded border border-amber-400/30">
                          <p className="text-[10px] text-amber-300 font-bold">{price.toFixed(2)}€</p>
                        </div>
                        <div className="flex gap-1 mt-auto">
                          <button
                            onClick={() => addToCollection(card)}
                            disabled={adding === card.id}
                            className="flex-1 bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-300 border border-emerald-500/50 py-1 rounded text-xs font-semibold transition"
                          >
                            {adding === card.id ? '...' : <Plus size={12} className="mx-auto" />}
                          </button>
                          <button
                            onClick={() => removeCard(card.id)}
                            className="flex-1 bg-red-500/20 hover:bg-red-500/30 text-red-300 border border-red-500/50 py-1 rounded text-xs font-semibold transition"
                          >
                            <Trash2 size={12} className="mx-auto" />
                          </button>
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            </div>
          )}

        </div>

      </div>

      <canvas ref={canvasRef} className="hidden" />
    </div>
  )
}
