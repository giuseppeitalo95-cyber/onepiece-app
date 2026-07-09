'use client'

import { useEffect, useState, useRef } from 'react'
import type { CSSProperties, PointerEvent as ReactPointerEvent } from 'react'
import { supabase } from '@/lib/supabase'
import { useRouter } from 'next/navigation'
import Sidebar from '@/app/components/Sidebar'
import Topbar from '@/app/components/Topbar'
import { Camera, ChevronLeft, ChevronRight } from 'lucide-react'
import { evaluateProgress } from '@/lib/progression'

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
  set_name?: string | null
  market_price?: number | null
  inventory_price?: number | null
  price_source?: string | null
  price_url?: string | null
  price_updated_at?: string | null
}

type ReferenceCard = ScannedCard & {
  card_image?: string | null
  card_text?: string | null
  set_name?: string | null
  sub_types?: string | null
}

type OcrStatus = {
  googleVisionConfigured?: boolean
  serviceRoleConfigured?: boolean
  scansUsed?: number
  scansLimit?: number
  error?: string | null
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
  const [ocrStatus, setOcrStatus] = useState<OcrStatus | null>(null)
  const [failedImages, setFailedImages] = useState<Record<string, boolean>>({})
  const [summaryDrag, setSummaryDrag] = useState({ active: false, startX: 0, offset: 0 })
  const processingCanvasRef = useRef<HTMLCanvasElement>(null)
  const detectionLoopRef = useRef<number | null>(null)
  const detectionInProgressRef = useRef(false)
  const recognitionStreakRef = useRef<{ cardId: string; count: number } | null>(null)
  const summarySwipeTimerRef = useRef<number | null>(null)
  const scanGenerationRef = useRef(0)
  const scanCooldownUntilRef = useRef(0)
  const scanSessionRef = useRef(false)
  const showSummaryRef = useRef(false)

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
    const loadOcrStatus = async () => {
      try {
        const res = await fetch('/api/cards/ocr')
        const data = await res.json()
        setOcrStatus(data)

        if (!data?.googleVisionConfigured) {
          setRecognitionMessage('Google Vision non configurato: aggiungi GOOGLE_VISION_API_KEY su Vercel.')
        } else if (!data?.serviceRoleConfigured) {
          setRecognitionMessage('Limite scansioni non configurato: aggiungi SUPABASE_SERVICE_ROLE_KEY su Vercel.')
        } else if (data?.error) {
          setRecognitionMessage(`Limite scansioni non pronto: ${data.error}. Esegui google_vision_scan_limit.sql su Supabase.`)
        }
      } catch {
        setRecognitionMessage('Impossibile controllare la configurazione Google Vision.')
      }
    }

    loadOcrStatus()
  }, [])

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
      if (summarySwipeTimerRef.current) {
        window.clearTimeout(summarySwipeTimerRef.current)
        summarySwipeTimerRef.current = null
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
    scanSessionRef.current = scanSessionActive
    showSummaryRef.current = showSummary
  }, [scanSessionActive, showSummary])

  useEffect(() => {
    if (!cameraActive || !cameraReady || !scanSessionActive || showSummary) return

    if (!detectionInProgressRef.current && !pendingRecognition && Date.now() >= scanCooldownUntilRef.current) {
      void detectCardFromFrame()
    }

    detectionLoopRef.current = window.setInterval(() => {
      if (!detectionInProgressRef.current && !pendingRecognition && Date.now() >= scanCooldownUntilRef.current) {
        void detectCardFromFrame()
      }
    }, 1300)

    return () => {
      if (detectionLoopRef.current) {
        window.clearInterval(detectionLoopRef.current)
        detectionLoopRef.current = null
      }
    }
  }, [cameraActive, cameraReady, ocrReady, scanSessionActive, showSummary, pendingRecognition])

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
      'leader', 'event', 'stage', 'don', 'one', 'piece', 'counter', 'activate', 'main',
      'opponent', 'during', 'battle', 'trash', 'rest', 'look', 'life', 'less', 'more'
    ])

    return normalizeText(value)
      .split(' ')
      .filter(token => token.length >= 3 && !stopWords.has(token))
  }

  const compactText = (value: string) => value.toLowerCase().replace(/[^a-z0-9]/g, '')
  const baseCardCode = (value: string) => compactText(value).replace(/p\d+$/i, '')

  const cardImageSrc = (url?: string | null) => {
    if (!url) return ''
    if (url.startsWith('/')) return url
    return `/api/cards/recognition-image?url=${encodeURIComponent(url)}`
  }

  const tokenSimilarity = (a: string, b: string) => {
    if (a === b) return 1
    if (a.length < 3 || b.length < 3) return 0
    if (a.includes(b) || b.includes(a)) return 0.85

    const maxLength = Math.max(a.length, b.length)
    let same = 0
    const minLength = Math.min(a.length, b.length)
    for (let i = 0; i < minLength; i += 1) {
      if (a[i] === b[i]) same += 1
    }
    return same / maxLength
  }

  const splitNameParts = (value: string) =>
    meaningfulTokens(value)
      .flatMap(token => token.split(/\d+/))
      .filter(token => token.length >= 3)

  const hasExactCodeMatch = (ocrText: string, card: ScannedCard) => {
    const cardCode = extractCardCode(ocrText)
    return Boolean(cardCode && baseCardCode(cardCode) === baseCardCode(card.card_id || ''))
  }

  const hasStrongNameMatch = (ocrText: string, card: ScannedCard) => {
    const name = normalizeText(card.name || '')
    if (!name) return false

    const normalizedOcr = normalizeText(ocrText)
    if (name.length >= 5 && normalizedOcr.includes(name)) return true

    const nameTokens = meaningfulTokens(card.name || '')
    if (nameTokens.length < 2) return false

    const ocrTokenSet = new Set(meaningfulTokens(ocrText))
    return nameTokens.every(token => ocrTokenSet.has(token))
  }

  const shouldShowRecognizedCard = (card: ScannedCard, ocrText: string) => {
    if (hasExactCodeMatch(ocrText, card) || hasStrongNameMatch(ocrText, card)) {
      recognitionStreakRef.current = null
      return true
    }

    const cardKey = compactText(card.card_id || card.name || '')
    const previous = recognitionStreakRef.current
    const nextCount = previous?.cardId === cardKey ? previous.count + 1 : 1
    recognitionStreakRef.current = { cardId: cardKey, count: nextCount }

    return nextCount >= 2
  }

  const isScanStillActive = (generation: number) =>
    scanGenerationRef.current === generation && scanSessionRef.current && !showSummaryRef.current

  const toScannedCard = (candidate: ReferenceCard): ScannedCard => ({
    id: `${candidate.card_id || candidate.id || Date.now()}-${Date.now()}`,
    card_id: String(candidate.card_id || candidate.id || ''),
    name: candidate.name,
    image_url: candidate.image_url || candidate.card_image || null,
    rarity: candidate.rarity || '—',
    card_color: candidate.card_color ?? null,
    card_type: candidate.card_type ?? null,
    card_cost: candidate.card_cost ?? null,
    card_power: candidate.card_power ?? null,
    set_name: candidate.set_name ?? null,
    market_price: candidate.market_price ?? null,
    inventory_price: candidate.inventory_price ?? null,
  })

  const findBestReferenceMatch = async (ocrText: string, cropCanvas: HTMLCanvasElement) => {
    const cardCode = extractCardCode(ocrText)
    const normalizedOcr = normalizeText(ocrText)
    const ocrTokens = meaningfulTokens(ocrText)

    if (cardCode) {
      const exactMatches = referenceCards.filter(card => baseCardCode(card.card_id || card.id || '') === baseCardCode(cardCode))
      if (exactMatches.length === 1) return toScannedCard(exactMatches[0])

      if (exactMatches.length > 1) {
        const compactOcr = compactText(ocrText)
        const variantMatches = await Promise.all(
          exactMatches.slice(0, 12).map(async card => {
            const id = compactText(card.card_id || card.id || '')
            const name = compactText(card.name || '')
            const imageUrl = card.image_url || card.card_image
            const imageDistance = imageUrl ? await compareImageToCandidate(cropCanvas, imageUrl) : 999
            let score = Math.max(0, 130 - imageDistance)

            if (id && compactOcr.includes(id)) score += 70
            if (name && compactOcr.includes(name)) score += 18
            if (/(_p\d+|parallel|alternate|alt|special|manga|treasure)/i.test(String(card.card_id || card.id || card.rarity || ''))) score += 2

            return { card, score }
          })
        )

        variantMatches.sort((a, b) => b.score - a.score)
        return toScannedCard(variantMatches[0].card)
      }
    }

    if (ocrTokens.length < 1) return null

    const scored = referenceCards
      .map(card => {
        const strongHaystack = [
          card.name,
          card.card_id,
          card.rarity,
          card.card_cost,
          card.card_power,
          card.set_name,
          card.sub_types,
          card.card_type,
          card.card_color
        ].filter(Boolean).join(' ')
        const effectText = card.card_text || ''
        const nameText = normalizeText(card.name || '')
        const compactName = compactText(card.name || '')
        const idText = compactText(card.card_id || card.id || '')
        const compactOcr = compactText(ocrText)
        const nameTokens = splitNameParts(card.name || '')
        const cardTokens = meaningfulTokens(strongHaystack)
        const effectTokens = meaningfulTokens(effectText)

        let score = 0
        let identityScore = 0
        if (idText && compactOcr.includes(idText)) identityScore += 28
        if (compactName && compactOcr.includes(compactName)) identityScore += 18
        if (nameText && normalizedOcr.includes(nameText)) identityScore += 12

        const cardTokenSet = new Set(cardTokens)
        const effectTokenSet = new Set(effectTokens)
        for (const token of ocrTokens) {
          if (cardTokenSet.has(token)) score += nameText.includes(token) ? 1 : 1.5
          else if (identityScore > 0 && effectTokenSet.has(token)) score += 0.25
          for (const nameToken of nameTokens) {
            if (tokenSimilarity(token, nameToken) >= 0.78) identityScore += 3
          }
        }

        return { card, score: identityScore > 0 ? score + identityScore : 0 }
      })
      .filter(item => item.score > 0)
      .sort((a, b) => b.score - a.score)

    const bestText = scored[0]
    const secondText = scored[1]
    const textGap = bestText ? bestText.score - (secondText?.score || 0) : 0

    if (!bestText || bestText.score < 4) return null

    if (bestText.score >= 16 || (bestText.score >= 9 && textGap >= 2.5)) {
      return toScannedCard(bestText.card)
    }

    const imageCandidates = await Promise.all(
      scored.slice(0, 4).map(async item => {
        const imageUrl = item.card.image_url || item.card.card_image
        if (!imageUrl) return item

        const imageScore = await compareImageToCandidate(cropCanvas, imageUrl)
        let imageBonus = 0
        if (imageScore < 55) imageBonus = 10
        else if (imageScore < 80) imageBonus = 6
        else if (imageScore < 110) imageBonus = 3

        return {
          ...item,
          score: item.score + imageBonus
        }
      })
    )

    const finalScored = [
      ...imageCandidates,
      ...scored.slice(4)
    ].sort((a, b) => b.score - a.score)

    const best = finalScored[0]
    const second = finalScored[1]
    if (!best || best.score < 5) return null
    if (second && best.score < 8 && best.score - second.score < 1.2) return null

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

  const canvasToImage = (canvas: HTMLCanvasElement) => canvas.toDataURL('image/jpeg', 0.86)

  const runOcrOnCanvases = async (canvases: HTMLCanvasElement[]) => {
    try {
      const res = await fetch('/api/cards/ocr', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ images: canvases.map(canvasToImage) })
      })
      const data = await res.json()

      if (!res.ok) {
        if (data?.scanLimitReached) {
          setRecognitionMessage(`Limite mensile globale raggiunto: ${data.scansUsed}/${data.scansLimit} scansioni.`)
        } else if (data?.error) {
          setRecognitionMessage(`OCR non configurato: ${data.error}`)
        }
        return null
      }

      return typeof data?.text === 'string' ? data.text : null
    } catch {
      if (scanSessionRef.current && !showSummaryRef.current) {
        setRecognitionMessage('OCR non raggiungibile. Controlla la connessione o la configurazione Google Vision.')
      }
      return null
    }
  }

  const recognizeCardByText = async (text: string) => {
    if (!text.trim()) return null

    try {
      const res = await fetch('/api/cards/recognize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text })
      })
      const data = await res.json()
      return data?.card ? toScannedCard(data.card) : null
    } catch {
      return null
    }
  }

  const enrichCardWithLivePrice = async (card: ScannedCard) => {
    try {
      const params = new URLSearchParams()
      if (card.card_id) params.set('cardId', card.card_id)
      if (card.name) params.set('name', card.name)
      if (card.set_name) params.set('setName', card.set_name)

      const res = await fetch(`/api/cards/price?${params.toString()}`)
      const data = await res.json()
      const price = data?.price
      if (!price) return card

      return {
        ...card,
        market_price: price.marketPrice ?? price.midPrice ?? card.market_price ?? null,
        inventory_price: price.lowPrice ?? card.inventory_price ?? null,
        image_url: card.image_url || price.productImageUrl || null,
        price_source: price.source || 'TCGplayer',
        price_url: price.productUrl || null,
        price_updated_at: price.modifiedOn || null
      }
    } catch {
      return card
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
      const poolForImageCompare = candidatePool.length > 4 ? candidatePool.slice(0, 4) : candidatePool

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
              card_color: candidate.card_color ?? null,
              card_type: candidate.card_type ?? null,
              card_cost: candidate.card_cost ? Number(candidate.card_cost) : null,
              card_power: candidate.card_power ? Number(candidate.card_power) : null,
              set_name: candidate.set_name ?? null,
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
      const copy = {
        ...card,
        id: `${card.card_id || card.name || 'card'}-${Date.now()}-${Math.random()}`
      }
      return [copy, ...prev]
    })
    recognitionStreakRef.current = null
    setCarouselIndex(0)
    setPendingRecognition(null)
    scanCooldownUntilRef.current = Date.now() + 700
    setRecognitionMessage(`Carta aggiunta alla pescata: ${card.name}. Prepara la prossima.`)
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
    if (Date.now() < scanCooldownUntilRef.current) return
    if (!scanSessionRef.current || showSummaryRef.current) return
    const generation = scanGenerationRef.current
    detectionInProgressRef.current = true

    try {
      await detectCardFromFrameUnsafe(generation)
    } finally {
      detectionInProgressRef.current = false
    }
  }

  const detectCardFromFrameUnsafe = async (generation: number) => {
    if (!isScanStillActive(generation)) return
    if (!videoRef.current || !processingCanvasRef.current) return

    const video = videoRef.current
    const canvas = processingCanvasRef.current
    const ctx = canvas.getContext('2d')

    if (!ctx || video.videoWidth === 0 || video.videoHeight === 0) return

    canvas.width = 1080
    canvas.height = 1440
    setVideoSize({ width: canvas.width, height: canvas.height })

    const targetAspect = canvas.width / canvas.height
    const sourceAspect = video.videoWidth / video.videoHeight
    let sourceX = 0
    let sourceY = 0
    let sourceWidth = video.videoWidth
    let sourceHeight = video.videoHeight

    if (sourceAspect > targetAspect) {
      sourceWidth = video.videoHeight * targetAspect
      sourceX = (video.videoWidth - sourceWidth) / 2
    } else {
      sourceHeight = video.videoWidth / targetAspect
      sourceY = (video.videoHeight - sourceHeight) / 2
    }

    ctx.drawImage(
      video,
      sourceX,
      sourceY,
      sourceWidth,
      sourceHeight,
      0,
      0,
      canvas.width,
      canvas.height
    )

    const centerWidth = Math.floor(canvas.width * 0.9)
    const centerHeight = Math.floor(canvas.height * 0.9)
    const x = Math.floor((canvas.width - centerWidth) / 2)
    const y = Math.floor((canvas.height - centerHeight) / 2)
    const rect = { x, y, width: centerWidth, height: centerHeight }

    if (!isScanStillActive(generation)) return

    setDetectedRect(rect)
    setRecognitionMessage('Analisi del frame in corso...')

    // Ritaglio CODICE (striscia in basso: il codice puo stare anche verso destra)
    const codeCropCanvas = document.createElement('canvas')
    codeCropCanvas.width = 720
    codeCropCanvas.height = 360
    const codeCropCtx = codeCropCanvas.getContext('2d')

    // Ritagli leggibili: effetto, nome e riga codice sono le zone piu utili per il match.
    const nameCropCanvas = document.createElement('canvas')
    nameCropCanvas.width = 900
    nameCropCanvas.height = 540
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

    const textRegions = [
      { x: 0.06, y: 0.47, width: 0.88, height: 0.16 },
      { x: 0.06, y: 0.68, width: 0.88, height: 0.15 },
      { x: 0.38, y: 0.80, width: 0.58, height: 0.12 }
    ]

    textRegions.forEach((region, index) => {
      nameCropCtx.drawImage(
        canvas,
        rect.x + rect.width * region.x,
        rect.y + rect.height * region.y,
        rect.width * region.width,
        rect.height * region.height,
        0,
        index * 180,
        nameCropCanvas.width,
        180
      )
    })

    const preprocessedCode = document.createElement('canvas')
    preprocessedCode.width = 720
    preprocessedCode.height = 360
    preprocessForOcr(codeCropCanvas, preprocessedCode)

    const preprocessedName = document.createElement('canvas')
    preprocessedName.width = 900
    preprocessedName.height = 540
    preprocessForOcr(nameCropCanvas, preprocessedName)

    if (!ocrReady) {
      setRecognitionMessage('Inizializzo il riconoscimento del testo...')
      return
    }

    const fullCardCanvas = document.createElement('canvas')
    fullCardCanvas.width = 900
    fullCardCanvas.height = 1250
    const fullCardCtx = fullCardCanvas.getContext('2d')
    if (!fullCardCtx) return
    fullCardCtx.drawImage(canvas, rect.x, rect.y, rect.width, rect.height, 0, 0, fullCardCanvas.width, fullCardCanvas.height)

    const imageMatchCanvas = document.createElement('canvas')
    imageMatchCanvas.width = 256
    imageMatchCanvas.height = 256
    const imageMatchCtx = imageMatchCanvas.getContext('2d')
    if (imageMatchCtx) {
      imageMatchCtx.drawImage(canvas, rect.x, rect.y, rect.width, rect.height, 0, 0, 256, 256)
    }

    const ocrText = await runOcrOnCanvases([
      codeCropCanvas,
      preprocessedCode,
      nameCropCanvas,
      preprocessedName,
      fullCardCanvas
    ])
    if (!isScanStillActive(generation)) return

    const codeQuery = ocrText ? extractCardQuery(ocrText) : null
    const allOcrText = [codeQuery, ocrText].filter(Boolean).join(' ')

    setRecognitionMessage(allOcrText.trim() ? 'Confronto testo letto con database carte...' : 'Testo non leggibile. Avvicina la carta e aumenta la luce.')

    const localMatch = referenceCards.length > 0
      ? await findBestReferenceMatch(allOcrText, imageMatchCanvas)
      : null
    if (!isScanStillActive(generation)) return

    const serverMatch = localMatch || (referenceCards.length === 0 ? await recognizeCardByText(allOcrText) : null)
    if (!isScanStillActive(generation)) return

    const searchMatch = localMatch || serverMatch ? null : await searchCardByText(codeQuery || allOcrText, imageMatchCanvas)
    if (!isScanStillActive(generation)) return

    const cardMatch = localMatch || serverMatch || searchMatch
    if (cardMatch) {
      if (!shouldShowRecognizedCard(cardMatch, allOcrText)) {
        setRecognitionMessage(`Possibile carta: ${cardMatch.name}. Tienila ferma per confermare.`)
        return
      }

      setRecognitionMessage(`Carta trovata: ${cardMatch.name}. Recupero prezzo live...`)
      const pricedCard = await enrichCardWithLivePrice(cardMatch)
      if (!isScanStillActive(generation)) return

      setPendingRecognition(pricedCard)
      setRecognitionMessage(`Carta trovata: ${pricedCard.name}. Conferma o scarta.`)
    } else {
      recognitionStreakRef.current = null
      const previewText = allOcrText.replace(/\s+/g, ' ').trim().slice(0, 90)
      setRecognitionMessage(previewText ? `Testo letto ma nessun match: ${previewText}` : 'Google Vision non ha letto testo utile. Avvicina la carta e aumenta la luce.')
    }
  }

  const handleScanCard = async () => {
    if (!cameraActive || !cameraReady) return
    setRecognitionMessage('Scansione in corso...')
    await detectCardFromFrame()
  }

  const startCamera = async () => {
    if (ocrStatus && !ocrStatus.googleVisionConfigured) {
      setCameraError('Google Vision non e configurato. Devi aggiungere GOOGLE_VISION_API_KEY su Vercel.')
      return
    }

    if (ocrStatus && !ocrStatus.serviceRoleConfigured) {
      setCameraError('Il blocco delle 1000 scansioni non e configurato. Devi aggiungere SUPABASE_SERVICE_ROLE_KEY su Vercel.')
      return
    }

    if (ocrStatus?.error) {
      setCameraError(`Il blocco delle 1000 scansioni non e pronto: ${ocrStatus.error}. Devi eseguire google_vision_scan_limit.sql su Supabase.`)
      return
    }

    if (!navigator.mediaDevices?.getUserMedia) {
      setCameraError('La camera non è disponibile nel tuo browser.')
      return
    }

    if (streamRef.current) {
      await attachStream(streamRef.current)
      scanGenerationRef.current += 1
      scanCooldownUntilRef.current = 0
      scanSessionRef.current = true
      showSummaryRef.current = false
      setCameraActive(true)
      setCameraReady(true)
      setCameraError(null)
      setScanSessionActive(true)
      setShowSummary(false)
      setPendingRecognition(null)
      recognitionStreakRef.current = null
      return
    }

    try {
      const constraintsList: MediaStreamConstraints[] = [
        {
          video: {
            facingMode: { ideal: 'environment' },
            width: { ideal: 3840 },
            height: { ideal: 2160 },
            frameRate: { ideal: 30 }
          },
          audio: false
        },
        {
          video: {
            facingMode: { ideal: 'environment' },
            width: { ideal: 1920 },
            height: { ideal: 1080 },
            frameRate: { ideal: 30 }
          },
          audio: false
        },
        {
          video: {
            width: { ideal: 1920 },
            height: { ideal: 1080 },
            frameRate: { ideal: 30 }
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
      scanGenerationRef.current += 1
      scanCooldownUntilRef.current = 0
      scanSessionRef.current = true
      showSummaryRef.current = false
      setCameraActive(true)
      setCameraReady(true)
      setCameraError(null)
      setScanSessionActive(true)
      setShowSummary(false)
      setPendingRecognition(null)
      recognitionStreakRef.current = null
      setRecognitionMessage('Scanner attivo. Tieni la carta al centro.')
    } catch (err) {
      console.error('Camera error:', err)
      scanGenerationRef.current += 1
      scanSessionRef.current = false
      setCameraActive(false)
      setCameraReady(false)
      setCameraError('Non è stato possibile avviare la camera. Prova a ricaricare la pagina e a consentire l’accesso dalla richiesta del browser.')
    }
  }

  const stopCamera = () => {
    scanGenerationRef.current += 1
    scanCooldownUntilRef.current = 0
    scanSessionRef.current = false
    showSummaryRef.current = true
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
    recognitionStreakRef.current = null
    setRecognitionMessage('Scansione fermata. Controlla il riepilogo.')
  }

  const animateSummarySwipe = (direction: 'left' | 'right') => {
    if (scannedCards.length <= 1) return

    if (summarySwipeTimerRef.current) {
      window.clearTimeout(summarySwipeTimerRef.current)
    }

    const exitOffset = direction === 'left' ? -190 : 190

    setSummaryDrag({ active: false, startX: 0, offset: exitOffset })
    summarySwipeTimerRef.current = window.setTimeout(() => {
      setCarouselIndex(prev => (
        direction === 'left'
          ? (prev + 1) % scannedCards.length
          : (prev - 1 + scannedCards.length) % scannedCards.length
      ))
      setSummaryDrag({ active: false, startX: 0, offset: 0 })
      summarySwipeTimerRef.current = null
    }, 260)
  }

  const beginSummaryDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (scannedCards.length <= 1) return
    event.currentTarget.setPointerCapture?.(event.pointerId)
    setSummaryDrag({ active: true, startX: event.clientX, offset: 0 })
  }

  const moveSummaryDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!summaryDrag.active) return
    const offset = Math.max(-220, Math.min(220, event.clientX - summaryDrag.startX))
    setSummaryDrag(prev => ({ ...prev, offset }))
  }

  const endSummaryDrag = () => {
    if (!summaryDrag.active) return
    const offset = summaryDrag.offset

    if (offset < -70) {
      animateSummarySwipe('left')
    } else if (offset > 70) {
      animateSummarySwipe('right')
    } else {
      setSummaryDrag({ active: false, startX: 0, offset: 0 })
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

  const saveCardToCollection = async (card: ScannedCard) => {
    if (!userId) return

    const { data: existing, error: lookupError } = await supabase
      .from('user_cards')
      .select('id, quantity')
      .eq('user_id', userId)
      .eq('card_id', card.card_id)
      .maybeSingle()

    if (lookupError) throw lookupError

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
      const { error } = await supabase
        .from('user_cards')
        .update({
          quantity: existing.quantity + 1,
          ...payload
        })
        .eq('id', existing.id)

      if (error) throw error
    } else {
      const { error } = await supabase
        .from('user_cards')
        .insert({
          ...payload,
          quantity: 1
        })

      if (error) throw error
    }
  }

  const saveCardsToCollectionBatch = async (cards: ScannedCard[]) => {
    if (!userId || cards.length === 0) return

    const grouped = new Map<string, { card: ScannedCard; quantity: number }>()
    for (const card of cards) {
      const key = card.card_id
      if (!key) continue
      const current = grouped.get(key)
      grouped.set(key, { card, quantity: (current?.quantity || 0) + 1 })
    }

    const cardIds = [...grouped.keys()]
    if (cardIds.length === 0) return

    const { data: existingCards, error: lookupError } = await supabase
      .from('user_cards')
      .select('id, card_id, quantity')
      .eq('user_id', userId)
      .in('card_id', cardIds)

    if (lookupError) throw lookupError

    const existingById = new Map((existingCards || []).map(card => [String(card.card_id), card]))
    const inserts: Array<Record<string, unknown>> = []
    const operations: Array<Promise<{ error: unknown }>> = []

    grouped.forEach(({ card, quantity }, cardId) => {
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
      const existing = existingById.get(cardId)

      if (existing) {
        operations.push(
          Promise.resolve(supabase
            .from('user_cards')
            .update({
              ...payload,
              quantity: Number(existing.quantity || 0) + quantity
            })
            .eq('id', existing.id))
        )
      } else {
        inserts.push({
          ...payload,
          quantity
        })
      }
    })

    if (inserts.length > 0) {
      operations.push(Promise.resolve(supabase.from('user_cards').insert(inserts)))
    }

    const results = await Promise.all(operations)

    const errorResult = results.find(result => result.error)
    if (errorResult?.error) throw errorResult.error
  }

  const refreshProgressAfterCollectionChange = async () => {
    if (!userId) return

    const { data } = await supabase
      .from('user_cards')
      .select('card_id, quantity, name, rarity, card_color, card_type, card_cost, card_power, market_price, inventory_price')
      .eq('user_id', userId)

    evaluateProgress(userId, data || [], { claimDaily: true })
  }

  const addAllToCollection = async () => {
    if (!userId || adding || scannedCards.length === 0) return

    setAdding('all')
    try {
      await saveCardsToCollectionBatch(scannedCards)
      await refreshProgressAfterCollectionChange()
      setScannedCards([])
      setCarouselIndex(0)
      setShowSummary(false)
      setRecognitionMessage('Pescata aggiunta alla collezione.')
    } catch (err) {
      console.error('Add all error:', err)
      alert('Errore aggiunta pescata')
    }
    setAdding(null)
  }

  const discardScanResults = () => {
    setScannedCards([])
    setCarouselIndex(0)
    setShowSummary(false)
    setRecognitionMessage('Pescata chiusa senza salvare.')
  }

  const totalValue = scannedCards.reduce((sum, card) => {
    const price = card.market_price || card.inventory_price || 0
    return sum + price
  }, 0)

  const currentCard = scannedCards[carouselIndex] ?? null
  const currentCardValue = currentCard ? (currentCard.market_price ?? currentCard.inventory_price ?? 0) : 0
  const formatPrice = (value: number) =>
    new Intl.NumberFormat('it-IT', { style: 'currency', currency: 'EUR' }).format(value)
  const carouselSwipeWidth = 190
  const carouselProgress = Math.max(-1, Math.min(1, -summaryDrag.offset / carouselSwipeWidth))
  const cardMotion = summaryDrag.active ? 'none' : 'transform 260ms cubic-bezier(0.2, 0.82, 0.2, 1), opacity 220ms ease'
  const getCarouselDelta = (index: number) => {
    if (scannedCards.length <= 1) return 0
    let delta = index - carouselIndex
    const half = scannedCards.length / 2
    if (delta > half) delta -= scannedCards.length
    if (delta < -half) delta += scannedCards.length
    return delta
  }
  const summaryCarouselCards = scannedCards
    .map((card, index) => ({
      card,
      index,
      relative: getCarouselDelta(index) - carouselProgress
    }))
    .filter(({ relative }) => Math.abs(relative) <= 2.35)
    .sort((a, b) => Math.abs(b.relative) - Math.abs(a.relative))
  const getSummaryCardStyle = (relative: number): CSSProperties => {
    const clamped = Math.max(-2.25, Math.min(2.25, relative))
    const abs = Math.abs(clamped)
    const x = clamped * 150
    const y = abs * 10
    const z = 120 - abs * 115
    const scale = Math.max(0.58, 1 - abs * 0.16)
    const rotateY = -clamped * 34
    const rotateZ = clamped * 4

    return {
      transform: `translate(-50%, -50%) translate3d(${x}px, ${y}px, ${z}px) rotateY(${rotateY}deg) rotateZ(${rotateZ}deg) scale(${scale})`,
      opacity: abs > 2.05 ? 0 : Math.max(0.2, 1 - abs * 0.36),
      transition: cardMotion,
      willChange: 'transform, opacity',
      zIndex: Math.round(80 - abs * 12),
      pointerEvents: abs < 1.35 ? 'auto' : 'none'
    }
  }
  const imageKey = (card: ScannedCard) => `${card.id}:${card.image_url || ''}`
  const renderCardImage = (card: ScannedCard, className: string) => {
    const key = imageKey(card)
    const hasImage = Boolean(card.image_url && !failedImages[key])

    return (
      <div className={`relative overflow-hidden bg-slate-950 ${className}`}>
        {hasImage ? (
          <img
            src={cardImageSrc(card.image_url)}
            alt={card.name || 'Carta'}
            draggable={false}
            onError={() => setFailedImages(prev => ({ ...prev, [key]: true }))}
            className="h-full w-full object-contain"
          />
        ) : (
          <div className="flex h-full w-full flex-col items-center justify-center gap-2 bg-slate-900 px-4 text-center text-slate-500">
            <span className="text-4xl font-black">?</span>
            <span className="text-[10px] uppercase tracking-[0.24em]">Foto non disponibile</span>
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="h-dvh overflow-hidden text-white onepiece-wave-bg onepiece-clouds flex">
      <Sidebar activePage="scan" />

      <div className="flex-1 flex flex-col overflow-hidden pt-14">
        <Topbar />

        <div className="flex-1 overflow-hidden flex flex-col pb-20">
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
                {!cameraActive && (
                  <div className="flex flex-col items-center gap-2">
                    <button
                      onClick={startCamera}
                      className="op-solid-action flex h-16 w-16 items-center justify-center rounded-full border border-cyan-300/50 bg-gradient-to-br from-cyan-300 to-rose-300 text-slate-950 shadow-lg transition hover:shadow-cyan-300/30"
                    >
                      <Camera size={24} />
                    </button>
                    <p className="text-sm font-semibold text-slate-300">Avvia scan</p>
                  </div>
                )}

                {cameraActive && (
                  <button
                    onClick={stopCamera}
                    className="w-full rounded-2xl border border-red-400/50 bg-red-500/15 px-4 py-3 text-sm font-extrabold uppercase tracking-[0.18em] text-red-200 shadow-lg shadow-red-950/20 transition hover:bg-red-500/25"
                  >
                    Vai ai risultati
                  </button>
                )}

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
                      <p className="text-lg font-bold text-emerald-400">{formatPrice(totalValue)}</p>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>

          {showSummary && (
            <div
              className="fixed inset-0 z-50 flex items-center justify-center overflow-hidden bg-slate-950/95 px-3 py-5 sm:px-6"
              style={{
                backgroundImage: 'linear-gradient(180deg, rgba(15,23,42,0.95), rgba(2,6,23,0.98)), linear-gradient(rgba(148,163,184,0.08) 1px, transparent 1px), linear-gradient(90deg, rgba(148,163,184,0.08) 1px, transparent 1px)',
                backgroundSize: '100% 100%, 26px 26px, 26px 26px'
              }}
            >
              <div className="flex h-full w-full max-w-[540px] flex-col">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-[10px] uppercase tracking-[0.35em] text-amber-300">Risultati scan</p>
                    <h3 className="text-xl font-extrabold text-white">{scannedCards.length > 0 ? `${scannedCards.length} carte pescate` : 'Nessuna carta'}</h3>
                  </div>
                  <div className="rounded-2xl border border-emerald-400/30 bg-emerald-400/10 px-3 py-2 text-right">
                    <p className="text-[9px] uppercase tracking-[0.25em] text-slate-400">Totale</p>
                    <p className="text-base font-bold text-emerald-300">{formatPrice(totalValue)}</p>
                  </div>
                </div>

                {scannedCards.length === 0 ? (
                  <div className="mt-5 flex flex-1 items-center justify-center rounded-[28px] border border-dashed border-slate-700 bg-slate-900/75 p-6 text-center text-sm text-slate-400">
                    Nessuna carta confermata. Torna allo scan e conferma il popup quando trova una carta.
                  </div>
                ) : (
                  <>
                    <div
                      className={`relative mt-3 min-h-[390px] flex-1 touch-pan-y select-none overflow-visible sm:min-h-[540px] ${summaryDrag.active ? 'cursor-grabbing' : 'cursor-grab'}`}
                      style={{ perspective: '1200px', transformStyle: 'preserve-3d', touchAction: 'pan-y' }}
                      onPointerDown={beginSummaryDrag}
                      onPointerMove={moveSummaryDrag}
                      onPointerUp={endSummaryDrag}
                      onPointerCancel={endSummaryDrag}
                    >
                      {summaryCarouselCards.map(({ card, index, relative }) => {
                        const abs = Math.abs(relative)
                        const isCenter = abs < 0.45
                        const direction = relative > 0 ? 'left' : 'right'

                        return (
                          <button
                            key={card.id}
                            onClick={() => {
                              if (!isCenter) animateSummarySwipe(direction)
                            }}
                            className={`${isCenter ? 'w-[84%] max-w-[410px]' : 'w-[62%] max-w-[310px]'} absolute left-1/2 top-1/2 active:scale-[0.99]`}
                            style={getSummaryCardStyle(relative)}
                            aria-label={isCenter ? `Carta ${index + 1}` : relative > 0 ? 'Carta successiva' : 'Carta precedente'}
                          >
                            <div className={`relative ${isCenter ? 'rounded-[30px] border border-cyan-200/40 bg-slate-900/80 p-2 shadow-[0_30px_80px_rgba(0,0,0,0.62)]' : 'rounded-[24px] opacity-90 shadow-2xl'}`}>
                              {isCenter && <div className="pointer-events-none absolute inset-2 rounded-[24px] border border-white/10" />}
                              {renderCardImage(card, `${isCenter ? 'rounded-[24px]' : 'rounded-[22px] border border-slate-700'} aspect-[3/4] w-full`)}
                            </div>
                          </button>
                        )
                      })}

                      <button
                        onClick={() => animateSummarySwipe('right')}
                        className="absolute left-1 top-1/2 z-20 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-full border border-slate-600 bg-slate-950/70 text-slate-100 backdrop-blur"
                        aria-label="Precedente"
                      >
                        <ChevronLeft size={18} />
                      </button>
                      <button
                        onClick={() => animateSummarySwipe('left')}
                        className="absolute right-1 top-1/2 z-20 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-full border border-slate-600 bg-slate-950/70 text-slate-100 backdrop-blur"
                        aria-label="Successiva"
                      >
                        <ChevronRight size={18} />
                      </button>
                    </div>

                    {currentCard && (
                      <div className="mt-2 rounded-[24px] border border-slate-700 bg-slate-900/88 px-4 py-3 text-center shadow-lg">
                        <p className="text-2xl font-black text-cyan-200">{formatPrice(currentCardValue)}</p>
                        <p className="mt-2 text-base font-extrabold text-white">{currentCard.name}</p>
                        <div className="mt-1 flex items-center justify-center gap-2 text-[11px] text-slate-400">
                          <span>{currentCard.card_id}</span>
                          <span className="rounded-full border border-slate-700 px-2 py-1">{carouselIndex + 1} / {scannedCards.length}</span>
                        </div>
                      </div>
                    )}

                    <div className="mt-3 flex h-2 items-center justify-center gap-1 overflow-hidden">
                      {scannedCards.slice(0, 14).map((card, index) => (
                        <button
                          key={`${card.id}-dot`}
                          onClick={() => {
                            setSummaryDrag({ active: false, startX: 0, offset: 0 })
                            setCarouselIndex(index)
                          }}
                          className={`h-1.5 rounded-full transition-all ${index === carouselIndex ? 'w-6 bg-amber-300' : 'w-1.5 bg-slate-600'}`}
                          aria-label={`Vai alla carta ${index + 1}`}
                        />
                      ))}
                    </div>
                  </>
                )}

                <div className="mt-4 grid grid-cols-2 gap-3">
                  <button
                    onClick={discardScanResults}
                    className="rounded-2xl border border-slate-600 bg-slate-900 px-4 py-3 text-sm font-bold text-slate-200 transition hover:border-slate-400"
                  >
                    Chiudi
                  </button>
                  <button
                    onClick={addAllToCollection}
                    disabled={adding === 'all' || scannedCards.length === 0}
                    className="rounded-2xl border border-emerald-400/50 bg-emerald-500/20 px-4 py-3 text-sm font-bold text-emerald-200 transition hover:bg-emerald-500/30 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {adding === 'all' ? 'Salvo...' : 'Aggiungi alla collezione'}
                  </button>
                </div>
              </div>
            </div>
          )}

          {pendingRecognition && !showSummary && (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 px-4 py-6">
              <div className="w-full max-w-[420px] rounded-[28px] border border-amber-400/30 bg-slate-900/95 p-4 shadow-[0_20px_60px_rgba(0,0,0,0.45)]">
                <p className="text-center text-[10px] uppercase tracking-[0.35em] text-amber-300">Carta rilevata</p>
                <h3 className="mt-2 text-center text-xl font-bold text-white">{pendingRecognition.name}</h3>
                <p className="mt-1 text-center text-[11px] uppercase tracking-[0.25em] text-slate-400">{pendingRecognition.card_id}</p>
                <div className="mt-4">
                  {renderCardImage(pendingRecognition, 'h-[52vh] min-h-[300px] max-h-[430px] w-full rounded-[24px] border border-slate-700')}
                </div>
                <div className="mt-3 rounded-2xl border border-cyan-300/25 bg-cyan-300/10 px-3 py-2 text-center">
                  <p className="text-[10px] uppercase tracking-[0.3em] text-slate-400">Valore live</p>
                  <p className="mt-1 text-2xl font-black text-cyan-200">
                    {formatPrice(pendingRecognition.market_price ?? pendingRecognition.inventory_price ?? 0)}
                  </p>
                </div>
                <p className="mt-3 text-center text-sm text-slate-300">Questa e la carta che hai appena scansionato?</p>
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
