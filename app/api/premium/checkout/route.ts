import { NextRequest } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const DEFAULT_SUPABASE_URL = 'https://jxwgbzatdueefdiyxlns.supabase.co'
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || DEFAULT_SUPABASE_URL
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJqd3hnYnphdGR1ZWVmZGl5eGxucyIsInJlZiI6Imp4d2diemF0ZHVlZWZkaXl4bG5zIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzY3NzMwNjMsImV4cCI6MjA5MjM0OTA2M30.8HFzw4B9i2wB8cBuuG-gR9xEswt8kp-QyA8zqvd6YRQ'

const stripeSecretKey = process.env.STRIPE_SECRET_KEY
const stripePriceId = process.env.STRIPE_PREMIUM_PRICE_ID

export async function POST(req: NextRequest) {
  if (!stripeSecretKey || !stripePriceId) {
    return Response.json({
      error: 'Pagamento non ancora configurato: aggiungi STRIPE_SECRET_KEY e STRIPE_PREMIUM_PRICE_ID su Vercel.'
    }, { status: 503 })
  }

  const authHeader = req.headers.get('authorization') || ''
  const token = authHeader.replace(/^Bearer\s+/i, '')
  if (!token) {
    return Response.json({ error: 'Devi effettuare l accesso.' }, { status: 401 })
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false }
  })

  const { data: { user }, error } = await supabase.auth.getUser(token)
  if (error || !user) {
    return Response.json({ error: 'Sessione non valida.' }, { status: 401 })
  }

  const origin = req.headers.get('origin') || new URL(req.url).origin
  const body = new URLSearchParams()
  body.set('mode', 'subscription')
  body.set('line_items[0][price]', stripePriceId)
  body.set('line_items[0][quantity]', '1')
  body.set('success_url', `${origin}/premium/success`)
  body.set('cancel_url', `${origin}/premium/cancel`)
  body.set('client_reference_id', user.id)
  body.set('customer_email', user.email || '')
  body.set('metadata[user_id]', user.id)
  body.set('subscription_data[metadata][user_id]', user.id)
  body.set('allow_promotion_codes', 'true')

  const stripeRes = await fetch('https://api.stripe.com/v1/checkout/sessions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${stripeSecretKey}`,
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body
  })

  const data = await stripeRes.json()
  if (!stripeRes.ok) {
    return Response.json({ error: data?.error?.message || 'Stripe non disponibile.' }, { status: 502 })
  }

  return Response.json({ url: data.url })
}
