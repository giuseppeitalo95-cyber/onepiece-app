import { NextRequest } from 'next/server'

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const target = searchParams.get('url')

  if (!target) {
    return new Response('Missing url', { status: 400 })
  }

  try {
    const upstream = await fetch(target, {
      headers: {
        'User-Agent': 'Mozilla/5.0'
      }
    })

    if (!upstream.ok) {
      return new Response('Upstream image unavailable', { status: upstream.status })
    }

    const buffer = Buffer.from(await upstream.arrayBuffer())
    const contentType = upstream.headers.get('content-type') || 'image/jpeg'

    return new Response(buffer, {
      status: 200,
      headers: {
        'Content-Type': contentType,
        'Cache-Control': 'public, max-age=2592000, s-maxage=2592000, stale-while-revalidate=86400'
      }
    })
  } catch (err) {
    console.error('Recognition image proxy error:', err)
    return new Response('Image proxy failed', { status: 500 })
  }
}
