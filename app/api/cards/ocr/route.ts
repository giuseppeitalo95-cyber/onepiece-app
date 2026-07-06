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
    const image = body?.image || body?.dataUrl || body?.base64Image

    if (!image) {
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
        requests: [
          {
            image: {
              content: imageToBase64(image)
            },
            features: [
              {
                type: 'DOCUMENT_TEXT_DETECTION',
                maxResults: 1
              },
              {
                type: 'WEB_DETECTION',
                maxResults: 10
              }
            ],
            imageContext: {
              languageHints: ['en']
            }
          }
        ]
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
    const result = data?.responses?.[0]

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

    const text = result?.fullTextAnnotation?.text || result?.textAnnotations?.[0]?.description || ''
    const webDetection = result?.webDetection || {}
    const webTextParts = [
      ...(webDetection?.bestGuessLabels || []).map((item: any) => item?.label),
      ...(webDetection?.webEntities || []).map((item: any) => item?.description),
      ...(webDetection?.fullMatchingImages || []).map((item: any) => item?.url),
      ...(webDetection?.partialMatchingImages || []).map((item: any) => item?.url),
      ...(webDetection?.visuallySimilarImages || []).map((item: any) => item?.url),
      ...(webDetection?.pagesWithMatchingImages || []).flatMap((item: any) => [
        item?.url,
        item?.pageTitle
      ])
    ].filter(Boolean)

    return Response.json({
      text: [text, ...webTextParts].join('\n'),
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
    if (!adminSupabase) {
      return Response.json(
        { scansUsed: 0, scansLimit: MONTHLY_SCAN_LIMIT, error: 'Missing SUPABASE_SERVICE_ROLE_KEY' },
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
        { scansUsed: 0, scansLimit: MONTHLY_SCAN_LIMIT, error: error.message },
        { status: 503 }
      )
    }

    return Response.json({
      month,
      scansUsed: Number(data?.scan_count || 0),
      scansLimit: MONTHLY_SCAN_LIMIT
    })
  } catch (error) {
    console.error('Scan usage read error:', error)
    return Response.json({ scansUsed: 0, scansLimit: MONTHLY_SCAN_LIMIT, error: 'Scan usage read error' }, { status: 500 })
  }
}
