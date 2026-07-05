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
  const [referenceCards, setReferenceCards] = useState<Array<{ id: string; name: string; image_url: string | null }>>([])
  const [detectedRect, setDetectedRect] = useState<{ x: number; y: number; width: number; height: number } | null>(null)
  const [recognitionMessage, setRecognitionMessage] = useState('Attendi il riconoscimento...')
  const [pendingRecognition, setPendingRecognition] = useState<ScannedCard | null>(null)
  const [opencvReady, setOpencvReady] = useState(false)
  const [ocrReady, setOcrReady] = useState(false)
  const [scanSessionActive, setScanSessionActive] = useState(false)
  const [showSummary, setShowSummary] = useState(false)
  const processingCanvasRef = useRef<HTMLCanvasElement>(null)
  const detectionLoopRef = useRef<number | null>(null)

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
    if (typeof window === 'undefined') return

    const existingScript = document.getElementById('opencv-script') as HTMLScriptElement | null
    if (existingScript) {
      if ((window as Window & { cv?: { Mat?: unknown } }).cv?.Mat) {
        setOpencvReady(true)
      } else {
        existingScript.addEventListener('load', () => setOpencvReady(true), { once: true })
      }
      return
    }

    const script = document.createElement('script')
    script.id = 'opencv-script'
    script.src = 'https://docs.opencv.org/4.x/opencv.js'
    script.async = true
    script.onload = () => {
      const cv = (window as Window & { cv?: { onRuntimeInitialized?: () => void } }).cv
      if (cv?.onRuntimeInitialized) {
        cv.onRuntimeInitialized = () => setOpencvReady(true)
      } else {
        setOpencvReady(true)
      }
    }
    document.body.appendChild(script)

    return () => {
      script.onload = null
    }
  }, [])

  useEffect(() => {
    if (typeof window === 'undefined') return

    const existingOcrScript = document.getElementById('tesseract-script') as HTMLScriptElement | null
    if (existingOcrScript) {
      if ((window as Window & { Tesseract?: unknown }).Tesseract) {
        setOcrReady(true)
      } else {
        existingOcrScript.addEventListener('load', () => setOcrReady(true), { once: true })
      }
      return
    }

    const script = document.createElement('script')
    script.id = 'tesseract-script'
    script.src = 'https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js'
    script.async = true
    script.onload = () => setOcrReady(true)
    document.body.appendChild(script)

    return () => {
      script.onload = null
    }
  }, [])

  useEffect(() => {
    const loadReferenceCards = async () => {
      try {
        const res = await fetch('/api/cards/recognition-candidates')
        const data = await res.json()
        setReferenceCards(Array.isArray(data) ? data : [])
      } catch (err) {
        console.error('Reference cards error:', err)
      }
    }

    loadReferenceCards()

    return () => {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(track => track.stop())
        streamRef.current = null
      }
      if (detectionLoopRef.current) {
        window.clearInterval(detectionLoopRef.current)
        detectionLoopRef.current = null
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

  useEffect(() => {
    if (!cameraActive || !cameraReady || referenceCards.length === 0 || !scanSessionActive) return

    detectionLoopRef.current = window.setInterval(() => {
      void detectCardFromFrame()
    }, 1800)

    return () => {
      if (detectionLoopRef.current) {
        window.clearInterval(detectionLoopRef.current)
        detectionLoopRef.current = null
      }
    }
  }, [cameraActive, cameraReady, referenceCards.length, ocrReady, scanSessionActive])

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

  const normalizeText = (value: string) => value.toLowerCase().replace(/[^a-z0-9]/g, ' ')

  const extractCardQuery = (text: string) => {
    const cleaned = text.replace(/\s+/g, ' ').trim()
    if (!cleaned) return null

    const codeMatch = cleaned.match(/\b(?:op|st|sp|don|ex|cp|p)\d{1,2}-\d{1,3}\b/i)
    if (codeMatch) return codeMatch[0].toUpperCase()

    const words = cleaned
      .split(' ')
      .map(word => word.trim())
      .filter(Boolean)
      .filter(word => word.length > 2 && !['the', 'and', 'for', 'with', 'card', 'cards'].includes(word.toLowerCase()))

    return words.slice(0, 4).join(' ')
  }

  const preprocessForOcr = (sourceCanvas: HTMLCanvasElement, targetCanvas: HTMLCanvasElement) => {
    const source = sourceCanvas.getContext('2d')
    const target = targetCanvas.getContext('2d')
    if (!source || !target) return

    target.clearRect(0, 0, targetCanvas.width, targetCanvas.height)
    target.drawImage(sourceCanvas, 0, 0, targetCanvas.width, targetCanvas.height)

    const imageData = target.getImageData(0, 0, targetCanvas.width, targetCanvas.height)
    const data = imageData.data
    for (let i = 0; i < data.length; i += 4) {
      const r = data[i]
      const g = data[i + 1]
      const b = data[i + 2]
      const gray = (r * 0.299 + g * 0.587 + b * 0.114)
      const adjusted = gray > 140 ? 255 : 0
      data[i] = adjusted
      data[i + 1] = adjusted
      data[i + 2] = adjusted
    }
    target.putImageData(imageData, 0, 0)
  }

  const runOcrOnCanvas = async (canvas: HTMLCanvasElement) => {
    try {
      const dataUrl = canvas.toDataURL('image/png')
      const res = await fetch('/api/cards/ocr', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image: dataUrl })
      })
      const data = await res.json()
      return typeof data?.text === 'string' ? data.text : null
    } catch {
      return null
    }
  }

  const compareImageToCandidate = async (sourceCanvas: HTMLCanvasElement, candidateUrl: string) => {
    try {
      const image = new Image()
      image.src = `/api/cards/recognition-image?url=${encodeURIComponent(candidateUrl)}`
      await new Promise<void>((resolve, reject) => {
        image.onload = () => resolve()
        image.onerror = () => reject(new Error('load failed'))
      })

      const candidateCanvas = document.createElement('canvas')
      candidateCanvas.width = 256
      candidateCanvas.height = 256
      const ctx = candidateCanvas.getContext('2d')
      if (!ctx) return Number.POSITIVE_INFINITY
      ctx.drawImage(image, 0, 0, candidateCanvas.width, candidateCanvas.height)

      const sourceData = sourceCanvas.getContext('2d')?.getImageData(0, 0, sourceCanvas.width, sourceCanvas.height)
      const candidateData = ctx.getImageData(0, 0, candidateCanvas.width, candidateCanvas.height)
      if (!sourceData || !candidateData) return Number.POSITIVE_INFINITY

      let diff = 0
      const total = Math.min(sourceData.data.length, candidateData.data.length)
      for (let i = 0; i < total; i += 4) {
        diff += Math.abs(sourceData.data[i] - candidateData.data[i])
        diff += Math.abs(sourceData.data[i + 1] - candidateData.data[i + 1])
        diff += Math.abs(sourceData.data[i + 2] - candidateData.data[i + 2])
      }

      return diff / total
    } catch {
      return Number.POSITIVE_INFINITY
    }
  }

  const searchCardByText = async (query: string, cropCanvas: HTMLCanvasElement) => {
    if (!query) return null

    try {
      const res = await fetch(`/api/cards/search?q=${encodeURIComponent(query)}`)
      const results = await res.json()

      if (!Array.isArray(results) || results.length === 0) return null

      const normalizedQuery = normalizeText(query)
      const queryTokens = normalizedQuery.split(' ').filter(Boolean)
      let bestMatch: { card: ScannedCard; score: number } | null = null

      for (const candidate of results) {
        const name = String(candidate.card_name || candidate.name || '')
        const id = String(candidate.card_set_id || candidate.card_id || candidate.id || '')
        const normalizedName = normalizeText(name)
        const normalizedId = normalizeText(id)

        let score = 0
        const exactCode = normalizedQuery.includes(normalizedId) || normalizedId.includes(normalizedQuery)
        if (exactCode) score += 1.4
        if (normalizedId && normalizedQuery.includes(normalizedId)) score += 0.8
        if (normalizedId && normalizedId.includes(normalizedQuery)) score += 0.8
        if (normalizedName && normalizedQuery.includes(normalizedName)) score += 0.9
        if (normalizedName && normalizedName.includes(normalizedQuery)) score += 0.9

        const nameTokens = normalizedName.split(' ').filter(Boolean)
        const overlap = queryTokens.filter(token => nameTokens.includes(token)).length
        score += overlap * 0.2

        const hasStrongName = normalizedName && (normalizedName.includes(normalizedQuery) || overlap >= 2)
        if (hasStrongName) score += 0.3

        const isLikelyCardId = /(?:op|st|sp|don|ex|cp|p)\d{1,2}-\d{1,3}/i.test(query)
        if (isLikelyCardId && normalizedId && normalizedId.includes(normalizedQuery)) score += 0.5

        if (candidate.card_image || candidate.image_url) {
          const imageScore = await compareImageToCandidate(cropCanvas, candidate.card_image || candidate.image_url)
          if (imageScore < 65000000) score += 0.5
        }

        if (!bestMatch || score > bestMatch.score) {
          bestMatch = {
            card: {
              id: `${candidate.card_set_id || candidate.card_id || candidate.id || Date.now()}-${Date.now()}`,
              card_id: String(candidate.card_set_id || candidate.card_id || candidate.id || ''),
              name,
              image_url: candidate.card_image || candidate.image_url || null,
              rarity: candidate.rarity || '—',
              market_price: candidate.market_price ? Number(candidate.market_price) : null,
              inventory_price: candidate.inventory_price ? Number(candidate.inventory_price) : null,
            },
            score
          }
        }
      }

      return bestMatch && bestMatch.score > 1.3 ? bestMatch.card : null
    } catch {
      return null
    }
  }

  const confirmRecognizedCard = (card: ScannedCard) => {
    setScannedCards(prev => {
      const alreadyExists = prev.some(item => item.card_id === card.card_id || item.name === card.name)
      if (alreadyExists) return prev
      return [card, ...prev]
    })
    setCarouselIndex(0)
    setShowSummary(true)
    setPendingRecognition(null)
    setRecognitionMessage(`Carta confermata: ${card.name}`)
  }

  const estimateCardRect = (sourceRect: { x: number; y: number; width: number; height: number }, canvasWidth: number, canvasHeight: number) => {
    const targetAspect = 0.72
    const centerX = sourceRect.x + sourceRect.width / 2
    const centerY = sourceRect.y + sourceRect.height / 2
    const baseWidth = Math.max(sourceRect.width, 120)
    const baseHeight = Math.max(sourceRect.height, 120)
    const expandedWidth = Math.min(canvasWidth * 0.82, Math.max(baseWidth * 1.35, baseHeight * targetAspect * 1.15))
    const expandedHeight = Math.min(canvasHeight * 0.9, Math.max(baseHeight * 1.3, expandedWidth / targetAspect))

    return {
      x: Math.max(0, Math.min(canvasWidth - expandedWidth, centerX - expandedWidth / 2)),
      y: Math.max(0, Math.min(canvasHeight - expandedHeight, centerY - expandedHeight / 2)),
      width: Math.max(80, Math.min(canvasWidth, expandedWidth)),
      height: Math.max(80, Math.min(canvasHeight, expandedHeight))
    }
  }

  const detectCardFromFrame = async () => {
    if (!videoRef.current || !processingCanvasRef.current || referenceCards.length === 0) return

    const video = videoRef.current
    const canvas = processingCanvasRef.current
    const ctx = canvas.getContext('2d')

    if (!ctx || video.videoWidth === 0 || video.videoHeight === 0) return

    canvas.width = video.videoWidth
    canvas.height = video.videoHeight
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height)

    const cv = (window as Window & { cv?: any }).cv
    let rect = null as { x: number; y: number; width: number; height: number } | null

    if (cv?.Mat) {
      const src = cv.imread(canvas)
      const gray = new cv.Mat()
      cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY)
      const blurred = new cv.Mat()
      cv.GaussianBlur(gray, blurred, new cv.Size(5, 5), 0)
      const edges = new cv.Mat()
      cv.Canny(blurred, edges, 60, 140)
      const contours = new cv.MatVector()
      const hierarchy = new cv.Mat()
      cv.findContours(edges, contours, hierarchy, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE)

      let bestArea = 0
      for (let i = 0; i < contours.size(); i += 1) {
        const contour = contours.get(i)
        const peri = cv.arcLength(contour, true)
        const approx = new cv.Mat()
        cv.approxPolyDP(contour, approx, 0.02 * peri, true)

        if (approx.rows === 4) {
          const area = Math.abs(cv.contourArea(contour))
          const r = cv.boundingRect(contour)
          const ratio = r.width / Math.max(r.height, 1)
          const centered = Math.abs((r.x + r.width / 2) - canvas.width / 2) / canvas.width < 0.35

          if (area > bestArea && area > 12000 && ratio > 0.45 && ratio < 1.7 && centered) {
            rect = estimateCardRect({ x: r.x, y: r.y, width: r.width, height: r.height }, canvas.width, canvas.height)
            bestArea = area
          }
        }

        contour.delete()
        approx.delete()
      }

      hierarchy.delete()
      contours.delete()
      edges.delete()
      blurred.delete()
      gray.delete()
      src.delete()
    }

    if (!rect) {
      const centerWidth = Math.floor(canvas.width * 0.65)
      const centerHeight = Math.floor(canvas.height * 0.7)
      const x = Math.floor((canvas.width - centerWidth) / 2)
      const y = Math.floor((canvas.height - centerHeight) / 2)
      rect = { x, y, width: centerWidth, height: centerHeight }
    }

    setDetectedRect(rect)
    setRecognitionMessage('Analisi del frame in corso...')

    const cropCanvas = document.createElement('canvas')
    cropCanvas.width = 720
    cropCanvas.height = 720
    const cropCtx = cropCanvas.getContext('2d')

    if (!cropCtx) return

    const textRegionX = rect.x + rect.width * 0.08
    const textRegionY = rect.y + rect.height * 0.58
    const textRegionWidth = rect.width * 0.84
    const textRegionHeight = rect.height * 0.3

    cropCtx.drawImage(
      canvas,
      textRegionX,
      textRegionY,
      textRegionWidth,
      textRegionHeight,
      0,
      0,
      cropCanvas.width,
      cropCanvas.height
    )

    const preprocessedCanvas = document.createElement('canvas')
    preprocessedCanvas.width = 720
    preprocessedCanvas.height = 720
    preprocessForOcr(cropCanvas, preprocessedCanvas)

    const cropAreaRatio = rect.width * rect.height / (canvas.width * canvas.height)
    const hasCardShape = cropAreaRatio > 0.12 && rect.width / Math.max(rect.height, 1) > 0.5 && rect.width / Math.max(rect.height, 1) < 1.7

    if (!hasCardShape) {
      setRecognitionMessage('Tieni la carta al centro e aspetta il riconoscimento.')
      return
    }

    if (!ocrReady) {
      setRecognitionMessage('Inizializzo il riconoscimento del testo...')
      return
    }

    const ocrText = await runOcrOnCanvas(preprocessedCanvas)
    if (!ocrText) {
      setRecognitionMessage('Testo non leggibile. Avvicina la carta e riprova.')
      return
    }

    const query = extractCardQuery(ocrText)
    if (!query) {
      setRecognitionMessage('Testo non abbastanza chiaro. Tieni la carta più ferma.')
      return
    }

    const cardMatch = await searchCardByText(query, preprocessedCanvas)
    if (cardMatch) {
      setPendingRecognition(cardMatch)
      setRecognitionMessage(`Carta trovata: ${cardMatch.name}. Conferma o scarta.`)
    } else {
      setRecognitionMessage('Nessuna carta abbastanza sicura. Allinea meglio il nome o il codice.')
    }
  }

  const handleScanCard = async () => {
    if (!cameraActive || !cameraReady) return
    setRecognitionMessage('Scansione in corso...')
    await detectCardFromFrame()
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
      setScanSessionActive(true)
      setShowSummary(false)
      setPendingRecognition(null)
      setRecognitionMessage('Scanner attivo. Tieni la carta al centro.')
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
    setScanSessionActive(false)
    setShowSummary(true)
    setPendingRecognition(null)
    setRecognitionMessage('Scansione fermata. Controlla il riepilogo.')
  }

  const handleSummarySwipe = (direction: 'left' | 'right') => {
    if (scannedCards.length <= 1) return
    if (direction === 'left') {
      setCarouselIndex(prev => (prev + 1) % scannedCards.length)
    } else {
      setCarouselIndex(prev => (prev - 1 + scannedCards.length) % scannedCards.length)
    }
  }

  const handleTouchStart = (event: any) => {
    if (event.touches?.length) {
      const touch = event.touches[0]
      ;(event.currentTarget as HTMLDivElement).dataset.touchStart = String(touch.clientX)
    }
  }

  const handleTouchEnd = (event: any) => {
    const start = Number((event.currentTarget as HTMLDivElement).dataset.touchStart || '0')
    const end = event.changedTouches?.[0]?.clientX ?? 0
    const delta = end - start
    if (delta < -60) {
      handleSummarySwipe('left')
    } else if (delta > 60) {
      handleSummarySwipe('right')
    }
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
                  <canvas ref={processingCanvasRef} className="hidden" />

                  {detectedRect && cameraActive && cameraReady && (
                    <div className="pointer-events-none absolute inset-0">
                      <div
                        className="absolute rounded-xl border-2 border-emerald-400/90 shadow-[0_0_0_9999px_rgba(0,0,0,0.45)]"
                        style={{
                          left: `${(detectedRect.x / (videoRef.current?.videoWidth || 1)) * 100}%`,
                          top: `${(detectedRect.y / (videoRef.current?.videoHeight || 1)) * 100}%`,
                          width: `${(detectedRect.width / (videoRef.current?.videoWidth || 1)) * 100}%`,
                          height: `${(detectedRect.height / (videoRef.current?.videoHeight || 1)) * 100}%`
                        }}
                      />
                    </div>
                  )}

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
                  <div className="flex items-center gap-3">
                    <button
                      onClick={cameraActive ? stopCamera : startCamera}
                      className={`flex h-16 w-16 items-center justify-center rounded-full border text-white shadow-lg transition ${cameraActive ? 'border-red-500/40 bg-red-500/20 hover:bg-red-500/30' : 'border-amber-400/40 bg-gradient-to-br from-amber-400 to-amber-500 text-slate-900 hover:shadow-amber-400/30'}`}
                    >
                      <Camera size={24} />
                    </button>
                    {cameraActive && cameraReady && (
                      <button
                        onClick={handleScanCard}
                        className="rounded-full border border-emerald-500/40 bg-emerald-500/15 px-4 py-2 text-sm font-semibold text-emerald-300 transition hover:bg-emerald-500/25"
                      >
                        Scansiona ora
                      </button>
                    )}
                  </div>
                  <p className="text-sm font-semibold text-slate-300">{cameraActive ? 'Ferma scan' : 'Avvia scan'}</p>
                </div>

                {cameraError && (
                  <div className="rounded-2xl border border-amber-400/20 bg-amber-400/10 px-3 py-2 text-sm text-amber-200">
                    {cameraError}
                  </div>
                )}

                <div className="rounded-2xl border border-slate-700 bg-slate-800/60 px-3 py-2 text-sm text-slate-300">
                  {recognitionMessage}
                </div>

                {(showSummary || scannedCards.length > 0) && (
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

          {showSummary && (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/90 px-3 py-4 sm:px-6">
              <div className="w-full max-w-[460px] rounded-[30px] border border-amber-400/30 bg-slate-900/95 p-3 shadow-[0_25px_70px_rgba(0,0,0,0.45)]">
                <div className="mb-3 flex items-center justify-between">
                  <div>
                    <p className="text-[10px] uppercase tracking-[0.35em] text-slate-400">Riepilogo</p>
                    <h3 className="text-sm font-bold text-amber-300">{scannedCards.length > 0 ? 'Carte confermate' : 'Nessuna carta confermata'}</h3>
                  </div>
                  <button
                    onClick={() => setShowSummary(false)}
                    className="rounded-full border border-slate-700 bg-slate-800/80 px-3 py-1.5 text-xs font-semibold text-slate-200"
                  >
                    Chiudi
                  </button>
                </div>

                {scannedCards.length === 0 ? (
                  <div className="rounded-[24px] border border-dashed border-slate-700 bg-slate-800/50 p-5 text-center text-sm text-slate-400">
                    Nessuna carta è stata confermata. Tieni la carta al centro e conferma il popup quando appare.
                  </div>
                ) : (
                  <div
                    className="space-y-3"
                    onTouchStart={handleTouchStart}
                    onTouchEnd={handleTouchEnd}
                  >
                    <div className="flex items-center justify-between text-xs text-slate-400">
                      <span>{carouselIndex + 1} / {scannedCards.length}</span>
                      <span>Trascina a sinistra o destra</span>
                    </div>

                    {currentCard && (
                      <div className="rounded-[24px] border border-amber-400/20 bg-slate-800/70 p-3 shadow-[0_20px_45px_rgba(0,0,0,0.25)]">
                        <img
                          src={currentCard.image_url || ''}
                          alt={currentCard.name || 'Carta'}
                          className="aspect-[3/4] w-full rounded-[18px] object-contain"
                        />
                        <div className="mt-3 space-y-2 text-center">
                          <p className="text-lg font-bold text-white">{currentCard.name}</p>
                          <p className="text-[11px] uppercase tracking-[0.3em] text-slate-400">{currentCard.card_id}</p>
                          <div className="rounded-2xl border border-amber-400/20 bg-amber-400/10 px-3 py-2">
                            <p className="text-[10px] uppercase tracking-[0.3em] text-slate-400">Valore</p>
                            <p className="text-base font-bold text-amber-300">{((currentCard.market_price || currentCard.inventory_price || 0)).toFixed(2)}€</p>
                          </div>
                          <div className="flex items-center justify-center gap-2 text-[11px] text-slate-400">
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

                    <div className="flex items-center justify-center gap-2">
                      <button
                        onClick={() => handleSummarySwipe('right')}
                        className="rounded-full border border-slate-700 bg-slate-800/80 p-2 text-slate-200"
                      >
                        <ChevronLeft size={16} />
                      </button>
                      <button
                        onClick={() => handleSummarySwipe('left')}
                        className="rounded-full border border-slate-700 bg-slate-800/80 p-2 text-slate-200"
                      >
                        <ChevronRight size={16} />
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {pendingRecognition && (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 px-4 py-6">
              <div className="w-full max-w-[420px] rounded-[28px] border border-amber-400/30 bg-slate-900/95 p-4 shadow-[0_20px_60px_rgba(0,0,0,0.45)]">
                <p className="text-center text-[10px] uppercase tracking-[0.35em] text-amber-300">Carta rilevata</p>
                <h3 className="mt-2 text-center text-xl font-bold text-white">{pendingRecognition.name}</h3>
                <div className="mt-4 overflow-hidden rounded-[24px] border border-slate-700 bg-slate-800/80 p-2">
                  <img src={pendingRecognition.image_url || ''} alt={pendingRecognition.name || 'Carta'} className="h-[320px] w-full rounded-[18px] object-contain" />
                </div>
                <p className="mt-3 text-center text-sm text-slate-300">Questa è la carta che hai appena scansionato?</p>
                <div className="mt-4 flex gap-2">
                  <button
                    onClick={() => setPendingRecognition(null)}
                    className="flex-1 rounded-2xl border border-slate-600 bg-slate-800 px-3 py-2 text-sm font-semibold text-slate-200 transition hover:border-slate-500"
                  >
                    Scarta
                  </button>
                  <button
                    onClick={() => confirmRecognizedCard(pendingRecognition)}
                    className="flex-1 rounded-2xl border border-emerald-500/40 bg-emerald-500/15 px-3 py-2 text-sm font-semibold text-emerald-300 transition hover:bg-emerald-500/25"
                  >
                    Conferma
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
