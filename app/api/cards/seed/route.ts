import { NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'

const DATA_URL =
  'https://raw.githubusercontent.com/BlacksmithGuild/onepiece-card-game-data/main/cards.json'

export async function GET() {
  try {
    const res = await fetch(DATA_URL)
    const data = await res.json()

    const formatted = data.map((c: any) => ({
      id: c.id,
      name: c.name,
      image_url: c.image_url,
      rarity: c.rarity,
      type: c.type || null,
      cost: c.cost || null
    }))

    const { error } = await supabase.from('cards').upsert(formatted)

    if (error) {
      return NextResponse.json({ error }, { status: 500 })
    }

    return NextResponse.json({ ok: true, inserted: formatted.length })
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}