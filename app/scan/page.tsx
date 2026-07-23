'use client'

import { useEffect, useMemo, useState, useRef } from 'react'
import type { ChangeEvent, CSSProperties, PointerEvent as ReactPointerEvent } from 'react'
import { supabase } from '@/lib/supabase'
import { useRouter } from 'next/navigation'
import Sidebar from '@/app/components/Sidebar'
import Topbar from '@/app/components/Topbar'
import { Camera, ChevronLeft, ChevronRight, Images, Info, LoaderCircle, Minus, Plus, ScanLine } from 'lucide-react'
import { trackAnalyticsEvent } from '@/lib/analytics'
import { getRarityLabel } from '@/lib/rarity'
import { parseCardCodeFromText } from '@/lib/cardRecognition'
import {
  buildMultiCardOcrSheet,
  detectCardsInPhoto,
  inferCardsFromOcrLayout,
  type MultiCardDetection,
  type OcrPositionedWord,
  type OcrSheetRegion,
} from '@/lib/multiCardDetection'

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
  quantity?: number
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

type VisibleTextDecision = {
  cardId: string
  family: string
  decisive: boolean
  exactName: boolean
  nameCoverage: number
  hasEffect: boolean
  effectMatches: number
  effectBigrams: number
  metadataMatches: number
  costMatch: boolean
  powerMatch: boolean
  counterMatch: boolean
  scoreGap: number
}

type ScanMode = 'single' | 'multi'

type MultiRecognitionItem = {
  card: ScannedCard
  text: string
  crop: HTMLCanvasElement
}

export default function ScanPage() {
  const router = useRouter()
  const videoRef = useRef<HTMLVideoElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const photoInputRef = useRef<HTMLInputElement>(null)
  const capturedPhotoUrlRef = useRef<string | null>(null)

  const [userId, setUserId] = useState<string | null>(null)
  const [cameraActive, setCameraActive] = useState(false)
  const [cameraReady, setCameraReady] = useState(false)
  const [cameraError, setCameraError] = useState<string | null>(null)
  const [searchInput, setSearchInput] = useState('')
  const [scannedCards, setScannedCards] = useState<ScannedCard[]>([])
  const [searching, setSearching] = useState(false)
  const [adding, setAdding] = useState<string | null>(null)
  const [carouselIndex, setCarouselIndex] = useState(0)
  const [referenceCards] = useState<ReferenceCard[]>([])
  const [detectedRect, setDetectedRect] = useState<{ x: number; y: number; width: number; height: number } | null>(null)
  const [recognitionMessage, setRecognitionMessage] = useState('Attendi il riconoscimento...')
  const [pendingRecognition, setPendingRecognition] = useState<ScannedCard | null>(null)
  const [recognitionQuantity, setRecognitionQuantity] = useState(1)
  const [recognitionVariants, setRecognitionVariants] = useState<ScannedCard[]>([])
  const [recognitionVariantsLoading, setRecognitionVariantsLoading] = useState(false)
  const [variantChoiceRequired, setVariantChoiceRequired] = useState(false)
  const [ocrReady] = useState(true)
  const [videoSize, setVideoSize] = useState({ width: 1, height: 1 })
  const [cameraDisplayZoom, setCameraDisplayZoom] = useState(1.1)
  const [scanSessionActive, setScanSessionActive] = useState(false)
  const [showSummary, setShowSummary] = useState(false)
  const [ocrStatus, setOcrStatus] = useState<OcrStatus | null>(null)
  const [failedImages, setFailedImages] = useState<Record<string, boolean>>({})
  const [capturedPhotoUrl, setCapturedPhotoUrl] = useState<string | null>(null)
  const [photoProcessing, setPhotoProcessing] = useState(false)
  const [scanMode, setScanMode] = useState<ScanMode | null>(null)
  const [introMode, setIntroMode] = useState<ScanMode | null>(null)
  const [multiDetections, setMultiDetections] = useState<MultiCardDetection[]>([])
  const [multiUnrecognized, setMultiUnrecognized] = useState(0)
  const [multiConfirmationProgress, setMultiConfirmationProgress] = useState({ current: 0, total: 0 })
  const [summaryDrag, setSummaryDrag] = useState({ active: false, startX: 0, offset: 0 })
  const processingCanvasRef = useRef<HTMLCanvasElement>(null)
  const detectionLoopRef = useRef<number | null>(null)
  const detectionInProgressRef = useRef(false)
  const recognitionStreakRef = useRef<{ cardId: string; count: number } | null>(null)
  const summarySwipeTimerRef = useRef<number | null>(null)
  const scanGenerationRef = useRef(0)
  const scanCooldownUntilRef = useRef(0)
  const lastFocusPulseRef = useRef(0)
  const scanSessionRef = useRef(false)
  const showSummaryRef = useRef(false)
  const pendingRecognitionSignatureRef = useRef<number[] | null>(null)
  const lastConfirmedSignatureRef = useRef<number[] | null>(null)
  const ocrMissStreakRef = useRef(0)
  const candidateImageCacheRef = useRef(new Map<string, Promise<ImageData | null>>())
  const sourceImageSamplesCacheRef = useRef(new WeakMap<HTMLCanvasElement, ImageData[]>())
  const workCanvasesRef = useRef<Record<string, HTMLCanvasElement>>({})
  const manualSearchRunRef = useRef(0)
  const multiSourceCanvasRef = useRef<HTMLCanvasElement | null>(null)
  const multiQueueRef = useRef<MultiRecognitionItem[]>([])
  const currentMultiItemRef = useRef<MultiRecognitionItem | null>(null)
  const multiUsageConfirmedRef = useRef(false)

  const scanCanvasSize = { width: 1080, height: 1440 }

  useEffect(() => {
    const userAgent = navigator.userAgent || ''
    if (/Android/i.test(userAgent)) {
      setCameraDisplayZoom(2.35)
      return
    }
    if (/iPhone|iPad|iPod/i.test(userAgent)) {
      setCameraDisplayZoom(1.12)
      return
    }
    setCameraDisplayZoom(1.08)
  }, [])

  useEffect(() => {
    const checkUser = async () => {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session?.user) {
        router.push('/')
        return
      }
      setUserId(session.user.id)
      void fetch('/api/cards/ocr', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`
        },
        body: JSON.stringify({ warmup: true })
      }).catch(() => undefined)
    }
    checkUser()
  }, [router])

  useEffect(() => {
    const loadOcrStatus = async () => {
      try {
        const res = await fetch('/api/cards/ocr')
        const data = await res.json()
        setOcrStatus(data)

        if (!data?.googleVisionConfigured || !data?.serviceRoleConfigured || data?.error) {
          setRecognitionMessage('Scanner temporaneamente non disponibile.')
        }
      } catch {
        setRecognitionMessage('Impossibile controllare la configurazione Google Vision.')
      }
    }

    loadOcrStatus()
  }, [])

  useEffect(() => {
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
      if (capturedPhotoUrlRef.current) {
        URL.revokeObjectURL(capturedPhotoUrlRef.current)
        capturedPhotoUrlRef.current = null
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
    }, 70)

    return () => {
      if (detectionLoopRef.current) {
        window.clearInterval(detectionLoopRef.current)
        detectionLoopRef.current = null
      }
    }
  }, [cameraActive, cameraReady, ocrReady, scanSessionActive, showSummary, pendingRecognition])

  useEffect(() => {
    if (!cameraActive || !cameraReady || !scanSessionActive || showSummary) return

    const focusTimer = window.setInterval(() => {
      if (!detectionInProgressRef.current && !pendingRecognition) {
        void pulseCameraFocus()
      }
    }, 2600)

    return () => window.clearInterval(focusTimer)
  }, [cameraActive, cameraReady, scanSessionActive, showSummary, pendingRecognition])

  const optimizeCameraTrack = async (stream: MediaStream) => {
    const [track] = stream.getVideoTracks()
    if (!track?.getCapabilities || !track.applyConstraints) return

    try {
      const capabilities = track.getCapabilities() as MediaTrackCapabilities & {
        focusMode?: string[]
        exposureMode?: string[]
        whiteBalanceMode?: string[]
        torch?: boolean
        zoom?: { min?: number; max?: number; step?: number }
      }
      const advanced: Record<string, string | boolean | number>[] = []

      if (capabilities.focusMode?.includes('continuous')) {
        advanced.push({ focusMode: 'continuous' })
      }
      if (capabilities.exposureMode?.includes('continuous')) {
        advanced.push({ exposureMode: 'continuous' })
      }
      if (capabilities.whiteBalanceMode?.includes('continuous')) {
        advanced.push({ whiteBalanceMode: 'continuous' })
      }
      for (const constraint of advanced) {
        try {
          await track.applyConstraints({ advanced: [constraint] } as unknown as MediaTrackConstraints)
        } catch {
          // Mantiene gli altri controlli supportati anche se uno viene rifiutato.
        }
      }
    } catch {
      // Alcuni browser Android espongono le capability ma rifiutano i constraint.
    }
  }

  const pulseCameraFocus = async () => {
    const now = Date.now()
    if (now - lastFocusPulseRef.current < 900) return
    lastFocusPulseRef.current = now

    const [track] = streamRef.current?.getVideoTracks() || []
    if (!track?.getCapabilities || !track.applyConstraints) return

    try {
      const capabilities = track.getCapabilities() as MediaTrackCapabilities & {
        focusMode?: string[]
      }

      const applyFocusMode = async (focusMode: string) => {
        try {
          await track.applyConstraints({
            advanced: [
              { focusMode, pointsOfInterest: [{ x: 0.5, y: 0.5 }] }
            ]
          } as unknown as MediaTrackConstraints)
        } catch {
          await track.applyConstraints({
            advanced: [{ focusMode }]
          } as unknown as MediaTrackConstraints)
        }
      }

      if (capabilities.focusMode?.includes('single-shot')) {
        await applyFocusMode('single-shot')

        if (capabilities.focusMode?.includes('continuous')) {
          window.setTimeout(() => {
            void applyFocusMode('continuous').catch(() => undefined)
          }, 400)
        }
      } else if (capabilities.focusMode?.includes('continuous')) {
        await applyFocusMode('continuous')
      }
    } catch {
      // Android/WebView spesso ignora il fuoco manuale: in quel caso lasciamo continuous.
    }
  }

  const attachStream = async (stream: MediaStream) => {
    if (!videoRef.current) return

    stream = await applyBestCameraResolution(stream)
    await optimizeCameraTrack(stream)

    videoRef.current.srcObject = stream
    videoRef.current.muted = true
    videoRef.current.playsInline = true
    videoRef.current.autoplay = true
    videoRef.current.setAttribute('playsinline', 'true')
    videoRef.current.setAttribute('webkit-playsinline', 'true')

    try {
      await videoRef.current.play()
      await waitForCameraDimensions()
      setVideoSize({
        width: videoRef.current.videoWidth || 1,
        height: videoRef.current.videoHeight || 1
      })
      window.setTimeout(() => void pulseCameraFocus(), 160)
      window.setTimeout(() => void pulseCameraFocus(), 1250)
    } catch {
      videoRef.current.onloadedmetadata = () => {
        setVideoSize({
          width: videoRef.current?.videoWidth || 1,
          height: videoRef.current?.videoHeight || 1
        })
        videoRef.current?.play().catch(() => undefined)
        window.setTimeout(() => void pulseCameraFocus(), 160)
        window.setTimeout(() => void pulseCameraFocus(), 1250)
      }
    }
  }

  const waitForCameraDimensions = async () => {
    const video = videoRef.current
    if (!video) return

    for (let attempt = 0; attempt < 20; attempt += 1) {
      if (video.videoWidth >= 640 && video.videoHeight >= 480) return
      await new Promise(resolve => window.setTimeout(resolve, 80))
    }
  }

  const highQualityVideoConstraints = (extra: MediaTrackConstraints = {}): MediaTrackConstraints => ({
    width: { ideal: 2560, min: 1280 },
    height: { ideal: 1920, min: 720 },
    aspectRatio: { ideal: 4 / 3 },
    frameRate: { ideal: 30, min: 24 },
    resizeMode: 'none',
    ...extra
  } as MediaTrackConstraints)

  const applyBestCameraResolution = async (stream: MediaStream) => {
    const [track] = stream.getVideoTracks()
    if (!track?.getCapabilities || !track.applyConstraints) return stream

    try {
      const capabilities = track.getCapabilities() as MediaTrackCapabilities & {
        width?: { max?: number }
        height?: { max?: number }
        frameRate?: { max?: number }
      }
      const maxWidth = capabilities.width?.max
      const maxHeight = capabilities.height?.max

      if (maxWidth && maxHeight) {
        await track.applyConstraints({
          width: { ideal: Math.min(maxWidth, 2560) },
          height: { ideal: Math.min(maxHeight, 1920) },
          aspectRatio: { ideal: 4 / 3 },
          frameRate: { ideal: Math.min(capabilities.frameRate?.max || 30, 30) }
        } as MediaTrackConstraints)
      }
    } catch {
      // Se il browser rifiuta la risoluzione massima, mantiene la migliore accettata.
    }

    return stream
  }

  const cameraLabelScore = (labelValue: string) => {
    const label = labelValue.toLowerCase()
    const isBack = /(back|rear|environment|posteriore|retro)/i.test(label)
    const isMain = /(main|standard|normal|wide camera|back camera|rear camera|camera 0)/i.test(label)
    const isFront = /(front|user|selfie)/i.test(label)
    const isUltraWide = /(ultra|ultrawide|ultra wide|0\.5|0,5|super wide|grandangolo)/i.test(label)
    const isAuxLens = /(macro|depth|tele|zoom|portrait|bokeh)/i.test(label)
    return (isBack ? 25 : 0) + (isMain ? 8 : 0) - (isFront ? 40 : 0) - (isUltraWide ? 22 : 0) - (isAuxLens ? 14 : 0) + (label ? 1 : 0)
  }

  const getSortedCameraDevices = async () => {
    try {
      const devices = await navigator.mediaDevices.enumerateDevices()
      return devices
        .filter(device => device.kind === 'videoinput' && device.deviceId)
        .sort((a, b) => cameraLabelScore(b.label) - cameraLabelScore(a.label))
    } catch {
      return []
    }
  }

  const getPreferredCameraConstraints = async (): Promise<MediaStreamConstraints[]> => {
    const constraints: MediaStreamConstraints[] = []

    try {
      const videoDevices = await getSortedCameraDevices()

      for (const device of videoDevices) {
        constraints.push({
          video: highQualityVideoConstraints({
            deviceId: { exact: device.deviceId },
            facingMode: { ideal: 'environment' }
          }),
          audio: false
        })
      }
    } catch {
      // enumerateDevices puo essere limitato prima del permesso camera.
    }

    return [
      {
        video: highQualityVideoConstraints({ facingMode: { exact: 'environment' } }),
        audio: false
      },
      {
        video: highQualityVideoConstraints({ facingMode: { ideal: 'environment' } }),
        audio: false
      },
      {
        video: {
          facingMode: { ideal: 'environment' },
          width: { ideal: 1920, min: 960 },
          height: { ideal: 1440, min: 720 },
          aspectRatio: { ideal: 4 / 3 },
          frameRate: { ideal: 30 }
        },
        audio: false
      },
      ...constraints,
      {
        video: {
          facingMode: { ideal: 'environment' },
          width: { ideal: 1280 },
          height: { ideal: 720 },
          frameRate: { ideal: 30 }
        },
        audio: false
      }
    ]
  }

  const upgradeToPreferredCameraIfNeeded = async (stream: MediaStream) => {
    const [currentTrack] = stream.getVideoTracks()
    if (!currentTrack) return stream

    try {
      const currentSettings = currentTrack.getSettings?.() || {}
      const currentScore = cameraLabelScore(currentTrack.label || '')
      const currentWidth = Number(currentSettings.width || 0)
      const devices = await navigator.mediaDevices.enumerateDevices()
      const candidates = devices
        .filter(device => device.kind === 'videoinput' && device.label)
        .map(device => ({ device, score: cameraLabelScore(device.label) }))
        .sort((a, b) => b.score - a.score)

      const best = candidates[0]
      if (!best?.device.deviceId) return stream
      if (best.device.deviceId === currentSettings.deviceId && currentWidth >= 1280) return stream
      if (currentScore >= 0 && currentWidth >= 1280) return stream
      if (best.score <= currentScore + 12 && currentWidth >= 960) return stream

      const upgraded = await navigator.mediaDevices.getUserMedia({
        video: highQualityVideoConstraints({
          deviceId: { exact: best.device.deviceId },
          facingMode: { ideal: 'environment' }
        }),
        audio: false
      })
      stream.getTracks().forEach(track => track.stop())
      return upgraded
    } catch {
      return stream
    }
  }

  const openCameraStream = async () => {
    const constraintsList = await getPreferredCameraConstraints()

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

    stream = await upgradeToPreferredCameraIfNeeded(stream)

    return stream
  }

  const activateCameraStream = async (stream: MediaStream) => {
    streamRef.current = stream
    await attachStream(stream)
    scanGenerationRef.current += 1
    scanCooldownUntilRef.current = Date.now() + 60
    scanSessionRef.current = true
    showSummaryRef.current = false
    setCameraActive(true)
    setCameraReady(true)
    setCameraError(null)
    setScanSessionActive(true)
    setShowSummary(false)
    setPendingRecognition(null)
    pendingRecognitionSignatureRef.current = null
    lastConfirmedSignatureRef.current = null
    ocrMissStreakRef.current = 0
    recognitionStreakRef.current = null
  }

  const normalizeText = (value: string) => value.toLowerCase().replace(/[^a-z0-9]/g, ' ')

  const extractCardCode = parseCardCodeFromText

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
  const baseCardCode = (value: string) => {
    const raw = (value || '').toLowerCase().replace(/[^a-z0-9_]/g, '')
    const withoutUnderscoreVariant = raw.replace(/_[pr]\d+$/i, '')
    return withoutUnderscoreVariant
      .replace(/[^a-z0-9]/g, '')
      .replace(/^((?:op|st|eb|prb|sp|ex|cp)\d{5,6}|p\d{3}|don\d{3})p\d+$/i, '$1')
  }
  const displayCardId = (value?: string | null) =>
    (value || '')
      .replace(/_[pr]\d+$/i, '')
      .replace(/^((?:OP|ST|EB|PRB|SP|EX|CP)\d{2}-\d{3}|P-\d{3}|DON-\d{3})p\d+$/i, '$1')

  const variantLabel = (card: ScannedCard) => {
    const variant = card.card_id.match(/_p(\d+)$/i)?.[1] || card.card_id.match(/(?:OP|ST|EB|PRB|SP|EX|CP)\d{2}-\d{3}p(\d+)$/i)?.[1]
    const rarity = getRarityLabel(card)
    if (rarity && rarity !== 'Common' && rarity !== 'Uncommon' && rarity !== 'Rare') return rarity
    if (variant) return `Alternative Art ${variant}`
    return 'Base'
  }

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

  const shouldShowRecognizedCard = (card: ScannedCard, ocrText: string, trustedMatch = false) => {
    if (trustedMatch || hasExactCodeMatch(ocrText, card) || hasStrongNameMatch(ocrText, card)) {
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
    market_price: null,
    inventory_price: null,
  })

  const referenceLookup = useMemo(() => {
    const entries = referenceCards.map(card => {
      const strongHaystack = [
        card.name,
        card.card_id,
        card.rarity,
        card.card_cost,
        card.card_power,
        card.card_text,
        card.set_name,
        card.sub_types,
        card.card_type,
        card.card_color
      ].filter(Boolean).join(' ')

      return {
        card,
        nameText: normalizeText(card.name || ''),
        compactName: compactText(card.name || ''),
        idText: compactText(card.card_id || card.id || ''),
        nameTokens: splitNameParts(card.name || ''),
        cardTokenSet: new Set(meaningfulTokens(strongHaystack))
      }
    })
    const byBaseCode = new Map<string, ReferenceCard[]>()

    for (const entry of entries) {
      const key = baseCardCode(entry.card.card_id || entry.card.id || '')
      if (!key) continue
      const cards = byBaseCode.get(key) || []
      cards.push(entry.card)
      byBaseCode.set(key, cards)
    }

    return { entries, byBaseCode }
  }, [referenceCards])

  useEffect(() => {
    if (!pendingRecognition?.card_id) {
      setRecognitionVariants([])
      setRecognitionVariantsLoading(false)
      return
    }

    let cancelled = false

    const loadVariants = async () => {
      setRecognitionVariantsLoading(true)
      try {
        const res = await fetch(`/api/cards/search?q=${encodeURIComponent(displayCardId(pendingRecognition.card_id))}`)
        const data = await res.json()
        const variants = (Array.isArray(data) ? data : [])
          .map((card: ReferenceCard) => toScannedCard(card))
          .filter((card: ScannedCard) => baseCardCode(card.card_id) === baseCardCode(pendingRecognition.card_id))

        const seen = new Set<string>()
        const unique = [pendingRecognition, ...variants]
          .filter(card => {
            const key = card.card_id
            if (!key || seen.has(key)) return false
            seen.add(key)
            return true
          })
          .sort((a, b) => {
            const aVariant = /_p\d+$/i.test(a.card_id) ? 1 : 0
            const bVariant = /_p\d+$/i.test(b.card_id) ? 1 : 0
            return aVariant - bVariant || a.card_id.localeCompare(b.card_id)
          })

        if (!cancelled) {
          setRecognitionVariants(unique)
          if (unique.length <= 1) setVariantChoiceRequired(false)
        }
      } catch {
        if (!cancelled) setRecognitionVariants([pendingRecognition])
      } finally {
        if (!cancelled) setRecognitionVariantsLoading(false)
      }
    }

    loadVariants()

    return () => {
      cancelled = true
    }
  }, [pendingRecognition?.card_id])

  const findBestReferenceMatch = async (ocrText: string, cropCanvas: HTMLCanvasElement) => {
    const cardCode = extractCardCode(ocrText)
    const normalizedOcr = normalizeText(ocrText)
    const ocrTokens = meaningfulTokens(ocrText)

    if (cardCode) {
      const exactMatches = referenceLookup.byBaseCode.get(baseCardCode(cardCode)) || []
      if (exactMatches.length === 1) return toScannedCard(exactMatches[0])

      if (exactMatches.length > 1) {
        const compactOcr = compactText(ocrText)
        const textRanked = exactMatches
          .map((card, index) => {
            const id = compactText(card.card_id || card.id || '')
            const name = compactText(card.name || '')
            const isVariant = /(_p\d+|parallel|alternate|alt|special|manga|treasure)/i.test(String(card.card_id || card.id || card.rarity || card.name || ''))
            let score = -index * 0.001

            if (id && compactOcr.includes(id)) score += 70
            if (name && compactOcr.includes(name)) score += 18
            if (isVariant && /(parallel|alternate|alternative|alt art|special|manga|treasure)/i.test(ocrText)) score += 24

            return { card, score }
          })
          .sort((a, b) => b.score - a.score)

        // Il codice identifica subito la carta. La variante grafica viene affinata
        // in parallelo dopo aver mostrato il risultato, senza bloccare lo scanner.
        return toScannedCard(textRanked[0].card)
      }
    }

    if (ocrTokens.length < 1) return null

    const scored = referenceLookup.entries
      .map(entry => {
        const { card, nameText, compactName, idText, nameTokens, cardTokenSet } = entry
        const compactOcr = compactText(ocrText)

        let score = 0
        let identityScore = 0
        if (idText && compactOcr.includes(idText)) identityScore += 28
        if (compactName && compactOcr.includes(compactName)) identityScore += 18
        if (nameText && normalizedOcr.includes(nameText)) identityScore += 12

        for (const token of ocrTokens) {
          if (cardTokenSet.has(token)) score += nameText.includes(token) ? 1 : 1.5
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

  const getWorkCanvas = (key: string, width: number, height: number) => {
    let canvas = workCanvasesRef.current[key]
    if (!canvas) {
      canvas = document.createElement('canvas')
      workCanvasesRef.current[key] = canvas
    }
    if (canvas.width !== width) canvas.width = width
    if (canvas.height !== height) canvas.height = height
    canvas.getContext('2d')?.clearRect(0, 0, width, height)
    return canvas
  }

  const canvasToImage = (canvas: HTMLCanvasElement) => canvas.toDataURL('image/jpeg', 0.9)

  const frameSignatureFromCanvas = (canvas: HTMLCanvasElement, rect?: { x: number; y: number; width: number; height: number }) => {
    const ctx = canvas.getContext('2d')
    if (!ctx) return null

    const area = rect || { x: 0, y: 0, width: canvas.width, height: canvas.height }
    const cols = 6
    const rows = 8
    const signature: number[] = []

    for (let row = 0; row < rows; row += 1) {
      for (let col = 0; col < cols; col += 1) {
        const x = Math.max(0, Math.min(canvas.width - 1, Math.floor(area.x + ((col + 0.5) / cols) * area.width)))
        const y = Math.max(0, Math.min(canvas.height - 1, Math.floor(area.y + ((row + 0.5) / rows) * area.height)))
        const pixel = ctx.getImageData(x, y, 1, 1).data
        signature.push(Math.round(pixel[0] * 0.299 + pixel[1] * 0.587 + pixel[2] * 0.114))
      }
    }

    return signature
  }

  const getVideoSourceRect = (videoWidth: number, videoHeight: number, targetAspect: number) => {
    const sourceAspect = videoWidth / videoHeight
    let x = 0
    let y = 0
    let width = videoWidth
    let height = videoHeight

    if (sourceAspect > targetAspect) {
      width = videoHeight * targetAspect
      x = (videoWidth - width) / 2
    } else {
      height = videoWidth / targetAspect
      y = (videoHeight - height) / 2
    }

    const zoomedWidth = width / cameraDisplayZoom
    const zoomedHeight = height / cameraDisplayZoom
    return {
      x: x + (width - zoomedWidth) / 2,
      y: y + (height - zoomedHeight) / 2,
      width: zoomedWidth,
      height: zoomedHeight
    }
  }

  const frameSignatureFromVideo = () => {
    const video = videoRef.current
    if (!video || video.videoWidth === 0 || video.videoHeight === 0) return null

    const signatureCanvas = document.createElement('canvas')
    signatureCanvas.width = 90
    signatureCanvas.height = 120
    const ctx = signatureCanvas.getContext('2d')
    if (!ctx) return null

    const source = getVideoSourceRect(
      video.videoWidth,
      video.videoHeight,
      signatureCanvas.width / signatureCanvas.height
    )

    ctx.drawImage(video, source.x, source.y, source.width, source.height, 0, 0, signatureCanvas.width, signatureCanvas.height)
    return frameSignatureFromCanvas(signatureCanvas, {
      x: signatureCanvas.width * 0.08,
      y: signatureCanvas.height * 0.08,
      width: signatureCanvas.width * 0.84,
      height: signatureCanvas.height * 0.84
    })
  }

  const signatureDistance = (a?: number[] | null, b?: number[] | null) => {
    if (!a || !b || a.length !== b.length) return Number.POSITIVE_INFINITY
    return a.reduce((sum, value, index) => sum + Math.abs(value - b[index]), 0) / a.length
  }

  const isCapturedFrameStillLive = (capturedSignature?: number[] | null, threshold = 24) => {
    if (!capturedSignature) return true
    const currentSignature = frameSignatureFromVideo()
    if (!currentSignature) return true
    return signatureDistance(capturedSignature, currentSignature) < threshold
  }

  const runOcrOnCanvases = async (canvases: HTMLCanvasElement[], mode: 'fast' | 'accurate' | 'photo') => {
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const res = await fetch('/api/cards/ocr', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: session?.access_token ? `Bearer ${session.access_token}` : ''
        },
        body: JSON.stringify({ images: canvases.map(canvasToImage), mode })
      })
      const data = await res.json()

      if (!res.ok) {
        if (data?.dailyScanLimitReached) {
          setRecognitionMessage(`Limite giornaliero free raggiunto: ${data.dailyScansUsed}/${data.dailyScansLimit} scan. Premium sblocca scan illimitate.`)
        } else if (data?.scanLimitReached) {
          setRecognitionMessage(`Limite mensile globale raggiunto: ${data.scansUsed}/${data.scansLimit} scansioni.`)
        } else if (data?.googleStatus === 429) {
          setRecognitionMessage('Google Vision è temporaneamente occupato. Riprova tra pochi secondi.')
        } else if (data?.error) {
          setRecognitionMessage('Scanner temporaneamente non disponibile. Riprova tra pochi secondi.')
        }
        return null
      }

      return typeof data?.text === 'string' ? data.text : ''
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
        market_price: price.marketPrice ?? price.midPrice ?? price.directLowPrice ?? price.lowPrice ?? card.market_price ?? null,
        inventory_price: null,
        image_url: card.image_url || price.productImageUrl || null,
        price_source: price.source || 'Prezzo Medio',
        price_url: price.productUrl || null,
        price_updated_at: price.modifiedOn || null
      }
    } catch {
      return card
    }
  }

  const enrichPendingPriceInBackground = (card: ScannedCard, generation: number) => {
    void enrichCardWithLivePrice(card).then(pricedCard => {
      if (!isScanStillActive(generation)) return
      setPendingRecognition(current => {
        if (!current || current.card_id !== card.card_id) return current
        return {
          ...current,
          market_price: pricedCard.market_price,
          inventory_price: pricedCard.inventory_price,
          price_source: pricedCard.price_source,
          price_url: pricedCard.price_url,
          price_updated_at: pricedCard.price_updated_at,
          image_url: current.image_url || pricedCard.image_url
        }
      })
    })
  }

  const selectRecognitionVariant = async (variant: ScannedCard) => {
    if (pendingRecognition?.card_id === variant.card_id) {
      setVariantChoiceRequired(false)
      setRecognitionMessage(`Variante confermata: ${variantLabel(variant)}.`)
      return
    }

    setVariantChoiceRequired(false)
    setRecognitionMessage(`Variante selezionata: ${variantLabel(variant)}. Recupero prezzo medio...`)
    const pricedVariant = await enrichCardWithLivePrice({
      ...variant,
      id: pendingRecognition?.id || variant.id
    })
    setPendingRecognition(pricedVariant)
    setRecognitionMessage(`Carta trovata: ${pricedVariant.name}. Conferma o scarta.`)
  }

  const compareImageToCandidate = async (
    sourceCanvas: HTMLCanvasElement,
    candidateUrl: string,
    contourDetected = false
  ) => {
    try {
      const sampleWidth = 84
      const sampleHeight = 118
      const targetAspect = sampleWidth / sampleHeight
      const sourceAspect = sourceCanvas.width / sourceCanvas.height
      const baseWidth = sourceAspect > targetAspect
        ? sourceCanvas.height * targetAspect
        : sourceCanvas.width
      const baseHeight = sourceAspect > targetAspect
        ? sourceCanvas.height
        : sourceCanvas.width / targetAspect
      let sourceSamples = sourceImageSamplesCacheRef.current.get(sourceCanvas)
      if (!sourceSamples) {
        sourceSamples = []

        const scales = contourDetected
          ? [1, 0.94, 0.88]
          : [1, 0.86, 0.72, 0.58, 0.46, 0.36, 0.28]
        for (const scale of scales) {
          const cropWidth = baseWidth * scale
          const cropHeight = baseHeight * scale
          const offsets = contourDetected
            ? [-0.03, 0, 0.03]
            : scale >= 0.58
              ? [-0.06, 0, 0.06]
              : [-0.14, -0.07, 0, 0.07, 0.14]
          for (const offsetX of offsets) {
            for (const offsetY of offsets) {
              const sourceSample = document.createElement('canvas')
              sourceSample.width = sampleWidth
              sourceSample.height = sampleHeight
              const sourceCtx = sourceSample.getContext('2d')
              if (!sourceCtx) continue

              const centerX = sourceCanvas.width / 2 + sourceCanvas.width * offsetX
              const centerY = sourceCanvas.height / 2 + sourceCanvas.height * offsetY
              const sourceX = Math.max(0, Math.min(sourceCanvas.width - cropWidth, centerX - cropWidth / 2))
              const sourceY = Math.max(0, Math.min(sourceCanvas.height - cropHeight, centerY - cropHeight / 2))
              sourceCtx.drawImage(
                sourceCanvas,
                sourceX,
                sourceY,
                cropWidth,
                cropHeight,
                0,
                0,
                sampleWidth,
                sampleHeight
              )
              sourceSamples.push(sourceCtx.getImageData(0, 0, sampleWidth, sampleHeight))
            }
          }
        }

        sourceImageSamplesCacheRef.current.set(sourceCanvas, sourceSamples)
      }

      let candidatePromise = candidateImageCacheRef.current.get(candidateUrl)
      if (!candidatePromise) {
        candidatePromise = new Promise<ImageData | null>((resolve) => {
          const image = new Image()
          image.decoding = 'async'
          image.onload = () => {
            const candidateCanvas = document.createElement('canvas')
            candidateCanvas.width = sampleWidth
            candidateCanvas.height = sampleHeight
            const ctx = candidateCanvas.getContext('2d')
            if (!ctx) {
              resolve(null)
              return
            }
            ctx.drawImage(image, 0, 0, sampleWidth, sampleHeight)
            resolve(ctx.getImageData(0, 0, sampleWidth, sampleHeight))
          }
          image.onerror = () => resolve(null)
          image.src = `/api/cards/recognition-image?url=${encodeURIComponent(candidateUrl)}`
        })
        candidateImageCacheRef.current.set(candidateUrl, candidatePromise)
      }

      const candidateData = await candidatePromise
      if (!candidateData || sourceSamples.length === 0) return Number.POSITIVE_INFINITY

      const channelMeans = (data: Uint8ClampedArray) => {
        const means = [0, 0, 0]
        const pixels = data.length / 4
        for (let i = 0; i < data.length; i += 4) {
          means[0] += data[i]
          means[1] += data[i + 1]
          means[2] += data[i + 2]
        }
        return means.map(value => value / pixels)
      }
      const candidateMeans = channelMeans(candidateData.data)

      return sourceSamples.reduce((bestScore, sourceData) => {
        const sourceMeans = channelMeans(sourceData.data)
        const regionDiff = (xRatio: number, yRatio: number, widthRatio: number, heightRatio: number) => {
          const startX = Math.max(0, Math.floor(sampleWidth * xRatio))
          const startY = Math.max(0, Math.floor(sampleHeight * yRatio))
          const endX = Math.min(sampleWidth, Math.floor(startX + sampleWidth * widthRatio))
          const endY = Math.min(sampleHeight, Math.floor(startY + sampleHeight * heightRatio))
          let diff = 0
          let count = 0

          for (let y = startY; y < endY; y += 1) {
            for (let x = startX; x < endX; x += 1) {
              const i = (y * sampleWidth + x) * 4
              for (let channel = 0; channel < 3; channel += 1) {
                const normalizedSource = sourceData.data[i + channel] - sourceMeans[channel]
                const normalizedCandidate = candidateData.data[i + channel] - candidateMeans[channel]
                const structureDiff = Math.abs(normalizedSource - normalizedCandidate)
                const rawDiff = Math.abs(sourceData.data[i + channel] - candidateData.data[i + channel])
                diff += structureDiff * 0.88 + rawDiff * 0.12
              }
              count += 1
            }
          }

          return count > 0 ? diff / (count * 3) : Number.POSITIVE_INFINITY
        }

        const fullCard = regionDiff(0, 0, 1, 1)
        const artBox = regionDiff(0.07, 0.08, 0.86, 0.54)
        const lowerBox = regionDiff(0.07, 0.58, 0.86, 0.3)
        const score = fullCard * 0.2 + artBox * 0.62 + lowerBox * 0.18
        return Math.min(bestScore, score)
      }, Number.POSITIVE_INFINITY)
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
              market_price: null,
              inventory_price: null,
            },
            score
          }
        }
      }

      return bestMatch && bestMatch.score > 2.2 ? bestMatch.card : null
    } catch {
      return null
    }
  }

  const runOcrOnSheet = async (canvas: HTMLCanvasElement, regions: OcrSheetRegion[]) => {
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const res = await fetch('/api/cards/ocr', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: session?.access_token ? `Bearer ${session.access_token}` : ''
        },
        body: JSON.stringify({
          images: [canvas.toDataURL('image/jpeg', 0.82)],
          mode: 'photo',
          regions,
        })
      })
      const data = await res.json()

      if (!res.ok) {
        if (data?.dailyScanLimitReached) {
          setRecognitionMessage(`Limite giornaliero free raggiunto: ${data.dailyScansUsed}/${data.dailyScansLimit} scan.`)
        } else if (data?.scanLimitReached) {
          setRecognitionMessage(`Limite mensile globale raggiunto: ${data.scansUsed}/${data.scansLimit} scansioni.`)
        } else if (data?.googleStatus === 429) {
          setRecognitionMessage('Google Vision è temporaneamente occupato. Riprova tra pochi secondi.')
        } else {
          setRecognitionMessage('Scanner temporaneamente non disponibile. Riprova tra pochi secondi.')
        }
        return null
      }

      const texts = new Map<string, string>()
      let sourceWords: OcrPositionedWord[] = []
      for (const region of Array.isArray(data?.regionTexts) ? data.regionTexts : []) {
        const regionId = String(region?.id || '')
        texts.set(regionId, String(region?.text || ''))
        if (regionId === 'source' && Array.isArray(region?.words)) {
          sourceWords = region.words
            .map((word: OcrPositionedWord) => ({
              text: String(word?.text || ''),
              x: Number(word?.x),
              y: Number(word?.y),
              width: Number(word?.width),
              height: Number(word?.height),
            }))
            .filter((word: OcrPositionedWord) =>
              word.text.length > 0 &&
              Number.isFinite(word.x) &&
              Number.isFinite(word.y)
            )
        }
      }
      return { texts, sourceWords }
    } catch {
      setRecognitionMessage('OCR non raggiungibile. Controlla la connessione e riprova.')
      return null
    }
  }

  const clearCapturedPhoto = () => {
    if (capturedPhotoUrlRef.current) {
      URL.revokeObjectURL(capturedPhotoUrlRef.current)
      capturedPhotoUrlRef.current = null
    }
    setCapturedPhotoUrl(null)
    if (photoInputRef.current) photoInputRef.current.value = ''
  }

  const resetMultiScan = () => {
    multiSourceCanvasRef.current = null
    multiQueueRef.current = []
    currentMultiItemRef.current = null
    multiUsageConfirmedRef.current = false
    setMultiDetections([])
    setMultiUnrecognized(0)
    setMultiConfirmationProgress({ current: 0, total: 0 })
  }

  const selectScanMode = (mode: ScanMode) => {
    scanGenerationRef.current += 1
    clearCapturedPhoto()
    resetMultiScan()
    setPendingRecognition(null)
    setVariantChoiceRequired(false)
    setCameraError(null)
    setPhotoProcessing(false)
    setScanMode(mode)
    setRecognitionMessage(
      mode === 'single'
        ? 'Scatta una foto nitida mostrando una sola carta.'
        : 'Scatta una foto dall’alto: troverò automaticamente tutte le carte visibili.'
    )

    const introKey = `opv-scan-intro-${mode}-v1`
    if (window.localStorage.getItem(introKey) !== 'seen') setIntroMode(mode)
  }

  const closeScanIntro = () => {
    if (introMode) window.localStorage.setItem(`opv-scan-intro-${introMode}-v1`, 'seen')
    setIntroMode(null)
  }

  const loadPhotoCanvas = async (file: File, maxDimension = 2200) => {
    let source: CanvasImageSource
    let sourceWidth = 0
    let sourceHeight = 0
    let cleanup: () => void = () => undefined

    if ('createImageBitmap' in window) {
      const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' })
      source = bitmap
      sourceWidth = bitmap.width
      sourceHeight = bitmap.height
      cleanup = () => bitmap.close()
    } else {
      const objectUrl = URL.createObjectURL(file)
      const image = await new Promise<HTMLImageElement>((resolve, reject) => {
        const element = new Image()
        element.onload = () => resolve(element)
        element.onerror = () => reject(new Error('Immagine non leggibile'))
        element.src = objectUrl
      })
      source = image
      sourceWidth = image.naturalWidth
      sourceHeight = image.naturalHeight
      cleanup = () => URL.revokeObjectURL(objectUrl)
    }

    const scale = Math.min(1, maxDimension / Math.max(sourceWidth, sourceHeight))
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(sourceWidth * scale))
    canvas.height = Math.max(1, Math.round(sourceHeight * scale))
    const context = canvas.getContext('2d')
    if (!context) {
      cleanup()
      throw new Error('Canvas non disponibile')
    }

    context.imageSmoothingEnabled = true
    context.imageSmoothingQuality = 'high'
    context.drawImage(source, 0, 0, canvas.width, canvas.height)
    cleanup()
    return canvas
  }

  const detectPhotoCardRect = (sourceCanvas: HTMLCanvasElement) => {
    const maximumDimension = 360
    const scale = Math.min(1, maximumDimension / Math.max(sourceCanvas.width, sourceCanvas.height))
    const workCanvas = document.createElement('canvas')
    workCanvas.width = Math.max(1, Math.round(sourceCanvas.width * scale))
    workCanvas.height = Math.max(1, Math.round(sourceCanvas.height * scale))
    const context = workCanvas.getContext('2d')
    if (!context) return null

    context.drawImage(sourceCanvas, 0, 0, workCanvas.width, workCanvas.height)
    const pixels = context.getImageData(0, 0, workCanvas.width, workCanvas.height).data
    const luminance = new Float32Array(workCanvas.width * workCanvas.height)
    for (let index = 0; index < luminance.length; index += 1) {
      const pixel = index * 4
      luminance[index] = pixels[pixel] * 0.299 + pixels[pixel + 1] * 0.587 + pixels[pixel + 2] * 0.114
    }

    const valueAt = (x: number, y: number) =>
      luminance[Math.max(0, Math.min(workCanvas.height - 1, y)) * workCanvas.width + Math.max(0, Math.min(workCanvas.width - 1, x))]
    const contrast = (first: number, second: number) => Math.abs(first - second)
    const heightRatios = [0.24, 0.28, 0.32, 0.36, 0.4, 0.46, 0.52, 0.6, 0.68, 0.78, 0.9]
    const centerRatios = [0.32, 0.38, 0.44, 0.5, 0.56, 0.62, 0.68]
    let best: { score: number; x: number; y: number; width: number; height: number } | null = null

    for (const heightRatio of heightRatios) {
      const height = workCanvas.height * heightRatio
      for (const aspect of [0.66, 0.714, 0.77]) {
        const width = height * aspect
        if (width > workCanvas.width * 0.96) continue

        for (const centerXRatio of centerRatios) {
          for (const centerYRatio of centerRatios) {
            const x = Math.round(workCanvas.width * centerXRatio - width / 2)
            const y = Math.round(workCanvas.height * centerYRatio - height / 2)
            const right = Math.round(x + width)
            const bottom = Math.round(y + height)
            const gap = 3
            if (x < gap || y < gap || right >= workCanvas.width - gap || bottom >= workCanvas.height - gap) continue

            let top = 0
            let lower = 0
            let left = 0
            let rightSide = 0
            const horizontalSamples = 36
            const verticalSamples = 48

            for (let sample = 0; sample < horizontalSamples; sample += 1) {
              const sampleX = Math.round(x + gap + ((sample + 0.5) / horizontalSamples) * Math.max(1, width - gap * 2))
              top += contrast(valueAt(sampleX, y - gap), valueAt(sampleX, y + gap))
              lower += contrast(valueAt(sampleX, bottom - gap), valueAt(sampleX, bottom + gap))
            }
            for (let sample = 0; sample < verticalSamples; sample += 1) {
              const sampleY = Math.round(y + gap + ((sample + 0.5) / verticalSamples) * Math.max(1, height - gap * 2))
              left += contrast(valueAt(x - gap, sampleY), valueAt(x + gap, sampleY))
              rightSide += contrast(valueAt(right - gap, sampleY), valueAt(right + gap, sampleY))
            }

            const sides = [
              top / horizontalSamples,
              lower / horizontalSamples,
              left / verticalSamples,
              rightSide / verticalSamples
            ]
            const sideAverage = sides.reduce((sum, value) => sum + value, 0) / sides.length
            const score = Math.min(...sides) * 0.55 + sideAverage * 0.45
            if (!best || score > best.score) best = { score, x, y, width, height }
          }
        }
      }
    }

    if (!best || best.score < 12) return null
    const expansion = 0.06
    const expandedWidth = best.width * (1 + expansion * 2)
    const expandedHeight = best.height * (1 + expansion * 2)
    const x = Math.max(0, best.x - best.width * expansion)
    const y = Math.max(0, best.y - best.height * expansion)

    return {
      x: x / scale,
      y: y / scale,
      width: Math.min(workCanvas.width - x, expandedWidth) / scale,
      height: Math.min(workCanvas.height - y, expandedHeight) / scale
    }
  }

  const cropPhotoCard = (
    sourceCanvas: HTMLCanvasElement,
    rect: { x: number; y: number; width: number; height: number }
  ) => {
    const canvas = document.createElement('canvas')
    canvas.width = 1000
    canvas.height = 1400
    const context = canvas.getContext('2d')
    if (!context) return sourceCanvas
    context.imageSmoothingEnabled = true
    context.imageSmoothingQuality = 'high'
    context.drawImage(sourceCanvas, rect.x, rect.y, rect.width, rect.height, 0, 0, canvas.width, canvas.height)
    return canvas
  }

  const buildPhotoOcrCanvas = (
    sourceCanvas: HTMLCanvasElement,
    detectedRect: { x: number; y: number; width: number; height: number } | null
  ) => {
    const canvas = document.createElement('canvas')
    canvas.width = 1600
    canvas.height = detectedRect ? 4000 : 3600
    const context = canvas.getContext('2d')
    if (!context) return sourceCanvas

    context.fillStyle = '#ffffff'
    context.fillRect(0, 0, canvas.width, canvas.height)
    context.imageSmoothingEnabled = true
    context.imageSmoothingQuality = 'high'

    const fullAreaHeight = detectedRect ? 500 : 700
    const fullScale = Math.min(1500 / sourceCanvas.width, (fullAreaHeight - 20) / sourceCanvas.height)
    const fullWidth = sourceCanvas.width * fullScale
    const fullHeight = sourceCanvas.height * fullScale
    context.drawImage(
      sourceCanvas,
      (canvas.width - fullWidth) / 2,
      (fullAreaHeight - fullHeight) / 2,
      fullWidth,
      fullHeight
    )

    const cardAspect = 5 / 7
    const sourceAspect = sourceCanvas.width / sourceCanvas.height
    const baseWidth = sourceAspect > cardAspect ? sourceCanvas.height * cardAspect : sourceCanvas.width
    const baseHeight = sourceAspect > cardAspect ? sourceCanvas.height : sourceCanvas.width / cardAspect
    const cropForScale = (scale: number) => {
      const width = baseWidth * scale
      const height = baseHeight * scale
      return {
        x: (sourceCanvas.width - width) / 2,
        y: (sourceCanvas.height - height) / 2,
        width,
        height
      }
    }
    const drawCardCrop = (scale: number, x: number, y: number, width: number, height: number) => {
      const crop = cropForScale(scale)
      context.drawImage(sourceCanvas, crop.x, crop.y, crop.width, crop.height, x, y, width, height)
    }

    if (detectedRect) {
      context.drawImage(
        sourceCanvas,
        detectedRect.x,
        detectedRect.y,
        detectedRect.width,
        detectedRect.height,
        350,
        520,
        900,
        1260
      )
      context.filter = 'contrast(1.22) saturate(0.78)'
      context.drawImage(
        sourceCanvas,
        detectedRect.x,
        detectedRect.y + detectedRect.height * 0.7,
        detectedRect.width,
        detectedRect.height * 0.3,
        40,
        1820,
        1520,
        640
      )
      context.drawImage(
        sourceCanvas,
        detectedRect.x,
        detectedRect.y,
        detectedRect.width,
        detectedRect.height * 0.25,
        40,
        2500,
        1520,
        510
      )
      context.drawImage(
        sourceCanvas,
        detectedRect.x,
        detectedRect.y + detectedRect.height * 0.36,
        detectedRect.width,
        detectedRect.height * 0.38,
        40,
        3050,
        1520,
        810
      )
    } else {
      drawCardCrop(0.92, 40, 740, 720, 1008)
      drawCardCrop(0.4, 840, 740, 720, 1008)
      drawCardCrop(0.66, 440, 1790, 720, 1008)

      context.filter = 'contrast(1.18) saturate(0.82)'
      const closeCrop = cropForScale(0.4)
      context.drawImage(
        sourceCanvas,
        closeCrop.x,
        closeCrop.y + closeCrop.height * 0.43,
        closeCrop.width,
        closeCrop.height * 0.57,
        40,
        2840,
        1520,
        700
      )
    }
    context.filter = 'none'
    return canvas
  }

  const uniqueCards = (cards: ReferenceCard[]) => {
    const seen = new Set<string>()
    return cards.filter(card => {
      const key = String(card.card_id || card.id || '')
      if (!key || seen.has(key)) return false
      seen.add(key)
      return true
    })
  }

  const findVisibleTextCandidates = async (ocrText: string) => {
    try {
      const res = await fetch('/api/cards/recognize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: ocrText, mode: 'photo' })
      })
      const data = await res.json()
      return {
        candidates: uniqueCards(Array.isArray(data?.candidates) ? data.candidates : []),
        textMatch: data?.textMatch && typeof data.textMatch === 'object'
          ? data.textMatch as VisibleTextDecision
          : null
      }
    } catch {
      return { candidates: [], textMatch: null }
    }
  }

  const verifyPhotoCandidates = async (
    candidates: ReferenceCard[],
    sourceCanvas: HTMLCanvasElement,
    contourDetected: boolean
  ) => {
    const ranked = (await Promise.all(uniqueCards(candidates)
      .filter(card => card.image_url || card.card_image)
      .slice(0, 64)
      .map(async card => ({
      card,
      distance: await compareImageToCandidate(
        sourceCanvas,
        card.image_url || card.card_image || '',
        contourDetected
      )
    }))))
      .filter(item => Number.isFinite(item.distance))
      .sort((a, b) => a.distance - b.distance)

    const best = ranked[0]
    const second = ranked[1]
    if (!best || best.distance > (contourDetected ? 57 : 54)) return null

    const bestFamily = baseCardCode(best.card.card_id || best.card.id || '')
    const secondFamily = second ? baseCardCode(second.card.card_id || second.card.id || '') : ''
    if (second && secondFamily !== bestFamily && second.distance - best.distance < 2.5) return null

    return {
      card: toScannedCard(best.card),
      ambiguousVariant: Boolean(second && secondFamily === bestFamily && second.distance - best.distance < 3),
      distance: best.distance
    }
  }

  const multiTextQuality = (value: string) => {
    const normalized = value.replace(/\s+/g, ' ').trim()
    const tokens = normalized.split(' ').filter(token => token.length >= 2)
    const anchors = normalized.match(/\b(counter|trigger|character|leader|event|stage|power|cost|activate|main|on play)\b/gi)?.length || 0
    const numeric = normalized.match(/\b\d{1,5}\b/g)?.length || 0
    return tokens.length + anchors * 8 + numeric * 2 + Math.min(40, normalized.length / 18)
  }

  const recognizeMultiDetection = async (
    detection: MultiCardDetection,
    index: number,
    regionTexts: Map<string, string>
  ): Promise<MultiRecognitionItem | null> => {
    const rotatedCrop = document.createElement('canvas')
    rotatedCrop.width = detection.crop.width
    rotatedCrop.height = detection.crop.height
    const rotatedContext = rotatedCrop.getContext('2d')
    if (rotatedContext) {
      rotatedContext.translate(rotatedCrop.width, rotatedCrop.height)
      rotatedContext.rotate(Math.PI)
      rotatedContext.drawImage(detection.crop, 0, 0)
    }

    const orientations = (detection.ocrText
      ? [{ text: detection.ocrText, crop: detection.crop }]
      : [
          { text: regionTexts.get(`${index}:0`) || '', crop: detection.crop },
          { text: regionTexts.get(`${index}:180`) || '', crop: rotatedCrop },
        ]
    ).sort((first, second) => multiTextQuality(second.text) - multiTextQuality(first.text))

    for (const orientation of orientations) {
      if (!orientation.text.trim()) continue
      const { candidates, textMatch } = await findVisibleTextCandidates(orientation.text)
      if (candidates.length === 0) continue

      const textMatchIsStrong = Boolean(textMatch && (
        textMatch.decisive ||
        candidates.length === 1 ||
        (
          textMatch.exactName &&
          textMatch.scoreGap >= 10 &&
          (
            textMatch.powerMatch ||
            (textMatch.costMatch && textMatch.effectMatches >= 1) ||
            textMatch.effectMatches >= 3 ||
            (
              !textMatch.hasEffect &&
              textMatch.powerMatch &&
              (
                textMatch.costMatch ||
                textMatch.counterMatch ||
                textMatch.metadataMatches >= 1
              )
            )
          )
        )
      ))

      if (textMatchIsStrong && textMatch) {
        const familyCandidates = candidates.filter(card =>
          baseCardCode(card.card_id || card.id || '') === textMatch.family
        )
        const textCard = familyCandidates.find(card => card.card_id === textMatch.cardId) || familyCandidates[0]
        if (textCard) {
          return {
            card: toScannedCard(textCard),
            text: orientation.text,
            crop: orientation.crop,
          }
        }
      }

      const verificationLimit = textMatch && !textMatch.hasEffect
        ? 20
        : textMatch?.exactName
          ? 10
          : 16
      const verified = await verifyPhotoCandidates(
        candidates.slice(0, verificationLimit),
        orientation.crop,
        true
      )
      if (!verified) continue
      const verifiedFamily = baseCardCode(verified.card.card_id)
      const familyCard = candidates.find(card =>
        baseCardCode(card.card_id || card.id || '') === verifiedFamily && !/_p\d+$/i.test(card.card_id)
      )
      return {
        card: familyCard ? toScannedCard(familyCard) : verified.card,
        text: orientation.text,
        crop: orientation.crop,
      }
    }

    return null
  }

  const presentMultiRecognition = (item: MultiRecognitionItem, generation: number) => {
    currentMultiItemRef.current = item
    const total = multiConfirmationProgress.total || multiQueueRef.current.length + 1
    const current = total - multiQueueRef.current.length
    setMultiConfirmationProgress({ current, total })
    setPendingRecognition(item.card)
    setRecognitionQuantity(1)
    setVariantChoiceRequired(true)
    setRecognitionMessage(`Carta ${current} di ${total}: controlla la variante e conferma.`)
    enrichPendingPriceInBackground(item.card, generation)
    refineRecognitionVariant(item.text, item.crop, generation, item.card)
  }

  const advanceMultiRecognition = () => {
    const next = multiQueueRef.current.shift() || null
    if (next) {
      presentMultiRecognition(next, scanGenerationRef.current)
      return
    }

    currentMultiItemRef.current = null
    setPendingRecognition(null)
    setVariantChoiceRequired(false)
    clearCapturedPhoto()
    multiSourceCanvasRef.current = null
    setMultiDetections([])
    setRecognitionMessage(
      multiUnrecognized > 0
        ? `Foto completata. ${multiUnrecognized} carte non erano abbastanza leggibili.`
        : 'Foto completata. Puoi scattare un altro gruppo o vedere i risultati.'
    )
  }

  const processMultiPhoto = async (file: File) => {
    scanGenerationRef.current += 1
    const generation = scanGenerationRef.current
    scanSessionRef.current = true
    showSummaryRef.current = false
    multiUsageConfirmedRef.current = false
    multiQueueRef.current = []
    currentMultiItemRef.current = null
    setScanSessionActive(true)
    setShowSummary(false)
    setPendingRecognition(null)
    setVariantChoiceRequired(false)
    setMultiDetections([])
    setMultiUnrecognized(0)
    setMultiConfirmationProgress({ current: 0, total: 0 })
    setCameraError(null)
    setPhotoProcessing(true)
    setRecognitionMessage('Cerco i bordi e la posizione di ogni carta...')

    try {
      const photoCanvas = await loadPhotoCanvas(file, 3400)
      if (!isScanStillActive(generation)) return
      multiSourceCanvasRef.current = photoCanvas

      const detections = await detectCardsInPhoto(photoCanvas, 12)
      if (!isScanStillActive(generation)) return
      setMultiDetections(detections)
      await analyzeMultiDetections(photoCanvas, detections, generation)
    } catch (error) {
      console.error('Multi-card detection error:', error)
      setCameraError('Non sono riuscito ad analizzare questa foto. Riprova con più luce e tutte le carte visibili.')
      setRecognitionMessage('Pronto per un nuovo scatto.')
    } finally {
      if (scanGenerationRef.current === generation) setPhotoProcessing(false)
    }
  }

  const analyzeMultiDetections = async (
    sourceCanvas: HTMLCanvasElement,
    initialDetections: MultiCardDetection[],
    generation: number
  ) => {
    if (!isScanStillActive(generation)) return
    scanSessionRef.current = true
    showSummaryRef.current = false
    setPhotoProcessing(true)
    setCameraError(null)
    setRecognitionMessage('Leggo l’intera foto con una sola scansione Google Vision...')

    try {
      const { canvas, regions } = buildMultiCardOcrSheet(initialDetections, sourceCanvas)
      const ocrResult = await runOcrOnSheet(canvas, regions)
      if (!isScanStillActive(generation) || !ocrResult) return

      const textBackedDetections = initialDetections.filter((_, index) => {
        const upright = ocrResult.texts.get(`${index}:0`) || ''
        const rotated = ocrResult.texts.get(`${index}:180`) || ''
        return Math.max(multiTextQuality(upright), multiTextQuality(rotated)) >= 12
      })
      const inferred = await inferCardsFromOcrLayout(sourceCanvas, ocrResult.sourceWords, 12)
      const shouldUseOcrLayout =
        inferred.confidence >= 0.72 &&
        inferred.detections.length > textBackedDetections.length
      const detections = shouldUseOcrLayout ? inferred.detections : textBackedDetections

      if (detections.length === 0) {
        setRecognitionMessage(
          'Non riesco a separare le carte in questa foto. Mostrale intere e lascia un piccolo spazio tra quelle sparse.'
        )
        return
      }

      setMultiDetections(detections)

      const results: Array<MultiRecognitionItem | null> = new Array(detections.length).fill(null)
      let cursor = 0
      let completed = 0
      const worker = async () => {
        while (cursor < detections.length) {
          const index = cursor
          cursor += 1
          results[index] = await recognizeMultiDetection(detections[index], index, ocrResult.texts)
          completed += 1
          setRecognitionMessage(`Riconoscimento carte: ${completed}/${detections.length}...`)
        }
      }
      await Promise.all(Array.from({ length: Math.min(4, detections.length) }, () => worker()))
      if (!isScanStillActive(generation)) return

      const recognized = results.filter((item): item is MultiRecognitionItem => Boolean(item))
      const unrecognized = detections.length - recognized.length
      setMultiUnrecognized(unrecognized)

      if (recognized.length === 0) {
        setRecognitionMessage('Le carte sono state separate, ma il testo non era abbastanza leggibile. Avvicina la fotocamera e riprova.')
        return
      }

      multiQueueRef.current = recognized.slice(1)
      setMultiConfirmationProgress({ current: 1, total: recognized.length })
      presentMultiRecognition(recognized[0], generation)
    } catch (error) {
      console.error('Multi-card OCR error:', error)
      setRecognitionMessage('L’analisi multipla si è interrotta. La modalità singola resta disponibile.')
    } finally {
      if (scanGenerationRef.current === generation) setPhotoProcessing(false)
    }
  }

  const processCapturedPhoto = async (file: File) => {
    scanGenerationRef.current += 1
    const generation = scanGenerationRef.current
    scanSessionRef.current = true
    showSummaryRef.current = false
    setScanSessionActive(true)
    setShowSummary(false)
    setPendingRecognition(null)
    setVariantChoiceRequired(false)
    setCameraError(null)
    setPhotoProcessing(true)
    setRecognitionMessage('Leggo nome, effetto e valori della carta...')

    try {
      const photoCanvas = await loadPhotoCanvas(file)
      if (!isScanStillActive(generation)) return

      const detectedRect = detectPhotoCardRect(photoCanvas)
      const comparisonCanvas = detectedRect ? cropPhotoCard(photoCanvas, detectedRect) : photoCanvas
      const ocrCanvas = buildPhotoOcrCanvas(photoCanvas, detectedRect)
      const ocrText = await runOcrOnCanvases([ocrCanvas], 'photo')
      if (!isScanStillActive(generation) || ocrText === null) return

      if (!ocrText.trim()) {
        setRecognitionMessage('Non riesco ancora a leggere abbastanza testo. Prova una foto più dritta, nitida e senza riflessi.')
        return
      }

      setRecognitionMessage('Confronto nome, effetto, costo, forza, counter e tipo...')
      const { candidates, textMatch } = await findVisibleTextCandidates(ocrText)
      if (!isScanStillActive(generation)) return

      if (candidates.length === 0) {
        setRecognitionMessage('Questa foto non mi dà ancora abbastanza elementi. Prova a tenere visibili nome, effetto e valori della carta.')
        return
      }

      if (textMatch?.decisive) {
        const familyCandidates = candidates.filter(card =>
          baseCardCode(card.card_id || card.id || '') === textMatch.family
        )
        const textCard = familyCandidates.find(card => card.card_id === textMatch.cardId) || familyCandidates[0]

        if (textCard) {
          const recognizedCard = toScannedCard(textCard)
          setPendingRecognition(recognizedCard)
          setVariantChoiceRequired(true)
          setRecognitionMessage(`Carta trovata: ${recognizedCard.name}. Controlla la variante e conferma.`)
          enrichPendingPriceInBackground(recognizedCard, generation)
          return
        }
      }

      const verified = await verifyPhotoCandidates(candidates, comparisonCanvas, Boolean(detectedRect))
      if (!isScanStillActive(generation)) return

      if (!verified) {
        setRecognitionMessage('Non riesco a distinguere con certezza questa carta. Prova un nuovo scatto mostrando la carta intera.')
        return
      }

      const verifiedFamily = baseCardCode(verified.card.card_id)
      const familyCard = candidates.find(card =>
        baseCardCode(card.card_id || card.id || '') === verifiedFamily && !/_p\d+$/i.test(card.card_id)
      )
      const recognizedCard = familyCard ? toScannedCard(familyCard) : verified.card
      setPendingRecognition(recognizedCard)
      setVariantChoiceRequired(true)
      setRecognitionMessage(`Carta trovata: ${recognizedCard.name}. Controlla la variante e conferma.`)
      enrichPendingPriceInBackground(recognizedCard, generation)
    } catch (error) {
      console.error('Native photo scan error:', error)
      setCameraError('Questa foto non è stata letta bene. Prova con la carta intera e ben illuminata.')
      setRecognitionMessage('Pronto per una nuova foto.')
    } finally {
      if (scanGenerationRef.current === generation) setPhotoProcessing(false)
    }
  }

  const handleCapturedPhoto = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return

    clearCapturedPhoto()
    const previewUrl = URL.createObjectURL(file)
    capturedPhotoUrlRef.current = previewUrl
    setCapturedPhotoUrl(previewUrl)
    if (scanMode === 'multi') {
      void processMultiPhoto(file)
    } else {
      void processCapturedPhoto(file)
    }
  }

  const openNativeCamera = () => {
    if (photoProcessing) return
    if (!scanMode) {
      setCameraError('Scegli prima una modalità di scansione.')
      return
    }
    if (ocrStatus && !ocrStatus.googleVisionConfigured) {
      setCameraError('Scanner temporaneamente non disponibile.')
      return
    }
    if (ocrStatus && !ocrStatus.serviceRoleConfigured) {
      setCameraError('Scanner temporaneamente non disponibile.')
      return
    }
    if (ocrStatus?.error) {
      setCameraError(`Il contatore delle scansioni non è pronto: ${ocrStatus.error}`)
      return
    }
    photoInputRef.current?.click()
  }

  const addRecognizedCardToCollection = async (card: ScannedCard) => {
    if (!userId || adding) return
    if (variantChoiceRequired) {
      setRecognitionMessage('Seleziona la variante corretta prima di aggiungere la carta.')
      return
    }

    setAdding('pending')

    const savedCard = {
      ...card,
      quantity: recognitionQuantity,
      id: `${card.card_id || card.name || 'card'}-${Date.now()}-${Math.random()}`
    }

    try {
      await saveCardToCollection(savedCard)
      if (scanMode === 'multi') {
        if (!multiUsageConfirmedRef.current) {
          await confirmDailyScanUsage()
          multiUsageConfirmedRef.current = true
        }
      } else {
        await confirmDailyScanUsage()
      }

      setScannedCards(prev => [savedCard, ...prev])
      recognitionStreakRef.current = null
      ocrMissStreakRef.current = 0
      lastConfirmedSignatureRef.current = pendingRecognitionSignatureRef.current
      pendingRecognitionSignatureRef.current = null
      setCarouselIndex(0)
      setPendingRecognition(null)
      setRecognitionQuantity(1)
      setVariantChoiceRequired(false)
      scanCooldownUntilRef.current = Date.now() + 150
      if (scanMode === 'multi') {
        advanceMultiRecognition()
      } else {
        clearCapturedPhoto()
        setRecognitionMessage(`Carta aggiunta alla collezione: ${card.name}. Scatta la foto della prossima carta.`)
      }

      if (savedCard.market_price == null && savedCard.inventory_price == null) {
        void enrichCardWithLivePrice(savedCard).then(async pricedCard => {
          const livePrice = pricedCard.market_price ?? pricedCard.inventory_price ?? null
          if (!userId || livePrice == null) return

          await supabase
            .from('user_cards')
            .update({
              market_price: livePrice,
              inventory_price: null,
              image_url: pricedCard.image_url || savedCard.image_url
            })
            .eq('user_id', userId)
            .eq('card_id', savedCard.card_id)
            .is('market_price', null)
            .is('inventory_price', null)

          setScannedCards(prev => prev.map(item =>
            item.id === savedCard.id
              ? {
                  ...item,
                  market_price: livePrice,
                  inventory_price: null,
                  image_url: item.image_url || pricedCard.image_url || null,
                  price_source: pricedCard.price_source,
                  price_url: pricedCard.price_url,
                  price_updated_at: pricedCard.price_updated_at
                }
              : item
          ))
        })
      }
    } catch (err) {
      console.error('Add recognized card error:', err)
      alert('Errore aggiunta carta alla collezione')
    }

    setAdding(null)
  }

  const discardPendingRecognition = () => {
    pendingRecognitionSignatureRef.current = null
    recognitionStreakRef.current = null
    ocrMissStreakRef.current = 0
    scanCooldownUntilRef.current = Date.now() + 80
    setPendingRecognition(null)
    setRecognitionQuantity(1)
    setVariantChoiceRequired(false)
    if (scanMode === 'multi') {
      advanceMultiRecognition()
    } else {
      clearCapturedPhoto()
      setRecognitionMessage('Carta scartata. Scatta la foto della prossima carta.')
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
    if (canvas.width !== scanCanvasSize.width) canvas.width = scanCanvasSize.width
    if (canvas.height !== scanCanvasSize.height) canvas.height = scanCanvasSize.height
    setVideoSize(current => (
      current.width === canvas.width && current.height === canvas.height
        ? current
        : { width: canvas.width, height: canvas.height }
    ))
    ctx.imageSmoothingEnabled = true
    ctx.imageSmoothingQuality = 'high'

    const source = getVideoSourceRect(
      video.videoWidth,
      video.videoHeight,
      canvas.width / canvas.height
    )

    ctx.drawImage(
      video,
      source.x,
      source.y,
      source.width,
      source.height,
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

    setDetectedRect(current => (
      current && current.x === rect.x && current.y === rect.y && current.width === rect.width && current.height === rect.height
        ? current
        : rect
    ))
    const frameSignature = frameSignatureFromCanvas(canvas, rect)

    if (lastConfirmedSignatureRef.current && signatureDistance(lastConfirmedSignatureRef.current, frameSignature) < 12) {
      setRecognitionMessage('Carta già aggiunta. Cambiala o muovila per continuare.')
      scanCooldownUntilRef.current = Date.now() + 45
      return
    }
    if (lastConfirmedSignatureRef.current && signatureDistance(lastConfirmedSignatureRef.current, frameSignature) >= 12) {
      lastConfirmedSignatureRef.current = null
    }

    setRecognitionMessage('Analisi del frame in corso...')

    // Ritaglio CODICE (striscia in basso: il codice puo stare anche verso destra)
    const codeCropCanvas = getWorkCanvas('code', 760, 330)
    const codeCropCtx = codeCropCanvas.getContext('2d')

    // Ritagli leggibili: effetto, nome e riga codice sono le zone piu utili per il match.
    const nameCropCanvas = getWorkCanvas('name', 820, 450)
    const nameCropCtx = nameCropCanvas.getContext('2d')

    if (!codeCropCtx || !nameCropCtx) return
    codeCropCtx.imageSmoothingEnabled = true
    codeCropCtx.imageSmoothingQuality = 'high'
    nameCropCtx.imageSmoothingEnabled = true
    nameCropCtx.imageSmoothingQuality = 'high'

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
        index * 110,
        codeCropCanvas.width,
        110
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
        index * 150,
        nameCropCanvas.width,
        150
      )
    })

    const preprocessedCode = getWorkCanvas('preprocessed-code', 760, 330)
    preprocessForOcr(codeCropCanvas, preprocessedCode)

    if (!ocrReady) {
      setRecognitionMessage('Inizializzo il riconoscimento del testo...')
      return
    }

    const fastOcrCanvas = getWorkCanvas('fast-ocr', 860, 780)
    const fastOcrCtx = fastOcrCanvas.getContext('2d')
    if (!fastOcrCtx) return
    fastOcrCtx.imageSmoothingEnabled = true
    fastOcrCtx.imageSmoothingQuality = 'high'
    fastOcrCtx.fillStyle = '#ffffff'
    fastOcrCtx.fillRect(0, 0, fastOcrCanvas.width, fastOcrCanvas.height)
    fastOcrCtx.drawImage(codeCropCanvas, 0, 0, fastOcrCanvas.width, 190)
    fastOcrCtx.drawImage(preprocessedCode, 0, 190, fastOcrCanvas.width, 190)
    fastOcrCtx.drawImage(nameCropCanvas, 0, 380, fastOcrCanvas.width, 400)

    const imageMatchCanvas = getWorkCanvas('image-match', 336, 470)
    const imageMatchCtx = imageMatchCanvas.getContext('2d')
    if (imageMatchCtx) {
      imageMatchCtx.imageSmoothingEnabled = true
      imageMatchCtx.imageSmoothingQuality = 'high'
      imageMatchCtx.drawImage(canvas, rect.x, rect.y, rect.width, rect.height, 0, 0, imageMatchCanvas.width, imageMatchCanvas.height)
    }

    const ocrMode = ocrMissStreakRef.current > 0 ? 'accurate' : 'fast'
    const ocrText = await runOcrOnCanvases([fastOcrCanvas], ocrMode)
    if (!isScanStillActive(generation)) return
    if (ocrText === null) {
      recognitionStreakRef.current = null
      scanCooldownUntilRef.current = Date.now() + 250
      return
    }
    if (!isCapturedFrameStillLive(frameSignature, 30)) {
      recognitionStreakRef.current = null
      scanCooldownUntilRef.current = Date.now() + 20
      setRecognitionMessage('Inquadratura cambiata. Leggo la carta attuale...')
      return
    }

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
    if (!isCapturedFrameStillLive(frameSignature, 34)) {
      recognitionStreakRef.current = null
      scanCooldownUntilRef.current = Date.now() + 20
      setRecognitionMessage('Risultato vecchio scartato. Tieni ferma la carta attuale...')
      return
    }

    if (cardMatch) {
      ocrMissStreakRef.current = 0
      if (!shouldShowRecognizedCard(cardMatch, allOcrText, Boolean(localMatch || serverMatch))) {
        setRecognitionMessage(`Possibile carta: ${cardMatch.name}. Verifico un altro frame...`)
        scanCooldownUntilRef.current = Date.now() + 45
        return
      }

      pendingRecognitionSignatureRef.current = frameSignature
      setPendingRecognition(cardMatch)
      setRecognitionMessage(`Carta trovata: ${cardMatch.name}. Aggiungila alla collezione o scartala.`)
      enrichPendingPriceInBackground(cardMatch, generation)
      refineRecognitionVariant(allOcrText, imageMatchCanvas, generation, cardMatch)
    } else {
      recognitionStreakRef.current = null
      ocrMissStreakRef.current += 1
      scanCooldownUntilRef.current = Date.now() + Math.min(160, 45 + ocrMissStreakRef.current * 25)
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
      setCameraError('Google Vision non è configurato sul server.')
      return
    }

    if (ocrStatus && !ocrStatus.serviceRoleConfigured) {
      setCameraError('Il contatore globale delle scansioni non è configurato sul server.')
      return
    }

    if (ocrStatus?.error) {
      setCameraError('Scanner temporaneamente non disponibile.')
      return
    }

    if (!navigator.mediaDevices?.getUserMedia) {
      setCameraError('La camera non è disponibile nel tuo browser.')
      return
    }

    if (streamRef.current) {
      await activateCameraStream(streamRef.current)
      return
    }

    try {
      const stream = await openCameraStream()
      await activateCameraStream(stream)
      setRecognitionMessage('Scanner attivo. Tieni la carta al centro.')
    } catch (err) {
      console.error('Camera error:', err)
      scanGenerationRef.current += 1
      scanSessionRef.current = false
      setCameraActive(false)
      setCameraReady(false)
      setCameraError('Funzionalità non disponibile su versione Desktop, utilizzare un dispositivo mobile. ')
    }
  }

  const confirmDailyScanUsage = async () => {
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const response = await fetch('/api/cards/ocr', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: session?.access_token ? `Bearer ${session.access_token}` : ''
        },
        body: JSON.stringify({ confirm: true })
      })

      if (!response.ok) {
        const data = await response.json().catch(() => null)
        console.error('Daily scan confirmation error:', data?.error || response.status)
      }
    } catch (error) {
      console.error('Daily scan confirmation error:', error)
    }
  }

  const refineRecognitionVariant = (
    ocrText: string,
    sourceCanvas: HTMLCanvasElement,
    generation: number,
    initialCard: ScannedCard
  ) => {
    const cardCode = extractCardCode(ocrText)
    if (!cardCode) return

    const variants = (referenceLookup.byBaseCode.get(baseCardCode(cardCode)) || [])
      .filter(card => card.image_url || card.card_image)
      .slice(0, 6)
    if (variants.length < 2) return

    const capturedCanvas = document.createElement('canvas')
    capturedCanvas.width = sourceCanvas.width
    capturedCanvas.height = sourceCanvas.height
    capturedCanvas.getContext('2d')?.drawImage(sourceCanvas, 0, 0)

    void Promise.all(variants.map(async card => ({
      card,
      distance: await compareImageToCandidate(capturedCanvas, card.image_url || card.card_image || '')
    }))).then(async matches => {
      if (!isScanStillActive(generation)) return
      const ranked = matches
        .filter(match => Number.isFinite(match.distance))
        .sort((a, b) => a.distance - b.distance)
      const best = ranked[0]
      const second = ranked[1]

      // Aggiorniamo automaticamente solo quando la foto distingue davvero la variante.
      if (!best || best.distance > 105 || (second && second.distance - best.distance < 2.5)) return
      if (best.card.card_id === initialCard.card_id) return

      const refinedCard = {
        ...toScannedCard(best.card),
        id: initialCard.id
      }
      setPendingRecognition(current => {
        if (!current || current.card_id !== initialCard.card_id) return current
        return refinedCard
      })

      setRecognitionMessage(`Carta trovata: ${refinedCard.name}. Variante verificata.`)
      const pricedCard = await enrichCardWithLivePrice(refinedCard)
      if (!isScanStillActive(generation)) return
      setPendingRecognition(current => (
        current?.card_id === refinedCard.card_id ? { ...current, ...pricedCard, id: current.id } : current
      ))
    }).catch(() => undefined)
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
    setVariantChoiceRequired(false)
    pendingRecognitionSignatureRef.current = null
    lastConfirmedSignatureRef.current = null
    ocrMissStreakRef.current = 0
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
    if (!query.trim()) {
      manualSearchRunRef.current += 1
      setSearching(false)
      return
    }

    const runId = ++manualSearchRunRef.current
    setSearching(true)
    void trackAnalyticsEvent('manual_search', { source: 'scan', length: query.trim().length }, '/scan')
    try {
      const res = await fetch(`/api/cards/search?q=${encodeURIComponent(query)}`)
      const results = await res.json()
      if (runId !== manualSearchRunRef.current) return

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
        market_price: null,
        inventory_price: null,
      }

      setScannedCards(prev => [...prev, newCard])
      setSearchInput('')
      setCarouselIndex(scannedCards.length)
    } catch (err) {
      if (runId !== manualSearchRunRef.current) return
      console.error('Search error:', err)
      alert('Errore ricerca carta')
    }
    if (runId !== manualSearchRunRef.current) return
    setSearching(false)
  }

  const saveCardToCollection = async (card: ScannedCard) => {
    if (!userId) return
    const quantityToAdd = Math.max(1, Math.min(99, Math.floor(card.quantity || 1)))

    const { data: existing, error: lookupError } = await supabase
      .from('user_cards')
      .select('id, quantity, market_price, inventory_price')
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
      const savedPrice = card.market_price ?? card.inventory_price ?? null
      const shouldBackfillPrice = existing.market_price == null && existing.inventory_price == null && savedPrice != null
      const { error } = await supabase
        .from('user_cards')
        .update({
          quantity: existing.quantity + quantityToAdd,
          ...payload,
          market_price: shouldBackfillPrice ? savedPrice : existing.market_price ?? null,
          inventory_price: shouldBackfillPrice ? null : existing.inventory_price ?? null,
        })
        .eq('id', existing.id)

      if (error) throw error
    } else {
      const { error } = await supabase
        .from('user_cards')
        .insert({
          ...payload,
          quantity: quantityToAdd
        })

      if (error) throw error
    }
  }

  const discardScanResults = () => {
    setScannedCards([])
    setCarouselIndex(0)
    setShowSummary(false)
    setRecognitionMessage('Riepilogo chiuso.')
  }

  const totalValue = scannedCards.reduce((sum, card) => {
    const price = card.market_price || card.inventory_price || 0
    return sum + price * Number(card.quantity || 1)
  }, 0)
  const scannedQuantity = scannedCards.reduce((sum, card) => sum + Number(card.quantity || 1), 0)

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
              {!scanMode ? (
                <div className="overflow-hidden rounded-[28px] border border-cyan-200/20 bg-slate-950/82 p-4 shadow-[0_24px_60px_rgba(0,0,0,0.35)]">
                  <div className="mb-5 px-1 text-center">
                    <p className="text-[10px] font-black uppercase tracking-[0.28em] text-cyan-200">Scegli modalità</p>
                    <h1 className="mt-2 text-2xl font-black text-white">Come vuoi scannerizzare?</h1>
                  </div>
                  <div className="grid gap-3">
                    <button
                      type="button"
                      onClick={() => selectScanMode('single')}
                      className="group flex min-h-28 items-center gap-4 rounded-2xl border border-slate-700 bg-slate-900/90 p-4 text-left transition hover:border-cyan-200/55 active:scale-[0.98]"
                    >
                      <span className="grid h-14 w-14 shrink-0 place-items-center rounded-2xl border border-cyan-200/30 bg-cyan-300/10 text-cyan-100">
                        <ScanLine size={28} />
                      </span>
                      <span>
                        <span className="block text-base font-black text-white">Scansiona una carta</span>
                        <span className="mt-1 block text-xs leading-5 text-slate-400">Il sistema stabile per una carta alla volta.</span>
                      </span>
                    </button>
                    <button
                      type="button"
                      onClick={() => selectScanMode('multi')}
                      className="group relative flex min-h-28 items-center gap-4 overflow-hidden rounded-2xl border border-amber-300/35 bg-amber-300/[0.08] p-4 text-left transition hover:border-amber-200/70 active:scale-[0.98]"
                    >
                      <span className="grid h-14 w-14 shrink-0 place-items-center rounded-2xl border border-amber-200/35 bg-amber-300/15 text-amber-100">
                        <Images size={28} />
                      </span>
                      <span>
                        <span className="flex items-center gap-2 text-base font-black text-white">
                          Scansiona più carte
                          <span className="rounded-full border border-amber-200/25 bg-amber-300/10 px-2 py-0.5 text-[8px] uppercase tracking-[0.16em] text-amber-100">Nuovo</span>
                        </span>
                        <span className="mt-1 block text-xs leading-5 text-slate-300">Trova fino a 12 carte con una sola foto.</span>
                      </span>
                    </button>
                  </div>
                </div>
              ) : (
                <>
                  <input
                    ref={photoInputRef}
                    type="file"
                    accept="image/*"
                    capture="environment"
                    className="hidden"
                    onChange={handleCapturedPhoto}
                  />

                  <div className="mb-3 grid grid-cols-2 rounded-2xl border border-slate-700 bg-slate-950/75 p-1">
                    <button
                      type="button"
                      onClick={() => selectScanMode('single')}
                      className={`flex h-10 items-center justify-center gap-2 rounded-xl text-xs font-black transition active:scale-95 ${
                        scanMode === 'single' ? 'bg-cyan-300 text-slate-950' : 'text-slate-400'
                      }`}
                    >
                      <ScanLine size={16} />
                      Una carta
                    </button>
                    <button
                      type="button"
                      onClick={() => selectScanMode('multi')}
                      className={`flex h-10 items-center justify-center gap-2 rounded-xl text-xs font-black transition active:scale-95 ${
                        scanMode === 'multi' ? 'bg-amber-300 text-slate-950' : 'text-slate-400'
                      }`}
                    >
                      <Images size={16} />
                      Più carte
                    </button>
                  </div>

                  <div className="relative overflow-hidden rounded-[28px] border border-amber-400/25 bg-slate-950/80 shadow-[0_24px_60px_rgba(0,0,0,0.4)]">
                    <div className="absolute inset-0 bg-gradient-to-b from-amber-400/10 via-transparent to-transparent" />
                    <div className={`relative overflow-hidden rounded-[28px] ${
                      scanMode === 'multi'
                        ? 'h-[46dvh] min-h-[300px] max-h-[540px]'
                        : 'aspect-[3/4]'
                    }`}>
                      <canvas ref={processingCanvasRef} className="hidden" />
                      {capturedPhotoUrl ? (
                        <img
                          src={capturedPhotoUrl}
                          alt={scanMode === 'multi' ? 'Carte individuate nella foto' : 'Foto della carta'}
                          className="h-full w-full bg-slate-950 object-contain"
                        />
                      ) : (
                        <div className="absolute inset-0 flex h-full w-full flex-col items-center justify-center gap-4 bg-gradient-to-b from-slate-900 to-slate-800 p-6 text-center">
                          <div className={`rounded-full border p-5 ${
                            scanMode === 'multi'
                              ? 'border-amber-300/35 bg-amber-300/10 text-amber-100'
                              : 'border-cyan-300/30 bg-cyan-300/10 text-cyan-200'
                          }`}>
                            {scanMode === 'multi' ? <Images size={54} /> : <Camera size={54} />}
                          </div>
                          <p className="max-w-72 text-sm leading-6 text-slate-300">
                            {scanMode === 'multi'
                              ? 'Disponi le carte separate oppure inquadra un’intera pagina del raccoglitore.'
                              : 'Inquadra tutta la carta, senza riflessi.'}
                          </p>
                        </div>
                      )}

                      {photoProcessing && (
                        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-slate-950/78 text-cyan-100 backdrop-blur-sm">
                          <LoaderCircle className="animate-spin" size={36} />
                          <p className="text-sm font-black uppercase tracking-[0.18em]">
                            {scanMode === 'multi' ? 'Analisi multipla' : 'Analisi foto'}
                          </p>
                        </div>
                      )}
                      <div className="pointer-events-none absolute inset-0 rounded-[28px] border-2 border-white/10" />
                    </div>
                  </div>

                  <div className="mt-4 space-y-3">
                    {!photoProcessing && (
                      <button
                        type="button"
                        onClick={openNativeCamera}
                        className="op-solid-action flex w-full items-center justify-center gap-2 rounded-2xl border border-cyan-200/45 bg-cyan-300 px-4 py-3 text-sm font-black uppercase tracking-[0.12em] text-slate-950 shadow-lg shadow-cyan-950/20 transition active:scale-[0.98]"
                      >
                        <Camera size={19} />
                        {capturedPhotoUrl
                          ? 'Scatta di nuovo'
                          : scanMode === 'multi' && scannedCards.length > 0
                            ? 'Scatta altro gruppo'
                            : scanMode === 'multi'
                              ? 'Scatta foto multipla'
                              : 'Scatta foto'}
                      </button>
                    )}

                    {scannedCards.length > 0 &&
                      !pendingRecognition &&
                      !photoProcessing &&
                      !(scanMode === 'multi' && capturedPhotoUrl) && (
                      <button
                        type="button"
                        onClick={stopCamera}
                        className="w-full rounded-2xl border border-red-400/50 bg-red-500/15 px-4 py-3 text-sm font-extrabold uppercase tracking-[0.18em] text-red-200 shadow-lg shadow-red-950/20 transition active:scale-[0.98]"
                      >
                        Vai ai risultati
                      </button>
                    )}

                    {cameraError && (
                      <div className="rounded-2xl border border-amber-400/20 bg-amber-400/10 px-3 py-2 text-sm text-amber-200">
                        {cameraError}
                      </div>
                    )}

                    <div className="rounded-2xl border border-slate-700 bg-slate-800/60 px-3 py-2 text-sm leading-5 text-slate-300">
                      {recognitionMessage}
                    </div>

                    {(showSummary || scannedCards.length > 0) && (
                      <div className="flex items-center justify-between rounded-2xl border border-slate-700 bg-slate-800/60 px-3 py-3">
                        <div>
                          <p className="text-[10px] uppercase tracking-[0.3em] text-slate-400">Carte</p>
                          <p className="text-lg font-bold text-amber-300">{scannedQuantity}</p>
                        </div>
                        <div className="text-right">
                          <p className="text-[10px] uppercase tracking-[0.3em] text-slate-400">Valore</p>
                          <p className="text-lg font-bold text-emerald-400">{formatPrice(totalValue)}</p>
                        </div>
                      </div>
                    )}
                  </div>
                </>
              )}
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
                    <h3 className="text-xl font-extrabold text-white">{scannedCards.length > 0 ? `${scannedQuantity} carte pescate` : 'Nessuna carta'}</h3>
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
                          <span>{displayCardId(currentCard.card_id)}</span>
                          {Number(currentCard.quantity || 1) > 1 ? (
                            <span className="rounded-full border border-amber-300/25 bg-amber-300/10 px-2 py-1 font-black text-amber-100">
                              x{currentCard.quantity} · {formatPrice(currentCardValue * Number(currentCard.quantity || 1))}
                            </span>
                          ) : null}
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

                <div className="mt-4">
                  <button
                    onClick={discardScanResults}
                    className="w-full rounded-2xl border border-slate-600 bg-slate-900 px-4 py-3 text-sm font-bold text-slate-200 transition hover:border-slate-400"
                  >
                    Chiudi
                  </button>
                </div>
              </div>
            </div>
          )}

          {pendingRecognition && !showSummary && (
            <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-950/80 sm:items-center sm:px-4 sm:py-6">
              <div className="flex h-[100dvh] w-full max-w-[420px] flex-col overflow-hidden bg-slate-900/95 shadow-[0_20px_60px_rgba(0,0,0,0.45)] sm:h-auto sm:max-h-[92dvh] sm:rounded-[28px] sm:border sm:border-amber-400/30">

                <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-4 pb-6">
                  <p className="text-center text-[10px] uppercase tracking-[0.35em] text-amber-300">
                    {scanMode === 'multi' && multiConfirmationProgress.total > 0
                      ? `Carta ${multiConfirmationProgress.current} di ${multiConfirmationProgress.total}`
                      : 'Carta rilevata'}
                  </p>
                  <h3 className="mt-2 text-center text-xl font-bold text-white">{pendingRecognition.name}</h3>
                  <p className="mt-1 text-center text-[11px] uppercase tracking-[0.25em] text-slate-400">{displayCardId(pendingRecognition.card_id)}</p>

                  <div className="mt-4">
                    {renderCardImage(
                      pendingRecognition,
                      'h-[42dvh] min-h-[240px] max-h-[390px] w-full rounded-[24px] border border-slate-700'
                    )}
                  </div>

                  {recognitionVariants.length > 1 && (
                    <div className="mt-3">
                      <div className="mb-2 flex items-center justify-between gap-2">
                        <p className="text-[10px] font-black uppercase tracking-[0.24em] text-slate-400">Variante</p>
                        {recognitionVariantsLoading && <span className="text-[10px] text-slate-500">Carico...</span>}
                      </div>

                      <div className="flex gap-2 overflow-x-auto pb-1">
                        {recognitionVariants.map(variant => {
                          const selected = variant.card_id === pendingRecognition.card_id

                          return (
                            <button
                              key={variant.card_id}
                              onClick={() => selectRecognitionVariant(variant)}
                              className={`w-[82px] shrink-0 rounded-2xl border p-1.5 text-left transition ${
                                selected
                                  ? 'border-cyan-200 bg-cyan-300/15 shadow-[0_0_22px_rgba(103,232,249,0.25)]'
                                  : 'border-slate-700 bg-slate-950/70 hover:border-slate-500'
                              }`}
                            >
                              {renderCardImage(variant, 'aspect-[3/4] w-full rounded-xl bg-slate-950')}
                              <p className={`mt-1 truncate text-[10px] font-black ${selected ? 'text-cyan-100' : 'text-slate-200'}`}>
                                {variantLabel(variant)}
                              </p>
                              <p className="truncate text-[9px] text-slate-500">{getRarityLabel(variant) || '-'}</p>
                            </button>
                          )
                        })}
                      </div>
                    </div>
                  )}

                  {variantChoiceRequired && (
                    <p className="mt-2 rounded-xl border border-amber-300/25 bg-amber-300/10 px-3 py-2 text-center text-xs font-bold text-amber-100">
                      Tocca la variante corretta per poter confermare.
                    </p>
                  )}

                  <div className="mt-3 rounded-2xl border border-cyan-300/25 bg-cyan-300/10 px-3 py-2 text-center">
                    <p className="text-[10px] uppercase tracking-[0.3em] text-slate-400">Prezzo Medio</p>
                    <p className="mt-1 text-2xl font-black text-cyan-200">
                      {formatPrice(pendingRecognition.market_price ?? pendingRecognition.inventory_price ?? 0)}
                    </p>
                  </div>

                  <p className="mt-3 text-center text-sm text-slate-300">
                    Questa è la carta che hai appena scansionato?
                  </p>

                  <div className="mx-auto mt-3 flex w-fit items-center gap-3 rounded-2xl border border-white/10 bg-slate-950/75 p-1.5">
                    <button
                      type="button"
                      onClick={() => setRecognitionQuantity(current => Math.max(1, current - 1))}
                      disabled={recognitionQuantity <= 1 || adding === 'pending'}
                      className="grid h-10 w-10 place-items-center rounded-xl border border-slate-700 bg-slate-800 text-slate-100 transition active:scale-90 disabled:opacity-35"
                      aria-label="Riduci quantita"
                    >
                      <Minus size={18} />
                    </button>
                    <div className="min-w-16 text-center">
                      <p className="text-[9px] font-black uppercase tracking-[0.2em] text-slate-500">Quantita</p>
                      <p className="text-xl font-black text-white">{recognitionQuantity}</p>
                    </div>
                    <button
                      type="button"
                      onClick={() => setRecognitionQuantity(current => Math.min(99, current + 1))}
                      disabled={recognitionQuantity >= 99 || adding === 'pending'}
                      className="grid h-10 w-10 place-items-center rounded-xl border border-cyan-300/30 bg-cyan-300/10 text-cyan-100 transition active:scale-90 disabled:opacity-35"
                      aria-label="Aumenta quantita"
                    >
                      <Plus size={18} />
                    </button>
                  </div>
                </div>

                <div className="shrink-0 border-t border-slate-700 bg-slate-950/95 p-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] backdrop-blur-xl">
                  <div className="flex gap-2">
                    <button
                      onClick={discardPendingRecognition}
                      className="flex-1 rounded-2xl border border-slate-600 bg-slate-800 px-3 py-3 text-sm font-semibold text-slate-200 transition hover:border-slate-500"
                    >
                      Scarta
                    </button>

                    <button
                      onClick={() => addRecognizedCardToCollection(pendingRecognition)}
                      disabled={adding === 'pending' || variantChoiceRequired}
                      className="flex-1 rounded-2xl border border-emerald-500/40 bg-emerald-500/20 px-3 py-3 text-sm font-bold text-emerald-300 transition hover:bg-emerald-500/30 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {adding === 'pending'
                        ? 'Aggiungo...'
                        : variantChoiceRequired
                          ? 'Scegli variante'
                          : `Aggiungi x${recognitionQuantity} alla collezione`}
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}

          {introMode && (
            <div className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-950/78 px-4 py-6 backdrop-blur-sm">
              <div className="w-full max-w-[390px] rounded-[26px] border border-cyan-200/25 bg-slate-900 p-5 shadow-[0_28px_90px_rgba(0,0,0,0.6)]">
                <div className="mx-auto grid h-12 w-12 place-items-center rounded-2xl border border-cyan-200/25 bg-cyan-300/10 text-cyan-100">
                  {introMode === 'multi' ? <Images size={24} /> : <Info size={24} />}
                </div>
                <h2 className="mt-4 text-center text-xl font-black text-white">
                  {introMode === 'multi' ? 'Scansione multipla' : 'Scansione singola'}
                </h2>
                {introMode === 'multi' ? (
                  <div className="mt-4 space-y-2 text-sm leading-6 text-slate-300">
                    <p>Inquadra da 1 a 12 carte su un piano oppure un’intera pagina del raccoglitore.</p>
                    <p>Mostra ogni carta per intero, evita sovrapposizioni e limita i riflessi sulle bustine.</p>
                    <p>Controlla i contorni numerati prima dell’analisi: tutta la foto usa una sola scansione Google Vision.</p>
                  </div>
                ) : (
                  <div className="mt-4 space-y-2 text-sm leading-6 text-slate-300">
                    <p>Mostra una sola carta intera, ben illuminata e leggibile.</p>
                    <p>Evita riflessi, dita sul testo e inclinazioni forti. Controlla sempre la variante prima di confermare.</p>
                  </div>
                )}
                <button
                  type="button"
                  onClick={closeScanIntro}
                  className="mt-5 w-full rounded-2xl border border-cyan-200/40 bg-cyan-300 px-4 py-3 text-sm font-black text-slate-950 transition active:scale-[0.98]"
                >
                  Ho capito
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}  
