import { getAllCards } from '@/lib/cardData'

export async function GET() {
  try {
    return Response.json(await getAllCards())
  } catch (err) {
    console.error('Recognition candidates error:', err)
    return Response.json([], { status: 500 })
  }
}
