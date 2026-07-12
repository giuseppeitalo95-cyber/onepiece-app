import { createClient } from '@supabase/supabase-js'

export const dynamic = 'force-dynamic'

const DEFAULT_SUPABASE_URL = 'https://jxwgbzatdueefdiyxlns.supabase.co'
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || DEFAULT_SUPABASE_URL
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY

const adminSupabase = serviceRoleKey
  ? createClient(SUPABASE_URL, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false }
    })
  : null

export async function POST() {
  if (!adminSupabase) {
    return Response.json({ ok: false, error: 'Missing SUPABASE_SERVICE_ROLE_KEY' }, { status: 500 })
  }

  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
  const { error } = await adminSupabase
    .from('chat_messages')
    .delete()
    .lt('created_at', cutoff)

  if (error) {
    return Response.json({ ok: false, error: error.message }, { status: 500 })
  }

  return Response.json({ ok: true })
}

export async function GET() {
  return POST()
}
