import { NextRequest } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { FREE_DAILY_SCAN_LIMIT, getPremiumTier } from '@/lib/premium'
import { DEFAULT_MONTHLY_SCAN_LIMIT, readMonthlyScanLimit } from '@/lib/scanLimit'

export const runtime = 'edge'
export const preferredRegion = 'fra1'
export const dynamic = 'force-dynamic'

const DEFAULT_SUPABASE_URL = 'https://jxwgbzatdueefdiyxlns.supabase.co'
const GOOGLE_CLOUD_PROJECT = process.env.GOOGLE_CLOUD_PROJECT || process.env.GCLOUD_PROJECT || 'onepieceapp-494016'
const GOOGLE_METADATA_TOKEN_URL = 'http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token'

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
let googleAccessTokenCache: { token: string; expiresAt: number } | null = null

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
  return uniqueLines(ocrParts.join('\n'))
}

async function reserveMonthlyScan() {
  if (!adminSupabase) {
    return {
      allowed: false,
      used: 0,
      limit: DEFAULT_MONTHLY_SCAN_LIMIT,
      error: 'Missing SUPABASE_SERVICE_ROLE_KEY'
    }
  }

  const monthlyLimit = await readMonthlyScanLimit(adminSupabase)
  const { data, error } = await adminSupabase
    .rpc('increment_global_scan_usage', {
      p_month: currentMonthKey(),
      p_limit: monthlyLimit
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
      limit: monthlyLimit,
      error: error.message
    }
  }

  const usage = data as ScanUsageResult | null

  return {
    allowed: Boolean(usage?.allowed),
    used: Number(usage?.used || 0),
    limit: Number(usage?.monthly_limit || monthlyLimit),
    error: null
  }
}

const wait = (milliseconds: number) => new Promise(resolve => setTimeout(resolve, milliseconds))

async function getGoogleCloudAccessToken() {
  if (!process.env.K_SERVICE) return null
  if (googleAccessTokenCache && googleAccessTokenCache.expiresAt > Date.now() + 60_000) {
    return googleAccessTokenCache.token
  }

  try {
    const response = await fetch(GOOGLE_METADATA_TOKEN_URL, {
      headers: { 'Metadata-Flavor': 'Google' },
      cache: 'no-store',
    })
    if (!response.ok) return null
    const data = await response.json()
    const token = typeof data?.access_token === 'string' ? data.access_token : ''
    if (!token) return null
    googleAccessTokenCache = {
      token,
      expiresAt: Date.now() + Math.max(60, Number(data?.expires_in || 3000)) * 1000,
    }
    return token
  } catch (error) {
    console.error('Google metadata token error:', error)
    return null
  }
}

async function requestGoogleVision(payload: unknown) {
  const accessToken = await getGoogleCloudAccessToken()
  const url = accessToken
    ? 'https://vision.googleapis.com/v1/images:annotate'
    : `https://vision.googleapis.com/v1/images:annotate?key=${googleVisionApiKey}`
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }

  if (accessToken) {
    headers.Authorization = `Bearer ${accessToken}`
    headers['x-goog-user-project'] = GOOGLE_CLOUD_PROJECT
  }

  let response = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(payload),
    cache: 'no-store',
  })

  if (response.status === 429) {
    await wait(650)
    response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
      cache: 'no-store',
    })
  }

  return { response, authentication: accessToken ? 'service-account' : 'api-key' }
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
    .select('username, is_premium, premium_until, is_vip, vip_note')
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

async function checkDailyUserScan(req: NextRequest) {
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
    .from('user_scan_usage_daily')
    .select('scan_count')
    .eq('user_id', access.userId)
    .eq('day', currentDayKey())
    .maybeSingle()

  if (error) {
    return {
      allowed: false,
      used: 0,
      limit: FREE_DAILY_SCAN_LIMIT,
      error: `${error.message}. Esegui premium.sql su Supabase.`
    }
  }

  const used = Number(data?.scan_count || 0)
  return {
    allowed: used < FREE_DAILY_SCAN_LIMIT,
    used,
    limit: FREE_DAILY_SCAN_LIMIT,
    error: null
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const ocrMode = body?.mode === 'photo'
      ? 'photo'
      : body?.mode === 'accurate'
        ? 'accurate'
        : 'fast'

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

    if (body?.confirm === true) {
      const dailyUsage = await reserveDailyUserScan(req)
      return Response.json(
        {
          confirmed: dailyUsage.allowed,
          error: dailyUsage.error,
          dailyScanLimitReached: !dailyUsage.allowed && !dailyUsage.error,
          dailyScansUsed: dailyUsage.used,
          dailyScansLimit: dailyUsage.limit
        },
        { status: dailyUsage.allowed ? 200 : dailyUsage.error ? 503 : 429 }
      )
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

    const dailyUsage = await checkDailyUserScan(req)
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

    const visionPayload = {
      requests: images.map((image: string) => ({
        image: {
          content: imageToBase64(image)
        },
        features: [
          {
            type: ocrMode === 'fast' ? 'TEXT_DETECTION' : 'DOCUMENT_TEXT_DETECTION',
            maxResults: 50
          }
        ],
        imageContext: {
          languageHints: ['en']
        }
      }))
    }
    const { response, authentication } = await requestGoogleVision(visionPayload)

    if (!response.ok) {
      const message = await response.text()
      console.error('Google Vision HTTP error:', response.status, message)
      return Response.json(
        {
          text: '',
          error: 'Google Vision request failed',
          googleStatus: response.status,
          googleMessage: message,
          googleAuthentication: authentication,
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
      serviceRoleConfigured: Boolean(adminSupabase)
    }

    if (!adminSupabase) {
      return Response.json(
        {
          ...baseStatus,
          scansUsed: 0,
          scansLimit: DEFAULT_MONTHLY_SCAN_LIMIT,
          error: 'Missing SUPABASE_SERVICE_ROLE_KEY'
        },
        { status: 503 }
      )
    }

    const month = currentMonthKey()
    const [limit, usage] = await Promise.all([
      readMonthlyScanLimit(adminSupabase),
      adminSupabase.from('scan_usage_global').select('scan_count').eq('month', month).maybeSingle()
    ])

    if (usage.error) {
      return Response.json(
        {
          ...baseStatus,
          scansUsed: 0,
          scansLimit: limit,
          error: usage.error.message
        },
        { status: 503 }
      )
    }

    return Response.json({
      ...baseStatus,
      month,
      scansUsed: Number(usage.data?.scan_count || 0),
      scansLimit: limit,
      error: googleVisionApiKey ? null : 'Missing GOOGLE_VISION_API_KEY'
    })
  } catch (error) {
    console.error('Scan usage read error:', error)
    return Response.json(
      {
        googleVisionConfigured: Boolean(googleVisionApiKey),
        serviceRoleConfigured: Boolean(adminSupabase),
        scansUsed: 0,
        scansLimit: DEFAULT_MONTHLY_SCAN_LIMIT,
        error: 'Scan usage read error'
      },
      { status: 500 }
    )
  }
}
