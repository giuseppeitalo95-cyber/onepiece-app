import { NextRequest } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { FREE_DAILY_SCAN_LIMIT, getPremiumTier } from '@/lib/premium'

export const runtime = 'edge'
export const preferredRegion = 'fra1'
export const dynamic = 'force-dynamic'

const MONTHLY_SCAN_LIMIT = 1000
const DEFAULT_SUPABASE_URL = 'https://jxwgbzatdueefdiyxlns.supabase.co'

const getValidSupabaseUrl = () => {
  const value = process.env.NEXT_PUBLIC_SUPABASE_URL || DEFAULT_SUPABASE_URL

  try {
    const url = new URL(value)
    if (url.protocol === 'http:' || url.protocol === 'https:') return value
  } catch {
    return DEFAULT_SUPABASE_URL
  }

  return DEFAULT_SUPABASE_URL
}

const supabaseUrl = getValidSupabaseUrl()
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
const googleVisionApiKey = process.env.GOOGLE_VISION_API_KEY
const scanAccessCache = new Map<string, { userId: string; tier: string; expiresAt: number }>()

type ScanUsageResult = {
  allowed?: boolean
  used?: number
  monthly_limit?: number
}

type DailyScanUsageResult = {
  allowed?: boolean
  used?: number
  daily_limit?: number
}

type ScanAccessResult = {
  userId?: string
  tier?: string
  error?: string | null
}

const adminSupabase = supabaseServiceRoleKey
  ? createClient(supabaseUrl, supabaseServiceRoleKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false
      }
    })
  : null

const currentMonthKey = () => {
  const now = new Date()
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`
}

const currentDayKey = () => {
  const now = new Date()
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}-${String(now.getUTCDate()).padStart(2, '0')}`
}

const imageToBase64 = (image: string) => {
  const commaIndex = image.indexOf(',')
  return commaIndex >= 0 ? image.slice(commaIndex + 1) : image
}

const uniqueLines = (value: string) => {
  const seen = new Set<string>()
  return value
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean)
    .filter(line => {
      const key = line.toLowerCase()
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
    .join('\n')
}

const extractVisionText = (result: any) => {
  const ocrParts = [
    result?.fullTextAnnotation?.text,
    result?.textAnnotations?.[0]?.description,
  ].filter(Boolean)
  const ocrText = uniqueLines(ocrParts.join('\n'))
  if (ocrText.trim()) return ocrText

  const webParts = [
    ...(result?.webDetection?.bestGuessLabels || []).map((item: any) => item?.label),
    ...(result?.webDetection?.webEntities || []).map((item: any) => item?.description),
  ].filter(Boolean)

  return uniqueLines(webParts.join('\n'))
}

async function reserveMonthlyScan() {
  if (!adminSupabase) {
    return {
      allowed: false,
      used: 0,
      limit: MONTHLY_SCAN_LIMIT,
      error: 'Missing SUPABASE_SERVICE_ROLE_KEY'
    }
  }

  const { data, error } = await adminSupabase
    .rpc('increment_global_scan_usage', {
      p_month: currentMonthKey(),
      p_limit: MONTHLY_SCAN_LIMIT
    })
    .single()

  if (error) {
    if (/increment_user_daily_scan_usage|function|schema cache|does not exist|Could not find/i.test(error.message)) {
      return {
        allowed: true,
        used: 0,
        limit: FREE_DAILY_SCAN_LIMIT,
        error: null
      }
    }

    return {
      allowed: false,
      used: 0,
      limit: MONTHLY_SCAN_LIMIT,
      error: error.message
    }
  }

  const usage = data as ScanUsageResult | null

  return {
    allowed: Boolean(usage?.allowed),
    used: Number(usage?.used || 0),
    limit: Number(usage?.monthly_limit || MONTHLY_SCAN_LIMIT),
    error: null
  }
}

async function resolveScanAccess(req: NextRequest): Promise<ScanAccessResult> {
  if (!adminSupabase) {
    return {
      error: 'Missing SUPABASE_SERVICE_ROLE_KEY'
    }
  }

  const auth = req.headers.get('authorization') || ''
  const token = auth.replace(/^Bearer\s+/i, '')
  if (!token) {
    return {
      error: 'Sessione utente mancante'
    }
  }

  const cachedAccess = scanAccessCache.get(token)
  if (cachedAccess && cachedAccess.expiresAt > Date.now()) {
    return {
      userId: cachedAccess.userId,
      tier: cachedAccess.tier,
      error: null
    }
  }
  if (cachedAccess) scanAccessCache.delete(token)

  const { data: { user }, error: userError } = await adminSupabase.auth.getUser(token)
  if (userError || !user) {
    return {
      error: 'Sessione utente non valida'
    }
  }

  const { data: profile } = await adminSupabase
    .from('profiles')
    .select('username, is_premium, premium_until, is_vip')
    .eq('id', user.id)
    .maybeSingle()

  const tier = getPremiumTier(profile, user)
  if (scanAccessCache.size > 500) {
    const now = Date.now()
    for (const [key, value] of scanAccessCache) {
      if (value.expiresAt <= now) scanAccessCache.delete(key)
    }
  }
  scanAccessCache.set(token, {
    userId: user.id,
    tier,
    expiresAt: Date.now() + 10 * 60_000
  })

  return {
    userId: user.id,
    tier,
    error: null
  }
}

async function reserveDailyUserScan(req: NextRequest) {
  if (!adminSupabase) {
    return {
      allowed: false,
      used: 0,
      limit: FREE_DAILY_SCAN_LIMIT,
      error: 'Missing SUPABASE_SERVICE_ROLE_KEY'
    }
  }

  const access = await resolveScanAccess(req)
  if (access.error || !access.userId || !access.tier) {
    return {
      allowed: false,
      used: 0,
      limit: FREE_DAILY_SCAN_LIMIT,
      error: access.error || 'Sessione utente non valida'
    }
  }

  if (access.tier !== 'free') {
    return {
      allowed: true,
      used: 0,
      limit: Number.POSITIVE_INFINITY,
      error: null
    }
  }

  const { data, error } = await adminSupabase
    .rpc('increment_user_daily_scan_usage', {
      p_user_id: access.userId,
      p_day: currentDayKey(),
      p_limit: FREE_DAILY_SCAN_LIMIT
    })
    .single()

  if (error) {
    return {
      allowed: false,
      used: 0,
      limit: FREE_DAILY_SCAN_LIMIT,
      error: `${error.message}. Esegui premium.sql su Supabase.`
    }
  }

  const usage = data as DailyScanUsageResult | null
  return {
    allowed: Boolean(usage?.allowed),
    used: Number(usage?.used || 0),
    limit: Number(usage?.daily_limit || FREE_DAILY_SCAN_LIMIT),
    error: null
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const ocrMode = body?.mode === 'accurate' ? 'accurate' : 'fast'

    if (!googleVisionApiKey) {
      return Response.json({ text: '', error: 'Missing GOOGLE_VISION_API_KEY' }, { status: 503 })
    }

    if (body?.warmup === true) {
      const access = await resolveScanAccess(req)
      if (access.error) {
        return Response.json({ ready: false, error: access.error }, { status: 401 })
      }
      return Response.json({ ready: true })
    }

    const rawImages = Array.isArray(body?.images)
      ? body.images
      : [body?.image || body?.dataUrl || body?.base64Image]

    const images = rawImages
      .filter((image: unknown): image is string => typeof image === 'string' && image.length > 0)
      .slice(0, 2)

    if (images.length === 0) {
      return Response.json({ text: '', error: 'Missing image' }, { status: 400 })
    }

    const dailyUsage = await reserveDailyUserScan(req)
    if (!dailyUsage.allowed) {
      return Response.json(
        {
          text: '',
          error: dailyUsage.error || 'Daily scan limit reached',
          dailyScanLimitReached: !dailyUsage.error,
          dailyScansUsed: dailyUsage.used,
          dailyScansLimit: dailyUsage.limit
        },
        { status: dailyUsage.error ? 503 : 429 }
      )
    }

    const usage = await reserveMonthlyScan()
    if (!usage.allowed) {
      return Response.json(
        {
          text: '',
          error: usage.error || 'Monthly scan limit reached',
          scanLimitReached: !usage.error,
          scansUsed: usage.used,
          scansLimit: usage.limit
        },
        { status: usage.error ? 503 : 429 }
      )
    }

    const response = await fetch(`https://vision.googleapis.com/v1/images:annotate?key=${googleVisionApiKey}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        requests: images.map((image: string) => ({
            image: {
              content: imageToBase64(image)
            },
            features: [
              {
                type: ocrMode === 'accurate' ? 'DOCUMENT_TEXT_DETECTION' : 'TEXT_DETECTION',
                maxResults: 50
              }
            ],
            imageContext: {
              languageHints: ['en']
            }
          }))
      })
    })

    if (!response.ok) {
      const message = await response.text()
      console.error('Google Vision HTTP error:', response.status, message)
      return Response.json(
        {
          text: '',
          error: 'Google Vision request failed',
          googleStatus: response.status,
          googleMessage: message,
          scansUsed: usage.used,
          scansLimit: usage.limit
        },
        { status: response.status }
      )
    }

    const data = await response.json()
    const responses = data?.responses || []
    const result = responses.find((item: any) => item?.error) || responses[0]

    if (result?.error) {
      console.error('Google Vision API error:', result.error)
      return Response.json(
        {
          text: '',
          error: result.error.message || 'Google Vision returned an error',
          scansUsed: usage.used,
          scansLimit: usage.limit
        },
        { status: 502 }
      )
    }

    const text = uniqueLines(responses.map(extractVisionText).filter(Boolean).join('\n'))

    return Response.json({
      text,
      scansUsed: usage.used,
      scansLimit: usage.limit
    })
  } catch (error) {
    console.error('Google Vision OCR proxy error:', error)
    return Response.json({ text: '', error: 'OCR proxy error' }, { status: 500 })
  }
}

export async function GET() {
  try {
    const baseStatus = {
      googleVisionConfigured: Boolean(googleVisionApiKey),
      serviceRoleConfigured: Boolean(adminSupabase),
      scansLimit: MONTHLY_SCAN_LIMIT
    }

    if (!adminSupabase) {
      return Response.json(
        {
          ...baseStatus,
          scansUsed: 0,
          error: 'Missing SUPABASE_SERVICE_ROLE_KEY'
        },
        { status: 503 }
      )
    }

    const month = currentMonthKey()
    const { data, error } = await adminSupabase
      .from('scan_usage_global')
      .select('scan_count')
      .eq('month', month)
      .maybeSingle()

    if (error) {
      return Response.json(
        {
          ...baseStatus,
          scansUsed: 0,
          error: error.message
        },
        { status: 503 }
      )
    }

    return Response.json({
      ...baseStatus,
      month,
      scansUsed: Number(data?.scan_count || 0),
      error: googleVisionApiKey ? null : 'Missing GOOGLE_VISION_API_KEY'
    })
  } catch (error) {
    console.error('Scan usage read error:', error)
    return Response.json(
      {
        googleVisionConfigured: Boolean(googleVisionApiKey),
        serviceRoleConfigured: Boolean(adminSupabase),
        scansUsed: 0,
        scansLimit: MONTHLY_SCAN_LIMIT,
        error: 'Scan usage read error'
      },
      { status: 500 }
    )
  }
}
