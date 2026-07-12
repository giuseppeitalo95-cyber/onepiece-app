import { NextRequest } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const DEFAULT_SUPABASE_URL = 'https://jxwgbzatdueefdiyxlns.supabase.co'
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || DEFAULT_SUPABASE_URL
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imp4d2diemF0ZHVlZWZkaXl4bG5zIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzY3NzMwNjMsImV4cCI6MjA5MjM0OTA2M30.8HFzw4B9i2wB8cBuuG-gR9xEswt8kp-QyA8zqvd6YRQ'
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
const stripeSecretKey = process.env.STRIPE_SECRET_KEY

export async function POST(req: NextRequest) {
  if (!stripeSecretKey) {
    return Response.json({ error: 'Portale abbonamento non configurato.' }, { status: 503 })
  }

  const authHeader = req.headers.get('authorization') || ''
  const token = authHeader.replace(/^Bearer\s+/i, '')
  if (!token) {
    return Response.json({ error: 'Devi effettuare l accesso.' }, { status: 401 })
  }

  const authClient = createClient(SUPABASE_URL, supabaseServiceRoleKey || SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false }
  })

  const { data: { user }, error: userError } = await authClient.auth.getUser(token)
  if (userError || !user) {
    return Response.json({ error: 'Sessione non valida.' }, { status: 401 })
  }

  const dbClient = createClient(SUPABASE_URL, supabaseServiceRoleKey || SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false }
  })

  const { data: profile, error: profileError } = await dbClient
    .from('profiles')
    .select('stripe_customer_id, premium_source, is_vip')
    .eq('id', user.id)
    .maybeSingle()

  if (profileError) {
    return Response.json({ error: 'Non riesco a leggere il profilo abbonamento.' }, { status: 500 })
  }

  const customerId = profile?.stripe_customer_id
  if (!customerId) {
    return Response.json({ error: 'Nessun abbonamento Stripe collegato a questo account.' }, { status: 404 })
  }

  const origin = req.headers.get('origin') || new URL(req.url).origin
  const body = new URLSearchParams()
  body.set('customer', customerId)
  body.set('return_url', `${origin}/premium`)

  const stripeRes = await fetch('https://api.stripe.com/v1/billing_portal/sessions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${stripeSecretKey}`,
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body
  })

  const data = await stripeRes.json()
  if (!stripeRes.ok) {
    return Response.json({ error: data?.error?.message || 'Portale Stripe non disponibile.' }, { status: 502 })
  }

  return Response.json({ url: data.url })
}
