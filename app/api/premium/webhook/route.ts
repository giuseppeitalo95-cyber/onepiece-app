import { createHmac, timingSafeEqual } from 'crypto'
import { createClient } from '@supabase/supabase-js'

export const dynamic = 'force-dynamic'

const DEFAULT_SUPABASE_URL = 'https://jxwgbzatdueefdiyxlns.supabase.co'
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || DEFAULT_SUPABASE_URL
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET

const adminSupabase = serviceRoleKey
  ? createClient(SUPABASE_URL, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false }
    })
  : null

const verifyStripeSignature = (payload: string, signatureHeader: string) => {
  if (!webhookSecret) return false

  const parts = Object.fromEntries(
    signatureHeader.split(',').map(part => {
      const [key, value] = part.split('=')
      return [key, value]
    })
  )

  const timestamp = parts.t
  const signature = parts.v1
  if (!timestamp || !signature) return false

  const expected = createHmac('sha256', webhookSecret)
    .update(`${timestamp}.${payload}`)
    .digest('hex')

  const expectedBuffer = Buffer.from(expected, 'hex')
  const signatureBuffer = Buffer.from(signature, 'hex')
  return expectedBuffer.length === signatureBuffer.length && timingSafeEqual(expectedBuffer, signatureBuffer)
}

const activatePremium = async (userId: string, customerId?: string | null, subscriptionId?: string | null) => {
  if (!adminSupabase) throw new Error('Missing SUPABASE_SERVICE_ROLE_KEY')

  await adminSupabase
    .from('profiles')
    .update({
      is_premium: true,
      premium_since: new Date().toISOString(),
      premium_source: 'stripe',
      stripe_customer_id: customerId || null,
      stripe_subscription_id: subscriptionId || null
    })
    .eq('id', userId)
}

const deactivatePremiumBySubscription = async (subscriptionId: string) => {
  if (!adminSupabase) throw new Error('Missing SUPABASE_SERVICE_ROLE_KEY')

  await adminSupabase
    .from('profiles')
    .update({
      is_premium: false,
      premium_until: new Date().toISOString()
    })
    .eq('stripe_subscription_id', subscriptionId)
    .eq('is_vip', false)
}

const syncPremiumSubscription = async (subscription: any) => {
  if (!adminSupabase) throw new Error('Missing SUPABASE_SERVICE_ROLE_KEY')

  const subscriptionId = subscription?.id
  if (!subscriptionId) return

  const active = ['active', 'trialing'].includes(subscription?.status)
  const periodEnd = Number(subscription?.current_period_end || 0)
  const premiumUntil = subscription?.cancel_at_period_end && periodEnd > 0
    ? new Date(periodEnd * 1000).toISOString()
    : null

  await adminSupabase
    .from('profiles')
    .update({
      is_premium: active,
      premium_until: premiumUntil,
      premium_source: 'stripe',
      stripe_customer_id: subscription?.customer || null,
      stripe_subscription_id: subscriptionId
    })
    .eq('stripe_subscription_id', subscriptionId)
    .eq('is_vip', false)
}

export async function POST(req: Request) {
  const payload = await req.text()
  const signature = req.headers.get('stripe-signature') || ''

  if (!verifyStripeSignature(payload, signature)) {
    return Response.json({ ok: false, error: 'Invalid signature' }, { status: 401 })
  }

  const event = JSON.parse(payload)
  const object = event?.data?.object || {}

  try {
    if (event.type === 'checkout.session.completed') {
      const userId = object?.metadata?.user_id || object?.client_reference_id
      if (userId) {
        await activatePremium(userId, object?.customer, object?.subscription)
      }
    }

    if (event.type === 'customer.subscription.deleted') {
      if (object?.id) await deactivatePremiumBySubscription(object.id)
    }

    if (event.type === 'customer.subscription.updated') {
      await syncPremiumSubscription(object)
    }

    return Response.json({ ok: true })
  } catch (error) {
    return Response.json({
      ok: false,
      error: error instanceof Error ? error.message : 'Webhook error'
    }, { status: 500 })
  }
}
