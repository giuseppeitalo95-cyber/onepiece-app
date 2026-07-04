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
  const [showSummary, setShowSummary] = useState(false)
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

  const totalMarket = scannedCards.reduce((sum, card) => sum + (card.market_price || 0), 0)
  const totalInventory = scannedCards.reduce((sum, card) => sum + (card.inventory_price || 0), 0)

  return (
    <div className="h-dvh overflow-hidden text-white onepiece-wave-bg onepiece-clouds flex">
      <Sidebar activePage="scan" />

      {/* MAIN CONTENT */}
      <div className="flex-1 flex flex-col overflow-hidden">
        
        {/* TOP BAR */}
        <div className="fixed top-0 left-0 right-0 h-14 z-40 bg-slate-900/85 backdrop-blur-md border-b border-teal-800/30 flex items-center px-3 sm:px-4 gap-2">
          <div className="flex-1 flex items-center justify-center">
            <div className="relative flex flex-col items-center justify-center">
              <img
                src="/luffyhatlogo.webp"
                className="absolute -top-6 sm:-top-8 w-20 h-20 sm:w-28 sm:h-28 object-contain drop-shadow-lg"
                alt="Logo"
              />
              <span className="pt-8 sm:pt-10 text-base sm:text-xl font-bold tracking-[0.15em] text-amber-300">
                SCANNER
              </span>
            </div>
          </div>
        </div>

        {/* CONTENT AREA */}
        <div className="flex-1 overflow-y-auto pt-20 px-3 sm:px-6 pb-6">
          <div className="max-w-6xl mx-auto">
            
            {!showSummary ? (
              <div className="space-y-6">
                
                {/* CAMERA SECTION */}
                <div className="rounded-2xl border border-teal-700/50 bg-slate-900/80 overflow-hidden">
                  {cameraActive ? (
                    <div className="relative aspect-video bg-black flex items-center justify-center overflow-hidden">
                      <video
                        ref={videoRef}
                        autoPlay
                        playsInline
                        className="w-full h-full object-cover"
                      />
                      <div className="absolute inset-0 pointer-events-none border-4 border-amber-400/30" />
                    </div>
                  ) : (
                    <div className="aspect-video bg-gradient-to-b from-slate-800 to-slate-900 flex flex-col items-center justify-center gap-4 p-6 text-center">
                      <Camera className="text-amber-400" size={48} />
                      <div>
                        <p className="text-lg font-semibold text-amber-300">Fotocamera</p>
                        <p className="text-sm text-gray-400 mt-2">Premi "Avvia Scan" per attivare la fotocamera e iniziare a inquadrare le carte</p>
                      </div>
                    </div>
                  )}
                </div>

                {/* CONTROLS */}
                <div className="flex gap-3 flex-wrap">
                  {!cameraActive ? (
                    <button
                      onClick={startCamera}
                      className="flex-1 min-w-[200px] flex items-center justify-center gap-2 bg-gradient-to-r from-amber-400 to-amber-500 text-slate-900 py-3 px-4 rounded-2xl font-bold hover:shadow-lg hover:shadow-amber-400/50 transition"
                    >
                      <Camera size={20} />
                      Avvia Scan
                    </button>
                  ) : (
                    <button
                      onClick={stopCamera}
                      className="flex-1 min-w-[200px] bg-red-500/20 hover:bg-red-500/30 text-red-300 border border-red-500/50 py-3 px-4 rounded-2xl font-bold transition"
                    >
                      Ferma Telecamera
                    </button>
                  )}
                </div>

                {/* SEARCH INPUT */}
                <div className="rounded-2xl border border-slate-700 bg-slate-900/80 p-5">
                  <div className="space-y-3">
                    <div>
                      <label className="block text-xs font-semibold text-gray-300 mb-2">
                        Codice Carta (es. OP01-001)
                      </label>
                      <div className="flex gap-2">
                        <input
                          type="text"
                          value={searchInput}
                          onChange={(e) => setSearchInput(e.target.value)}
                          onKeyPress={(e) => {
                            if (e.key === 'Enter') searchCard(searchInput)
                          }}
                          placeholder="OP01-001"
                          className="flex-1 px-4 py-2.5 rounded-xl bg-slate-800/80 border border-slate-700 text-white placeholder:text-gray-500 focus:border-amber-400 focus:outline-none focus:ring-2 focus:ring-amber-400/20"
                        />
                        <button
                          onClick={() => searchCard(searchInput)}
                          disabled={searching || !searchInput.trim()}
                          className="px-6 py-2.5 bg-amber-400 text-slate-900 rounded-xl font-bold hover:bg-amber-300 transition disabled:opacity-60"
                        >
                          <Search size={20} />
                        </button>
                      </div>
                    </div>
                    <p className="text-xs text-gray-400">Digita il codice della carta e premi Invio o clicca Cerca. Il sistema troverà automaticamente la carta e il suo valore attuale.</p>
                  </div>
                </div>

                {/* SCANNED CARDS */}
                {scannedCards.length > 0 && (
                  <div className="rounded-2xl border border-slate-700 bg-slate-900/80 p-5">
                    <div className="flex items-center justify-between mb-4">
                      <h3 className="text-lg font-bold text-amber-300">
                        Carte Scannerizzate ({scannedCards.length})
                      </h3>
                      <button
                        onClick={() => setShowSummary(true)}
                        className="flex items-center gap-2 bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-300 border border-emerald-500/50 px-4 py-2 rounded-xl font-semibold transition"
                      >
                        <ShoppingCart size={18} />
                        Riepilogo
                      </button>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 max-h-[400px] overflow-y-auto">
                      {scannedCards.map((card) => {
                        const price = card.market_price || card.inventory_price || 0
                        return (
                          <div
                            key={card.id}
                            className="bg-slate-800/60 border border-slate-700 rounded-xl p-3 flex flex-col"
                          >
                            {card.image_url && (
                              <div className="w-full aspect-[3/4] bg-black rounded-lg mb-2 overflow-hidden">
                                <img
                                  src={card.image_url}
                                  alt={card.name || 'Card'}
                                  className="w-full h-full object-contain"
                                />
                              </div>
                            )}
                            <p className="font-bold text-sm line-clamp-1">{card.name}</p>
                            <p className="text-xs text-gray-400">{card.card_id}</p>
                            <div className="my-2 p-2 bg-amber-400/10 rounded-lg border border-amber-400/30">
                              <p className="text-xs text-amber-300">Valore: <span className="font-bold">{price.toFixed(2)}€</span></p>
                            </div>
                            <div className="flex gap-2 mt-auto">
                              <button
                                onClick={() => addToCollection(card)}
                                disabled={adding === card.id}
                                className="flex-1 bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-300 border border-emerald-500/50 py-1.5 rounded-lg font-semibold text-xs transition"
                              >
                                {adding === card.id ? '...' : <Plus size={14} className="mx-auto" />}
                              </button>
                              <button
                                onClick={() => removeCard(card.id)}
                                className="flex-1 bg-red-500/20 hover:bg-red-500/30 text-red-300 border border-red-500/50 py-1.5 rounded-lg font-semibold text-xs transition"
                              >
                                <Trash2 size={14} className="mx-auto" />
                              </button>
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  </div>
                )}

              </div>
            ) : (

              /* SUMMARY VIEW */
              <div className="rounded-2xl border border-slate-700 bg-slate-900/80 p-6">
                <div className="flex items-center justify-between mb-6">
                  <h2 className="text-2xl font-bold text-amber-300">Riepilogo Scannerizzazione</h2>
                  <button
                    onClick={() => setShowSummary(false)}
                    className="text-gray-400 hover:text-white"
                  >
                    <X size={24} />
                  </button>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
                  <div className="bg-slate-800/60 border border-slate-700 rounded-xl p-4 text-center">
                    <p className="text-xs text-gray-400 mb-1">Numero Carte</p>
                    <p className="text-3xl font-bold text-amber-300">{scannedCards.length}</p>
                  </div>
                  <div className="bg-slate-800/60 border border-slate-700 rounded-xl p-4 text-center">
                    <p className="text-xs text-gray-400 mb-1">Valore Mercato</p>
                    <p className="text-3xl font-bold text-green-400">{totalMarket.toFixed(2)}€</p>
                  </div>
                  <div className="bg-slate-800/60 border border-slate-700 rounded-xl p-4 text-center">
                    <p className="text-xs text-gray-400 mb-1">Valore Inventario</p>
                    <p className="text-3xl font-bold text-blue-400">{totalInventory.toFixed(2)}€</p>
                  </div>
                </div>

                <div className="space-y-3 max-h-[500px] overflow-y-auto mb-6">
                  {scannedCards.map((card) => {
                    const price = card.market_price || card.inventory_price || 0
                    return (
                      <div
                        key={card.id}
                        className="flex items-center justify-between bg-slate-800/40 border border-slate-700 rounded-xl p-4"
                      >
                        <div className="flex items-center gap-4 flex-1 min-w-0">
                          {card.image_url && (
                            <img
                              src={card.image_url}
                              alt={card.name || 'Card'}
                              className="w-12 h-16 object-contain rounded"
                            />
                          )}
                          <div className="min-w-0 flex-1">
                            <p className="font-bold truncate">{card.name}</p>
                            <p className="text-xs text-gray-400">{card.card_id}</p>
                          </div>
                        </div>
                        <div className="text-right font-bold text-amber-300 text-lg">
                          {price.toFixed(2)}€
                        </div>
                      </div>
                    )
                  })}
                </div>

                <div className="flex gap-3">
                  <button
                    onClick={() => setShowSummary(false)}
                    className="flex-1 bg-slate-700 hover:bg-slate-600 text-white py-3 px-4 rounded-2xl font-bold transition"
                  >
                    Continua Scan
                  </button>
                  <button
                    onClick={() => setScannedCards([])}
                    className="flex-1 bg-red-500/20 hover:bg-red-500/30 text-red-300 border border-red-500/50 py-3 px-4 rounded-2xl font-bold transition"
                  >
                    Cancella Tutto
                  </button>
                </div>
              </div>
            )}

          </div>
        </div>

      </div>

      <canvas ref={canvasRef} className="hidden" />
    </div>
  )
}
