import { NextRequest } from 'next/server'

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const image = body?.image || body?.dataUrl || body?.base64Image

    if (!image) {
      return Response.json({ text: '' }, { status: 400 })
    }

    const params = new URLSearchParams()
    params.set('apikey', 'helloworld')
    params.set('language', 'eng')
    params.set('isOverlayRequired', 'false')
    params.set('detectOrientation', 'true')
    params.set('OCREngine', '2')
    params.set('base64Image', image)

    const response = await fetch('https://api.ocr.space/parse/image', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8'
      },
      body: params.toString()
    })

    if (!response.ok) {
      return Response.json({ text: '' }, { status: response.status })
    }

    const data = await response.json()
    const text = data?.ParsedResults?.[0]?.ParsedText || ''
    return Response.json({ text })
  } catch (error) {
    console.error('OCR proxy error:', error)
    return Response.json({ text: '' }, { status: 500 })
  }
}
