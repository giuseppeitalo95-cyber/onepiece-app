import { NextRequest } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const MONTHLY_SCAN_LIMIT = 1000

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://jxwgbzatdueefdiyxlns.supabase.co'
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
const googleVisionApiKey = process.env.GOOGLE_VISION_API_KEY

type ScanUsageResult = {
  allowed?: boolean
  used?: number
  monthly_limit?: number
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
  const textParts = [
    result?.fullTextAnnotation?.text,
    ...(result?.textAnnotations || []).map((item: any) => item?.description),
    ...(result?.webDetection?.bestGuessLabels || []).map((item: any) => item?.label),
    ...(result?.webDetection?.webEntities || []).map((item: any) => item?.description),
  ].filter(Boolean)

  return uniqueLines(textParts.join('\n'))
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

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const rawImages = Array.isArray(body?.images)
      ? body.images
      : [body?.image || body?.dataUrl || body?.base64Image]

    const images = rawImages
      .filter((image: unknown): image is string => typeof image === 'string' && image.length > 0)
      .slice(0, 6)

    if (images.length === 0) {
      return Response.json({ text: '', error: 'Missing image' }, { status: 400 })
    }

    if (!googleVisionApiKey) {
      return Response.json({ text: '', error: 'Missing GOOGLE_VISION_API_KEY' }, { status: 503 })
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
        requests: images.map((image: string, index: number) => ({
            image: {
              content: imageToBase64(image)
            },
            features: [
              {
                type: 'TEXT_DETECTION',
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
