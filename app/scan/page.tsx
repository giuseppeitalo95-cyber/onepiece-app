'use client'

import { useEffect, useState, useRef } from 'react'
import type { CSSProperties, PointerEvent as ReactPointerEvent } from 'react'
import { supabase } from '@/lib/supabase'
import { useRouter } from 'next/navigation'
import Sidebar from '@/app/components/Sidebar'
import Topbar from '@/app/components/Topbar'
import { Camera, ChevronLeft, ChevronRight, SwitchCamera } from 'lucide-react'
import { evaluateProgressSynced } from '@/lib/progression'
import { trackAnalyticsEvent } from '@/lib/analytics'
import { getRarityLabel } from '@/lib/rarity'

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
  const [cameraDevices, setCameraDevices] = useState<MediaDeviceInfo[]>([])
  const [selectedCameraId, setSelectedCameraId] = useState<string | null>(null)
  const [searchInput, setSearchInput] = useState('')
  const [scannedCards, setScannedCards] = useState<ScannedCard[]>([])
  const [searching, setSearching] = useState(false)
  const [adding, setAdding] = useState<string | null>(null)
  const [carouselIndex, setCarouselIndex] = useState(0)
  const [referenceCards, setReferenceCards] = useState<ReferenceCard[]>([])
  const [detectedRect, setDetectedRect] = useState<{ x: number; y: number; width: number; height: number } | null>(null)
  const [recognitionMessage, setRecognitionMessage] = useState('Attendi il riconoscimento...')
  const [pendingRecognition, setPendingRecognition] = useState<ScannedCard | null>(null)
  const [recognitionVariants, setRecognitionVariants] = useState<ScannedCard[]>([])
  const [recognitionVariantsLoading, setRecognitionVariantsLoading] = useState(false)
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
  const lastFocusPulseRef = useRef(0)
  const scanSessionRef = useRef(false)
  const showSummaryRef = useRef(false)
  const pendingRecognitionSignatureRef = useRef<number[] | null>(null)
  const lastConfirmedSignatureRef = useRef<number[] | null>(null)
  const manualSearchRunRef = useRef(0)

  const scanCanvasSize = { width: 1440, height: 1920 }

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
    }, 260)

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
    }, 3500)

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
      if (advanced.length > 0) {
        await track.applyConstraints({ advanced } as unknown as MediaTrackConstraints)
      }
    } catch {
      // Alcuni browser Android espongono le capability ma rifiutano i constraint.
    }
  }

  const pulseCameraFocus = async () => {
    const now = Date.now()
    if (now - lastFocusPulseRef.current < 1600) return
    lastFocusPulseRef.current = now

    const [track] = streamRef.current?.getVideoTracks() || []
    if (!track?.getCapabilities || !track.applyConstraints) return

    try {
      const capabilities = track.getCapabilities() as MediaTrackCapabilities & {
        focusMode?: string[]
      }

      if (capabilities.focusMode?.includes('continuous')) {
        await track.applyConstraints({ advanced: [{ focusMode: 'continuous' }] } as unknown as MediaTrackConstraints)
      }
    } catch {
      // Android/WebView spesso ignora il fuoco manuale: in quel caso lasciamo continuous.
    }
  }

  const attachStream = async (stream: MediaStream) => {
    if (!videoRef.current) return

    stream = await applyMaxCameraResolution(stream)
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
      window.setTimeout(() => void pulseCameraFocus(), 350)
    } catch {
      videoRef.current.onloadedmetadata = () => {
        setVideoSize({
          width: videoRef.current?.videoWidth || 1,
          height: videoRef.current?.videoHeight || 1
        })
        videoRef.current?.play().catch(() => undefined)
        window.setTimeout(() => void pulseCameraFocus(), 350)
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
    width: { ideal: 3840, min: 1280 },
    height: { ideal: 2160, min: 720 },
    frameRate: { ideal: 30, min: 24 },
    resizeMode: 'none',
    ...extra
  } as MediaTrackConstraints)

  const applyMaxCameraResolution = async (stream: MediaStream) => {
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
          width: { ideal: maxWidth },
          height: { ideal: maxHeight },
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

  const refreshCameraDevices = async () => {
    const devices = await getSortedCameraDevices()
    setCameraDevices(devices)
    return devices
  }

  const getPreferredCameraConstraints = async (preferredDeviceId?: string | null): Promise<MediaStreamConstraints[]> => {
    const constraints: MediaStreamConstraints[] = []

    try {
      const videoDevices = await getSortedCameraDevices()
      const orderedDevices = preferredDeviceId
        ? [
            ...videoDevices.filter(device => device.deviceId === preferredDeviceId),
            ...videoDevices.filter(device => device.deviceId !== preferredDeviceId)
          ]
        : videoDevices

      for (const device of orderedDevices) {
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
      ...constraints,
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
          height: { ideal: 1080, min: 540 },
          frameRate: { ideal: 30 }
        },
        audio: false
      },
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
      if (best.score <= currentScore && currentWidth >= 1280) return stream

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

  const openCameraStream = async (preferredDeviceId?: string | null) => {
    const constraintsList = await getPreferredCameraConstraints(preferredDeviceId)

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

    if (!preferredDeviceId) {
      stream = await upgradeToPreferredCameraIfNeeded(stream)
    }

    return stream
  }

  const activateCameraStream = async (stream: MediaStream) => {
    streamRef.current = stream
    await attachStream(stream)
    await refreshCameraDevices()
    const activeDeviceId = stream.getVideoTracks()[0]?.getSettings?.().deviceId
    setSelectedCameraId(activeDeviceId || null)
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
    pendingRecognitionSignatureRef.current = null
    lastConfirmedSignatureRef.current = null
    recognitionStreakRef.current = null
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
  const baseCardCode = (value: string) => {
    const raw = (value || '').toLowerCase().replace(/[^a-z0-9_]/g, '')
    const withoutUnderscoreVariant = raw.replace(/_p\d+$/i, '')
    return withoutUnderscoreVariant
      .replace(/[^a-z0-9]/g, '')
      .replace(/^((?:op|st|eb|prb|sp|ex|cp)\d{5,6}|p\d{3}|don\d{3})p\d+$/i, '$1')
  }
  const displayCardId = (value?: string | null) =>
    (value || '')
      .replace(/_p\d+$/i, '')
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
    market_price: null,
    inventory_price: null,
  })

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

        if (!cancelled) setRecognitionVariants(unique)
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
            const isVariant = /(_p\d+|parallel|alternate|alt|special|manga|treasure)/i.test(String(card.card_id || card.id || card.rarity || card.name || ''))
            let score = Math.max(0, 150 - imageDistance)

            if (id && compactOcr.includes(id)) score += 70
            if (name && compactOcr.includes(name)) score += 18
            if (isVariant) score += 8

            return { card, score, imageDistance, isVariant }
          })
        )

        variantMatches.sort((a, b) => b.score - a.score)
        const best = variantMatches[0]
        const bestVariant = variantMatches.find(match => match.isVariant)

        if (best && bestVariant && !best.isVariant && best.score - bestVariant.score <= 16 && bestVariant.imageDistance <= best.imageDistance + 8) {
          return toScannedCard(bestVariant.card)
        }

        return toScannedCard(best.card)
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

  const canvasToImage = (canvas: HTMLCanvasElement) => canvas.toDataURL('image/jpeg', 0.92)

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

  const frameSignatureFromVideo = () => {
    const video = videoRef.current
    if (!video || video.videoWidth === 0 || video.videoHeight === 0) return null

    const signatureCanvas = document.createElement('canvas')
    signatureCanvas.width = 90
    signatureCanvas.height = 120
    const ctx = signatureCanvas.getContext('2d')
    if (!ctx) return null

    const targetAspect = signatureCanvas.width / signatureCanvas.height
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

    ctx.drawImage(video, sourceX, sourceY, sourceWidth, sourceHeight, 0, 0, signatureCanvas.width, signatureCanvas.height)
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

  const runOcrOnCanvases = async (canvases: HTMLCanvasElement[]) => {
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const res = await fetch('/api/cards/ocr', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: session?.access_token ? `Bearer ${session.access_token}` : ''
        },
        body: JSON.stringify({ images: canvases.map(canvasToImage) })
      })
      const data = await res.json()

      if (!res.ok) {
        if (data?.dailyScanLimitReached) {
          setRecognitionMessage(`Limite giornaliero free raggiunto: ${data.dailyScansUsed}/${data.dailyScansLimit} scan. Premium sblocca scan illimitate.`)
        } else if (data?.scanLimitReached) {
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
    if (pendingRecognition?.card_id === variant.card_id) return

    setRecognitionMessage(`Variante selezionata: ${variantLabel(variant)}. Recupero prezzo medio...`)
    const pricedVariant = await enrichCardWithLivePrice({
      ...variant,
      id: pendingRecognition?.id || variant.id
    })
    setPendingRecognition(pricedVariant)
    setRecognitionMessage(`Carta trovata: ${pricedVariant.name}. Conferma o scarta.`)
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
      candidateCanvas.width = sourceCanvas.width
      candidateCanvas.height = sourceCanvas.height
      const ctx = candidateCanvas.getContext('2d')
      if (!ctx) return Number.POSITIVE_INFINITY
      ctx.drawImage(image, 0, 0, candidateCanvas.width, candidateCanvas.height)

      const sourceData = sourceCanvas.getContext('2d')?.getImageData(0, 0, sourceCanvas.width, sourceCanvas.height)
      const candidateData = ctx.getImageData(0, 0, candidateCanvas.width, candidateCanvas.height)
      if (!sourceData || !candidateData) return Number.POSITIVE_INFINITY

      const regionDiff = (xRatio: number, yRatio: number, widthRatio: number, heightRatio: number) => {
        const startX = Math.max(0, Math.floor(sourceCanvas.width * xRatio))
        const startY = Math.max(0, Math.floor(sourceCanvas.height * yRatio))
        const endX = Math.min(sourceCanvas.width, Math.floor(startX + sourceCanvas.width * widthRatio))
        const endY = Math.min(sourceCanvas.height, Math.floor(startY + sourceCanvas.height * heightRatio))
        let diff = 0
        let count = 0

        for (let y = startY; y < endY; y += 2) {
          for (let x = startX; x < endX; x += 2) {
            const i = (y * sourceCanvas.width + x) * 4
            diff += Math.abs(sourceData.data[i] - candidateData.data[i])
            diff += Math.abs(sourceData.data[i + 1] - candidateData.data[i + 1])
            diff += Math.abs(sourceData.data[i + 2] - candidateData.data[i + 2])
            count += 1
          }
        }

        return count > 0 ? diff / (count * 3) : Number.POSITIVE_INFINITY
      }

      const fullCard = regionDiff(0, 0, 1, 1)
      const artBox = regionDiff(0.08, 0.11, 0.84, 0.5)
      const lowerBox = regionDiff(0.08, 0.58, 0.84, 0.25)

      return fullCard * 0.25 + artBox * 0.55 + lowerBox * 0.2
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

      return bestMatch && bestMatch.score > 1.6 ? bestMatch.card : null
    } catch {
      return null
    }
  }

  const addRecognizedCardToCollection = async (card: ScannedCard) => {
    if (!userId || adding) return

    setAdding('pending')

    const savedCard = {
      ...card,
      id: `${card.card_id || card.name || 'card'}-${Date.now()}-${Math.random()}`
    }

    try {
      await saveCardToCollection(savedCard)
      await refreshProgressAfterCollectionChange()

      setScannedCards(prev => [savedCard, ...prev])
      recognitionStreakRef.current = null
      lastConfirmedSignatureRef.current = pendingRecognitionSignatureRef.current
      pendingRecognitionSignatureRef.current = null
      setCarouselIndex(0)
      setPendingRecognition(null)
      scanCooldownUntilRef.current = Date.now() + 150
      setRecognitionMessage(`Carta aggiunta alla collezione: ${card.name}. Cambia carta e continuo.`)

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
    scanCooldownUntilRef.current = Date.now() + 120
    setPendingRecognition(null)
    setRecognitionMessage('Carta scartata. Tieni al centro la prossima carta.')
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
    canvas.width = scanCanvasSize.width
    canvas.height = scanCanvasSize.height
    setVideoSize({ width: canvas.width, height: canvas.height })
    ctx.imageSmoothingEnabled = true
    ctx.imageSmoothingQuality = 'high'

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
    const codeCropCanvas = document.createElement('canvas')
    codeCropCanvas.width = 900
    codeCropCanvas.height = 420
    const codeCropCtx = codeCropCanvas.getContext('2d')

    // Ritagli leggibili: effetto, nome e riga codice sono le zone piu utili per il match.
    const nameCropCanvas = document.createElement('canvas')
    nameCropCanvas.width = 980
    nameCropCanvas.height = 540
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
        index * 140,
        codeCropCanvas.width,
        140
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
    preprocessedCode.width = 900
    preprocessedCode.height = 420
    preprocessForOcr(codeCropCanvas, preprocessedCode)

    if (!ocrReady) {
      setRecognitionMessage('Inizializzo il riconoscimento del testo...')
      return
    }

    const fastOcrCanvas = document.createElement('canvas')
    fastOcrCanvas.width = 1040
    fastOcrCanvas.height = 1000
    const fastOcrCtx = fastOcrCanvas.getContext('2d')
    if (!fastOcrCtx) return
    fastOcrCtx.imageSmoothingEnabled = true
    fastOcrCtx.imageSmoothingQuality = 'high'
    fastOcrCtx.fillStyle = '#ffffff'
    fastOcrCtx.fillRect(0, 0, fastOcrCanvas.width, fastOcrCanvas.height)
    fastOcrCtx.drawImage(codeCropCanvas, 0, 0, fastOcrCanvas.width, 240)
    fastOcrCtx.drawImage(preprocessedCode, 0, 240, fastOcrCanvas.width, 240)
    fastOcrCtx.drawImage(nameCropCanvas, 0, 480, fastOcrCanvas.width, 520)

    const imageMatchCanvas = document.createElement('canvas')
    imageMatchCanvas.width = 420
    imageMatchCanvas.height = 588
    const imageMatchCtx = imageMatchCanvas.getContext('2d')
    if (imageMatchCtx) {
      imageMatchCtx.imageSmoothingEnabled = true
      imageMatchCtx.imageSmoothingQuality = 'high'
      imageMatchCtx.drawImage(canvas, rect.x, rect.y, rect.width, rect.height, 0, 0, imageMatchCanvas.width, imageMatchCanvas.height)
    }

    const fullCardOcrCanvas = document.createElement('canvas')
    fullCardOcrCanvas.width = 820
    fullCardOcrCanvas.height = 1148
    const fullCardOcrCtx = fullCardOcrCanvas.getContext('2d')
    if (fullCardOcrCtx) {
      fullCardOcrCtx.imageSmoothingEnabled = true
      fullCardOcrCtx.imageSmoothingQuality = 'high'
      fullCardOcrCtx.drawImage(canvas, rect.x, rect.y, rect.width, rect.height, 0, 0, fullCardOcrCanvas.width, fullCardOcrCanvas.height)
    }

    const ocrText = await runOcrOnCanvases([
      fastOcrCanvas,
      fullCardOcrCanvas
    ])
    if (!isScanStillActive(generation)) return
    if (ocrText === null) {
      recognitionStreakRef.current = null
      scanCooldownUntilRef.current = Date.now() + 500
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
    if (cardMatch) {
      if (!shouldShowRecognizedCard(cardMatch, allOcrText)) {
        setRecognitionMessage(`Possibile carta: ${cardMatch.name}. Verifico un altro frame...`)
        scanCooldownUntilRef.current = Date.now() + 90
        return
      }

      pendingRecognitionSignatureRef.current = frameSignature
      setPendingRecognition(cardMatch)
      setRecognitionMessage(`Carta trovata: ${cardMatch.name}. Aggiungila alla collezione o scartala.`)
      enrichPendingPriceInBackground(cardMatch, generation)
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
      await activateCameraStream(streamRef.current)
      return
    }

    try {
      const stream = await openCameraStream(selectedCameraId)
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

  const switchCameraDevice = async () => {
    if (!navigator.mediaDevices?.getUserMedia || !cameraActive) return

    try {
      setRecognitionMessage('Cambio camera...')
      const devices = cameraDevices.length > 0 ? cameraDevices : await refreshCameraDevices()
      if (devices.length <= 1) {
        setRecognitionMessage('Nessun altra camera disponibile su questo dispositivo.')
        return
      }

      const currentTrack = streamRef.current?.getVideoTracks()[0]
      const currentDeviceId = currentTrack?.getSettings?.().deviceId || selectedCameraId
      const currentIndex = Math.max(0, devices.findIndex(device => device.deviceId === currentDeviceId))
      const nextDevice = devices[(currentIndex + 1) % devices.length]
      if (!nextDevice?.deviceId) return

      scanGenerationRef.current += 1
      detectionInProgressRef.current = false
      streamRef.current?.getTracks().forEach(track => track.stop())
      streamRef.current = null
      setSelectedCameraId(nextDevice.deviceId)

      const stream = await openCameraStream(nextDevice.deviceId)
      await activateCameraStream(stream)
      setRecognitionMessage(`Camera cambiata${nextDevice.label ? `: ${nextDevice.label}` : ''}. Tieni la carta al centro.`)
    } catch (err) {
      console.error('Switch camera error:', err)
      setRecognitionMessage('Cambio camera non riuscito. Riprova o riapri lo scanner.')
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
    setSelectedCameraId(null)
    setCameraError(null)
    setScanSessionActive(false)
    setShowSummary(true)
    setPendingRecognition(null)
    pendingRecognitionSignatureRef.current = null
    lastConfirmedSignatureRef.current = null
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
          quantity: existing.quantity + 1,
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
          quantity: 1
        })

      if (error) throw error
    }
  }

  const refreshProgressAfterCollectionChange = async () => {
    if (!userId) return

    const { data } = await supabase
      .from('user_cards')
      .select('card_id, quantity, name, rarity, card_color, card_type, card_cost, card_power, market_price, inventory_price')
      .eq('user_id', userId)

    void evaluateProgressSynced(userId, data || [], { claimDaily: true })
  }

  const discardScanResults = () => {
    setScannedCards([])
    setCarouselIndex(0)
    setShowSummary(false)
    setRecognitionMessage('Riepilogo chiuso.')
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
                        <p className="mt-2 text-sm text-slate-400">Premi avvia scan per iniziare a tracciare i tuoi pacchetti con la camera.</p>
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
                  <div className="grid grid-cols-[1fr_auto] gap-2">
                    <button
                      onClick={stopCamera}
                      className="rounded-2xl border border-red-400/50 bg-red-500/15 px-4 py-3 text-sm font-extrabold uppercase tracking-[0.18em] text-red-200 shadow-lg shadow-red-950/20 transition hover:bg-red-500/25"
                    >
                      Vai ai risultati
                    </button>
                    <button
                      onClick={switchCameraDevice}
                      className="grid h-full min-h-12 w-14 place-items-center rounded-2xl border border-cyan-300/40 bg-cyan-300/12 text-cyan-100 shadow-lg shadow-cyan-950/15 transition hover:bg-cyan-300/20 disabled:opacity-40"
                      disabled={cameraDevices.length <= 1}
                      title="Cambia camera"
                      aria-label="Cambia camera"
                    >
                      <SwitchCamera size={20} />
                    </button>
                  </div>
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
                          <span>{displayCardId(currentCard.card_id)}</span>
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
                  <p className="text-center text-[10px] uppercase tracking-[0.35em] text-amber-300">Carta rilevata</p>
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

                  <div className="mt-3 rounded-2xl border border-cyan-300/25 bg-cyan-300/10 px-3 py-2 text-center">
                    <p className="text-[10px] uppercase tracking-[0.3em] text-slate-400">Prezzo Medio</p>
                    <p className="mt-1 text-2xl font-black text-cyan-200">
                      {formatPrice(pendingRecognition.market_price ?? pendingRecognition.inventory_price ?? 0)}
                    </p>
                  </div>

                  <p className="mt-3 text-center text-sm text-slate-300">
                    Questa è la carta che hai appena scansionato?
                  </p>
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
                      disabled={adding === 'pending'}
                      className="flex-1 rounded-2xl border border-emerald-500/40 bg-emerald-500/20 px-3 py-3 text-sm font-bold text-emerald-300 transition hover:bg-emerald-500/30 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {adding === 'pending' ? 'Aggiungo...' : 'Aggiungi alla collezione'}
                    </button>
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
