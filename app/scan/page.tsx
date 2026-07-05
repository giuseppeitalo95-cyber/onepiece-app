'use client'

import { useEffect, useState, useRef } from 'react'
import { supabase } from '@/lib/supabase'
import { useRouter } from 'next/navigation'
import Sidebar from '@/app/components/Sidebar'
import { Camera, Plus, Trash2, ChevronLeft, ChevronRight } from 'lucide-react'

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
  const streamRef = useRef<MediaStream | null>(null)

  const [userId, setUserId] = useState<string | null>(null)
  const [cameraActive, setCameraActive] = useState(false)
  const [cameraReady, setCameraReady] = useState(false)
  const [cameraError, setCameraError] = useState<string | null>(null)
  const [searchInput, setSearchInput] = useState('')
  const [scannedCards, setScannedCards] = useState<ScannedCard[]>([])
  const [searching, setSearching] = useState(false)
  const [adding, setAdding] = useState<string | null>(null)
  const [carouselIndex, setCarouselIndex] = useState(0)

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
  }, [router])

  useEffect(() => {
    return () => {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(track => track.stop())
        streamRef.current = null
      }
    }
  }, [])

  useEffect(() => {
    if (scannedCards.length === 0) {
      setCarouselIndex(0)
      return
    }
    setCarouselIndex(prev => Math.min(prev, scannedCards.length - 1))
  }, [scannedCards.length])

  const attachStream = async (stream: MediaStream) => {
    if (!videoRef.current) return

    videoRef.current.srcObject = stream
    videoRef.current.muted = true
    videoRef.current.playsInline = true
    videoRef.current.autoplay = true
    videoRef.current.setAttribute('playsinline', 'true')
    videoRef.current.setAttribute('webkit-playsinline', 'true')

    try {
      await videoRef.current.play()
    } catch {
      videoRef.current.onloadedmetadata = () => {
        videoRef.current?.play().catch(() => undefined)
      }
    }
  }

  const startCamera = async () => {
    if (!navigator.mediaDevices?.getUserMedia) {
      setCameraError('La camera non è disponibile nel tuo browser.')
      return
    }

    if (streamRef.current) {
      await attachStream(streamRef.current)
      setCameraActive(true)
      setCameraReady(true)
      setCameraError(null)
      return
    }

    try {
      const constraintsList = [
        {
          video: {
            facingMode: { ideal: 'environment' },
            width: { ideal: 1280 },
            height: { ideal: 720 }
          },
          audio: false
        },
        {
          video: {
            facingMode: { ideal: 'user' },
            width: { ideal: 1280 },
            height: { ideal: 720 }
          },
          audio: false
        },
        {
          video: {
            width: { ideal: 1280 },
            height: { ideal: 720 }
          },
          audio: false
        }
      ]

      let stream: MediaStream | null = null
      for (const constraints of constraintsList) {
        try {
          stream = await navigator.mediaDevices.getUserMedia(constraints)
          break
        } catch {
          stream = null
        }
      }

      if (!stream) {
        throw new Error('Camera unavailable')
      }

      streamRef.current = stream
      await attachStream(stream)
      setCameraActive(true)
      setCameraReady(true)
      setCameraError(null)
    } catch (err) {
      console.error('Camera error:', err)
      setCameraActive(false)
      setCameraReady(false)
      setCameraError('Non è stato possibile avviare la camera. Prova a ricaricare la pagina e a consentire l’accesso dalla richiesta del browser.')
    }
  }

  const stopCamera = () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop())
      streamRef.current = null
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null
    }
    setCameraActive(false)
    setCameraReady(false)
    setCameraError(null)
  }

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

      setScannedCards(prev => [...prev, newCard])
      setSearchInput('')
      setCarouselIndex(scannedCards.length)
    } catch (err) {
      console.error('Search error:', err)
      alert('Errore ricerca carta')
    }
    setSearching(false)
  }

  const removeCard = (id: string) => {
    setScannedCards(prev => prev.filter(c => c.id !== id))
  }

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

  const totalValue = scannedCards.reduce((sum, card) => {
    const price = card.market_price || card.inventory_price || 0
    return sum + price
  }, 0)

  const currentCard = scannedCards[carouselIndex] ?? null
  const prevCard = scannedCards[carouselIndex - 1] ?? null
  const nextCard = scannedCards[carouselIndex + 1] ?? null

  return (
    <div className="h-dvh overflow-hidden text-white onepiece-wave-bg onepiece-clouds flex">
      <Sidebar activePage="scan" />

      <div className="flex-1 flex flex-col overflow-hidden pt-14">
        <div className="fixed top-0 left-0 right-0 h-14 z-40 flex items-center border-b border-teal-800/30 bg-slate-900/85 px-3 backdrop-blur-md sm:px-4">
          <div className="hidden sm:flex flex-1" />

          <div className="flex-1 flex items-center justify-center min-w-0">
            <div className="relative flex flex-col items-center justify-center px-2">
              <img
                src="/luffyhatlogo.webp"
                className="absolute -top-6 sm:-top-8 w-20 h-20 sm:w-28 sm:h-28 object-contain drop-shadow-lg onepiece-float"
                alt="Logo Cap"
              />
              <span className="pt-8 sm:pt-10 text-base sm:text-2xl font-extrabold tracking-[0.25em] bg-gradient-to-r from-amber-200 via-yellow-400 to-amber-500 text-transparent bg-clip-text whitespace-nowrap">
                OPV
              </span>
            </div>
          </div>

          <div className="hidden sm:flex flex-1" />
        </div>

        <div className="flex-1 overflow-hidden flex flex-col">
          <div className="flex-1 flex items-center justify-center px-3 py-4 sm:px-6">
            <div className="w-full max-w-[480px]">
              <div className="relative overflow-hidden rounded-[28px] border border-amber-400/25 bg-slate-950/80 shadow-[0_24px_60px_rgba(0,0,0,0.4)]">
                <div className="absolute inset-0 bg-gradient-to-b from-amber-400/10 via-transparent to-transparent" />
                <div className="relative aspect-[3/4] overflow-hidden rounded-[28px]">
                  <video
                    ref={videoRef}
                    autoPlay
                    playsInline
                    muted
                    className={`h-full w-full object-cover ${cameraActive && cameraReady ? 'opacity-100' : 'opacity-0'}`}
                  />

                  {!cameraActive && !cameraReady && (
                    <div className="absolute inset-0 flex h-full w-full flex-col items-center justify-center gap-4 bg-gradient-to-b from-slate-900 to-slate-800 p-6 text-center">
                      <div className="rounded-full border border-amber-400/25 bg-amber-400/10 p-5">
                        <Camera className="text-amber-400" size={58} />
                      </div>
                      <div>
                        <p className="text-xl font-semibold text-amber-300">Preview camera</p>
                        <p className="mt-2 text-sm text-slate-400">Avvia lo scan per vedere il live della telecamera.</p>
                      </div>
                    </div>
                  )}

                  {cameraActive && cameraReady && (
                    <>
                      <div className="pointer-events-none absolute inset-0 rounded-[28px] border-2 border-amber-400/50" />
                      <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-amber-400/5 via-transparent to-amber-400/10" />
                    </>
                  )}
                </div>
              </div>

              <div className="mt-4 space-y-3">
                <div className="flex flex-col items-center gap-2">
                  <button
                    onClick={cameraActive ? stopCamera : startCamera}
                    className={`flex h-16 w-16 items-center justify-center rounded-full border text-white shadow-lg transition ${cameraActive ? 'border-red-500/40 bg-red-500/20 hover:bg-red-500/30' : 'border-amber-400/40 bg-gradient-to-br from-amber-400 to-amber-500 text-slate-900 hover:shadow-amber-400/30'}`}
                  >
                    <Camera size={24} />
                  </button>
                  <p className="text-sm font-semibold text-slate-300">{cameraActive ? 'Ferma camera' : 'Avvia scan'}</p>
                </div>

                {cameraError && (
                  <div className="rounded-2xl border border-amber-400/20 bg-amber-400/10 px-3 py-2 text-sm text-amber-200">
                    {cameraError}
                  </div>
                )}

                {scannedCards.length > 0 && (
                  <div className="flex items-center justify-between rounded-2xl border border-slate-700 bg-slate-800/60 px-3 py-3">
                    <div>
                      <p className="text-[10px] uppercase tracking-[0.3em] text-slate-400">Carte</p>
                      <p className="text-lg font-bold text-amber-300">{scannedCards.length}</p>
                    </div>
                    <div className="text-right">
                      <p className="text-[10px] uppercase tracking-[0.3em] text-slate-400">Valore</p>
                      <p className="text-lg font-bold text-emerald-400">{totalValue.toFixed(2)}€</p>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>

          {scannedCards.length > 0 && (
            <div className="border-t border-slate-700 bg-slate-900/50 px-3 py-4 sm:px-6">
              <div className="mx-auto max-w-6xl">
                <div className="mb-4 flex items-center justify-between">
                  <div>
                    <p className="text-[10px] uppercase tracking-[0.35em] text-slate-400">Riepilogo</p>
                    <h3 className="text-sm font-bold text-amber-300">Carte appena raccolte</h3>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => setCarouselIndex(prev => Math.max(prev - 1, 0))}
                      className="rounded-full border border-slate-700 bg-slate-800/80 p-2 text-slate-200 transition hover:border-amber-400/40 hover:text-amber-300"
                    >
                      <ChevronLeft size={16} />
                    </button>
                    <button
                      onClick={() => setCarouselIndex(prev => Math.min(prev + 1, scannedCards.length - 1))}
                      className="rounded-full border border-slate-700 bg-slate-800/80 p-2 text-slate-200 transition hover:border-amber-400/40 hover:text-amber-300"
                    >
                      <ChevronRight size={16} />
                    </button>
                  </div>
                </div>

                <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                  <div className="flex flex-1 items-center justify-center gap-3 sm:gap-4">
                    {prevCard && (
                      <div className="hidden w-[120px] rounded-2xl border border-slate-700/70 bg-slate-800/50 p-2 opacity-50 sm:block">
                        <img src={prevCard.image_url || ''} alt={prevCard.name || 'Carta'} className="aspect-[3/4] w-full rounded-xl object-cover" />
                      </div>
                    )}

                    {currentCard && (
                      <div className="w-full max-w-[240px] rounded-[24px] border border-amber-400/20 bg-slate-800/70 p-3 shadow-[0_20px_45px_rgba(0,0,0,0.25)]">
                        <img
                          src={currentCard.image_url || ''}
                          alt={currentCard.name || 'Carta'}
                          className="aspect-[3/4] w-full rounded-[18px] object-cover"
                        />
                        <div className="mt-3 space-y-1 text-center">
                          <p className="text-sm font-bold text-white">{currentCard.name}</p>
                          <p className="text-[11px] uppercase tracking-[0.3em] text-slate-400">{currentCard.card_id}</p>
                          <div className="mt-2 rounded-2xl border border-amber-400/20 bg-amber-400/10 px-3 py-2">
                            <p className="text-xs uppercase tracking-[0.3em] text-slate-400">Valore</p>
                            <p className="text-base font-bold text-amber-300">{((currentCard.market_price || currentCard.inventory_price || 0)).toFixed(2)}€</p>
                          </div>
                          <div className="mt-2 flex items-center justify-center gap-2 text-[11px] text-slate-400">
                            <span className="rounded-full border border-slate-700 px-2 py-1">{currentCard.rarity || '—'}</span>
                            <span className="rounded-full border border-slate-700 px-2 py-1">{currentCard.card_type || '—'}</span>
                          </div>
                        </div>
                        <div className="mt-3 flex gap-2">
                          <button
                            onClick={() => addToCollection(currentCard)}
                            disabled={adding === currentCard.id}
                            className="flex-1 rounded-2xl border border-emerald-500/40 bg-emerald-500/15 px-3 py-2 text-xs font-semibold text-emerald-300 transition hover:bg-emerald-500/25"
                          >
                            {adding === currentCard.id ? '...' : 'Aggiungi'}
                          </button>
                          <button
                            onClick={() => removeCard(currentCard.id)}
                            className="flex-1 rounded-2xl border border-red-500/40 bg-red-500/15 px-3 py-2 text-xs font-semibold text-red-300 transition hover:bg-red-500/25"
                          >
                            <span className="flex items-center justify-center gap-1"><Trash2 size={12} /> Elimina</span>
                          </button>
                        </div>
                      </div>
                    )}

                    {nextCard && (
                      <div className="hidden w-[120px] rounded-2xl border border-slate-700/70 bg-slate-800/50 p-2 opacity-50 sm:block">
                        <img src={nextCard.image_url || ''} alt={nextCard.name || 'Carta'} className="aspect-[3/4] w-full rounded-xl object-cover" />
                      </div>
                    )}
                  </div>

                  <div className="w-full lg:max-w-[240px]">
                    <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 lg:grid-cols-2">
                      {scannedCards.map((card, index) => (
                        <button
                          key={card.id}
                          onClick={() => setCarouselIndex(index)}
                          className={`rounded-2xl border p-1.5 transition ${index === carouselIndex ? 'border-amber-400/50 bg-amber-400/10' : 'border-slate-700 bg-slate-800/60'}`}
                        >
                          <img src={card.image_url || ''} alt={card.name || 'Carta'} className="aspect-[3/4] w-full rounded-xl object-cover" />
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
