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

type ReferenceCard = ScannedCard & {
  card_text?: string | null
  set_name?: string | null
  sub_types?: string | null
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
  const [referenceCards, setReferenceCards] = useState<ReferenceCard[]>([])
  const [detectedRect, setDetectedRect] = useState<{ x: number; y: number; width: number; height: number } | null>(null)
  const [recognitionMessage, setRecognitionMessage] = useState('Attendi il riconoscimento...')
  const [pendingRecognition, setPendingRecognition] = useState<ScannedCard | null>(null)
  const [opencvReady, setOpencvReady] = useState(false)
  const [ocrReady] = useState(true)
  const [videoSize, setVideoSize] = useState({ width: 1, height: 1 })
  const [scanSessionActive, setScanSessionActive] = useState(false)
  const [showSummary, setShowSummary] = useState(false)
  const processingCanvasRef = useRef<HTMLCanvasElement>(null)
  const detectionLoopRef = useRef<number | null>(null)
  const detectionInProgressRef = useRef(false)

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
      if (!detectionInProgressRef.current && !pendingRecognition) {
        void detectCardFromFrame()
      }
    }, 2000)

    return () => {
      if (detectionLoopRef.current) {
        window.clearInterval(detectionLoopRef.current)
        detectionLoopRef.current = null
      }
    }
  }, [cameraActive, cameraReady, referenceCards.length, ocrReady, scanSessionActive, pendingRecognition])

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
      setVideoSize({
        width: videoRef.current.videoWidth || 1,
        height: videoRef.current.videoHeight || 1
      })
    } catch {
      videoRef.current.onloadedmetadata = () => {
        setVideoSize({
          width: videoRef.current?.videoWidth || 1,
          height: videoRef.current?.videoHeight || 1
        })
        videoRef.current?.play().catch(() => undefined)
      }
    }
  }

  const normalizeText = (value: string) => value.toLowerCase().replace(/[^a-z0-9]/g, ' ')

  const normalizeOcrNumber = (value: string) =>
    value
      .toUpperCase()
      .replace(/O/g, '0')
      .replace(/[IL]/g, '1')
      .replace(/S/g, '5')
      .replace(/B/g, '8')
      .replace(/[^0-9]/g, '')

  const extractCardCode = (text: string) => {
    const compact = text.toUpperCase().replace(/[^A-Z0-9]/g, '')
    const codeMatch = compact.match(/(OP|0P|ST|EB|PRB|SP|DON|D0N|EX|CP|P)([A-Z0-9]{1,2})([A-Z0-9]{3})/)
    if (!codeMatch) return null

    const prefix = codeMatch[1].replace('0P', 'OP').replace('D0N', 'DON')
    const setNumber = normalizeOcrNumber(codeMatch[2]).padStart(2, '0')
    const cardNumber = normalizeOcrNumber(codeMatch[3]).padStart(3, '0')

    if (!setNumber || !cardNumber) return null
    return `${prefix}${setNumber}-${cardNumber}`
  }

  const extractCardQuery = (text: string) => {
    const cleaned = text.replace(/\s+/g, ' ').trim()
    if (!cleaned) return null

    const codeMatch = extractCardCode(cleaned)
    if (codeMatch) return codeMatch

    const words = cleaned
      .split(' ')
      .map(word => word.trim())
      .filter(Boolean)
      .filter(word => word.length > 2 && !['the', 'and', 'for', 'with', 'card', 'cards'].includes(word.toLowerCase()))

    return words.slice(0, 4).join(' ')
  }

  const meaningfulTokens = (value: string) => {
    const stopWords = new Set([
      'the', 'and', 'for', 'with', 'this', 'that', 'your', 'you', 'may', 'card', 'cards',
      'turn', 'play', 'from', 'hand', 'draw', 'when', 'then', 'cost', 'power', 'character',
      'leader', 'event', 'stage', 'don', 'one', 'piece', 'counter', 'activate', 'main'
    ])

    return normalizeText(value)
      .split(' ')
      .filter(token => token.length >= 4 && !stopWords.has(token))
  }

  const toScannedCard = (candidate: ReferenceCard): ScannedCard => ({
    id: `${candidate.card_id || candidate.id || Date.now()}-${Date.now()}`,
    card_id: String(candidate.card_id || candidate.id || ''),
    name: candidate.name,
    image_url: candidate.image_url || null,
    rarity: candidate.rarity || '—',
    card_color: candidate.card_color ?? null,
    card_type: candidate.card_type ?? null,
    card_cost: candidate.card_cost ?? null,
    card_power: candidate.card_power ?? null,
    market_price: candidate.market_price ?? null,
    inventory_price: candidate.inventory_price ?? null,
  })

  const findBestReferenceMatch = async (ocrText: string, cropCanvas: HTMLCanvasElement) => {
    const cardCode = extractCardCode(ocrText)
    const normalizedOcr = normalizeText(ocrText)
    const ocrTokens = meaningfulTokens(ocrText)

    if (cardCode) {
      const exact = referenceCards.find(card => normalizeText(card.card_id || card.id).replace(/\s/g, '') === normalizeText(cardCode).replace(/\s/g, ''))
      if (exact) return toScannedCard(exact)
    }

    if (ocrTokens.length < 2) return null

    const scored = referenceCards
      .map(card => {
        const haystack = [
          card.name,
          card.card_id,
          card.card_text,
          card.set_name,
          card.sub_types,
          card.card_type,
          card.card_color
        ].filter(Boolean).join(' ')
        const haystackText = normalizeText(haystack)
        const nameText = normalizeText(card.name || '')
        const idText = normalizeText(card.card_id || card.id || '')

        let score = 0
        if (idText && normalizedOcr.includes(idText)) score += 10
        if (nameText && normalizedOcr.includes(nameText)) score += 6

        const cardTokens = new Set(meaningfulTokens(haystack))
        for (const token of ocrTokens) {
          if (cardTokens.has(token)) score += nameText.includes(token) ? 2.2 : 1
        }

        return { card, score }
      })
      .filter(item => item.score > 0)
      .sort((a, b) => b.score - a.score)

    const best = scored[0]
    const second = scored[1]
    if (!best || best.score < 5 || (second && best.score - second.score < 2)) return null

    if (best.card.image_url && best.score < 8) {
      const imageScore = await compareImageToCandidate(cropCanvas, best.card.image_url)
      if (imageScore > 95) return null
    }

    return toScannedCard(best.card)
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

      return diff / (total / 4 * 3)
    } catch {
      return Number.POSITIVE_INFINITY
    }
  }

  const searchCardByText = async (query: string, cropCanvas: HTMLCanvasElement) => {
    try {
      if (!query) return null

      const res = await fetch(`/api/cards/search?q=${encodeURIComponent(query || '')}`)
      const results = await res.json()

      if (!query || !Array.isArray(results) || results.length === 0) return null

      const candidatePool = results

      const normalizedQuery = normalizeText(query || '')
      const queryTokens = normalizedQuery.split(' ').filter(Boolean)
      let bestMatch: { card: ScannedCard; score: number } | null = null

      // La foto serve solo a scegliere tra candidati gia filtrati dal testo.
      const poolForImageCompare = candidatePool.length > 12 ? candidatePool.slice(0, 12) : candidatePool

      for (const candidate of poolForImageCompare) {
        const name = String(candidate.card_name || candidate.name || '')
        const id = String(candidate.card_set_id || candidate.card_id || candidate.id || '')
        const normalizedName = normalizeText(name)
        const normalizedId = normalizeText(id)

        let score = 0

        if (normalizedQuery) {
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

          const isLikelyCardId = Boolean(extractCardCode(query || ''))
          if (isLikelyCardId && normalizedId && normalizedId.includes(normalizedQuery)) score += 0.5
        }

        // FIX: il confronto immagine ora pesa molto di più. Se la foto è molto simile
        // alla carta candidata, questo da solo può bastare per identificarla anche
        // senza testo leggibile.
        if (candidate.card_image || candidate.image_url) {
          const imageScore = await compareImageToCandidate(cropCanvas, candidate.card_image || candidate.image_url)
          if (imageScore < 55) score += 1.5
          else if (imageScore < 85) score += 0.9
          else if (imageScore < 115) score += 0.5
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

      return bestMatch && bestMatch.score > 1.6 ? bestMatch.card : null
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
    if (detectionInProgressRef.current) return
    detectionInProgressRef.current = true

    try {
      await detectCardFromFrameUnsafe()
    } finally {
      detectionInProgressRef.current = false
    }
  }

  const detectCardFromFrameUnsafe = async () => {
    if (!videoRef.current || !processingCanvasRef.current || referenceCards.length === 0) return

    const video = videoRef.current
    const canvas = processingCanvasRef.current
    const ctx = canvas.getContext('2d')

    if (!ctx || video.videoWidth === 0 || video.videoHeight === 0) return

    canvas.width = video.videoWidth
    canvas.height = video.videoHeight
    setVideoSize({ width: video.videoWidth, height: video.videoHeight })
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

    // Ritaglio CODICE (striscia in basso: il codice puo stare anche verso destra)
    const codeCropCanvas = document.createElement('canvas')
    codeCropCanvas.width = 720
    codeCropCanvas.height = 360
    const codeCropCtx = codeCropCanvas.getContext('2d')

    // Ritaglio NOME (fascia vicino alla parte alta)
    const nameCropCanvas = document.createElement('canvas')
    nameCropCanvas.width = 720
    nameCropCanvas.height = 220
    const nameCropCtx = nameCropCanvas.getContext('2d')

    if (!codeCropCtx || !nameCropCtx) return

    const codeRegions = [
      { x: 0.02, y: 0.84, width: 0.96, height: 0.15 },
      { x: 0.38, y: 0.80, width: 0.60, height: 0.18 },
      { x: 0.02, y: 0.80, width: 0.62, height: 0.18 }
    ]

    codeRegions.forEach((region, index) => {
      codeCropCtx.drawImage(
        canvas,
        rect.x + rect.width * region.x,
        rect.y + rect.height * region.y,
        rect.width * region.width,
        rect.height * region.height,
        0,
        index * 120,
        codeCropCanvas.width,
        120
      )
    })

    const nameRegionX = rect.x + rect.width * 0.06
    const nameRegionY = rect.y + rect.height * 0.06
    const nameRegionWidth = rect.width * 0.88
    const nameRegionHeight = rect.height * 0.11

    nameCropCtx.drawImage(
      canvas,
      nameRegionX, nameRegionY, nameRegionWidth, nameRegionHeight,
      0, 0, nameCropCanvas.width, nameCropCanvas.height
    )

    const preprocessedCode = document.createElement('canvas')
    preprocessedCode.width = 720
    preprocessedCode.height = 360
    preprocessForOcr(codeCropCanvas, preprocessedCode)

    const preprocessedName = document.createElement('canvas')
    preprocessedName.width = 720
    preprocessedName.height = 220
    preprocessForOcr(nameCropCanvas, preprocessedName)

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

    const fullCardCanvas = document.createElement('canvas')
    fullCardCanvas.width = 720
    fullCardCanvas.height = 1000
    const fullCardCtx = fullCardCanvas.getContext('2d')
    if (fullCardCtx) {
      fullCardCtx.drawImage(canvas, rect.x, rect.y, rect.width, rect.height, 0, 0, fullCardCanvas.width, fullCardCanvas.height)
    }

    const preprocessedFullCard = document.createElement('canvas')
    preprocessedFullCard.width = 720
    preprocessedFullCard.height = 1000
    preprocessForOcr(fullCardCanvas, preprocessedFullCard)

    const imageMatchCanvas = document.createElement('canvas')
    imageMatchCanvas.width = 256
    imageMatchCanvas.height = 256
    const imageMatchCtx = imageMatchCanvas.getContext('2d')
    if (imageMatchCtx) {
      imageMatchCtx.drawImage(canvas, rect.x, rect.y, rect.width, rect.height, 0, 0, 256, 256)
    }

    const recognitionCanvas = document.createElement('canvas')
    recognitionCanvas.width = 900
    recognitionCanvas.height = 1580
    const recognitionCtx = recognitionCanvas.getContext('2d')
    if (!recognitionCtx) return

    recognitionCtx.fillStyle = '#ffffff'
    recognitionCtx.fillRect(0, 0, recognitionCanvas.width, recognitionCanvas.height)
    recognitionCtx.drawImage(preprocessedCode, 0, 0, 900, 420)
    recognitionCtx.drawImage(preprocessedName, 0, 430, 900, 260)
    recognitionCtx.drawImage(preprocessedFullCard, 90, 710, 720, 850)

    const ocrText = await runOcrOnCanvas(recognitionCanvas)
    const codeQuery = ocrText ? extractCardQuery(ocrText) : null
    const allOcrText = [codeQuery, ocrText].filter(Boolean).join(' ')

    setRecognitionMessage(allOcrText.trim() ? 'Confronto testo letto con database carte...' : 'Testo non leggibile. Avvicina la carta e aumenta la luce.')

    const cardMatch = await findBestReferenceMatch(allOcrText, imageMatchCanvas)
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
                          left: `${(detectedRect.x / videoSize.width) * 100}%`,
                          top: `${(detectedRect.y / videoSize.height) * 100}%`,
                          width: `${(detectedRect.width / videoSize.width) * 100}%`,
                          height: `${(detectedRect.height / videoSize.height) * 100}%`
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
