import { NextRequest } from 'next/server'
import { assertSafeRemoteImageUrl, isR2Configured, isR2PublicUrl, mirrorCardImage } from '@/lib/r2Storage'

export const dynamic = 'force-dynamic'

const imageResponse = async (url: string, fallbackContentType = 'image/webp') => {
  const response = await fetch(url, {
    headers: { 'User-Agent': 'OnePieceVault/1.0' },
    cache: 'force-cache',
  })
  if (!response.ok) throw new Error(`Immagine non disponibile (${response.status})`)
  const contentType = response.headers.get('content-type') || fallbackContentType
  if (!contentType.startsWith('image/')) throw new Error('La sorgente non contiene una immagine')
  const buffer = Buffer.from(await response.arrayBuffer())
  if (buffer.length > 15_000_000) throw new Error('Immagine troppo grande')

  return new Response(buffer, {
    status: 200,
    headers: {
      'Content-Type': contentType,
      'Cache-Control': 'public, max-age=2592000, s-maxage=2592000, stale-while-revalidate=86400',
    },
  })
}

export async function GET(request: NextRequest) {
  const target = request.nextUrl.searchParams.get('url')
  const variantId = request.nextUrl.searchParams.get('id')
  if (!target) return new Response('Missing url', { status: 400 })

  try {
    assertSafeRemoteImageUrl(target)

    if (isR2PublicUrl(target) || !isR2Configured()) {
      return await imageResponse(target)
    }

    const catalogVariant = variantId?.match(/^((?:OP|ST|EB|PRB|SP|EX|CP)\d{2}|P|DON)-\d{3}(?:_p\d+)?$/i)?.[0]
    if (!catalogVariant) return await imageResponse(target)

    try {
      const mirrored = await mirrorCardImage({ sourceUrl: target, variantId: catalogVariant })
      return await imageResponse(mirrored.publicUrl)
    } catch (mirrorError) {
      console.warn('R2 image mirror fallback:', mirrorError)
      return await imageResponse(target, 'image/jpeg')
    }
  } catch (error) {
    console.error('Recognition image proxy error:', error)
    return new Response('Image proxy failed', { status: 502 })
  }
}
