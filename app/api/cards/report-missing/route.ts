import { supabase } from '@/lib/supabase'

export async function POST(req: Request) {
  try {
    const body = await req.json()
    const { card_name, card_op, card_number, user_id } = body

    if (!card_name || !card_op || !card_number) {
      return new Response(JSON.stringify({ error: 'Dati mancanti per la segnalazione.' }), { status: 400 })
    }

    const { error } = await supabase.from('missing_card_reports').insert([
      {
        card_name: card_name.trim(),
        card_op: card_op.trim(),
        card_number: card_number.trim(),
        reported_by: user_id || null,
        status: 'new',
        created_at: new Date().toISOString(),
      },
    ])

    if (error) {
      console.error('Report missing card error', error)
      return new Response(JSON.stringify({ error: error.message }), { status: 500 })
    }

    return new Response(JSON.stringify({ success: true }), { status: 201 })
  } catch (error) {
    console.error('Report missing card exception', error)
    return new Response(JSON.stringify({ error: 'Errore server' }), { status: 500 })
  }
}
