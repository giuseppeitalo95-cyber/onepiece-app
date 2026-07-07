import { getAllCards } from '@/lib/cardData'

export async function GET() {
  try {
    return Response.json(await getAllCards(), {
      headers: {
        'Cache-Control': 'public, max-age=900, stale-while-revalidate=3600'
      }
    })
  } catch (err) {
    console.error('Recognition candidates error:', err)
    return Response.json([], { status: 500 })
  }
}
