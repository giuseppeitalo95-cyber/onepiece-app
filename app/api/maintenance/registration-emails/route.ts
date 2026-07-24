import { NextRequest } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import {
  adminRegistrationDigestMessage,
  sendEmailBatch,
  sendWelcomeEmailBatch,
  type RegistrationEmailRecipient,
} from '@/lib/opvEmail'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://jxwgbzatdueefdiyxlns.supabase.co'
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
const BATCH_SIZE = 100

const isAuthorized = (request: NextRequest) => {
  const secret = process.env.MAINTENANCE_SECRET || process.env.CRON_SECRET
  if (!secret) return false
  const auth = request.headers.get('authorization') || ''
  const querySecret = request.nextUrl.searchParams.get('secret') || ''
  return auth === `Bearer ${secret}` || querySecret === secret
}

const validEmail = (value: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)

const toRecipient = (metadata: unknown): RegistrationEmailRecipient | null => {
  if (!metadata || typeof metadata !== 'object') return null
  const source = metadata as Record<string, unknown>
  const email = String(source.email || '').trim().toLowerCase()
  if (!validEmail(email)) return null
  const username = String(source.username || email.split('@')[0] || 'nuovo giocatore').trim().slice(0, 80)
  return { email, username }
}

const chunk = <T,>(items: T[], size: number) => {
  const groups: T[][] = []
  for (let index = 0; index < items.length; index += size) groups.push(items.slice(index, index + size))
  return groups
}

const shortKey = (prefix: string, ids: string[]) => {
  const first = ids[0]?.replaceAll('-', '').slice(0, 16) || 'none'
  const last = ids.at(-1)?.replaceAll('-', '').slice(0, 16) || 'none'
  return `${prefix}-${first}-${last}-${ids.length}`
}

export async function GET(request: NextRequest) {
  if (!SERVICE_ROLE_KEY) {
    return Response.json({ ok: false, error: 'Missing service role' }, { status: 503 })
  }
  if (!isAuthorized(request)) {
    const configured = Boolean(process.env.MAINTENANCE_SECRET || process.env.CRON_SECRET)
    return Response.json({ ok: false, error: configured ? 'Unauthorized' : 'Missing maintenance secret' }, { status: configured ? 401 : 503 })
  }
  if (!process.env.RESEND_API_KEY || !process.env.EMAIL_FROM) {
    return Response.json({ ok: true, configured: false, queued: 0, message: 'Email service not configured' })
  }

  const client = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const maxPerRun = Math.min(5000, Math.max(1, Number(process.env.EMAIL_MAX_WELCOMES_PER_RUN || 1000)))

  const { data: pendingRows, error: pendingError } = await client
    .from('analytics_events')
    .select('id, metadata')
    .eq('event_type', 'registration_email')
    .eq('page_path', 'pending')
    .order('created_at', { ascending: true })
    .limit(maxPerRun)

  if (pendingError) {
    return Response.json({ ok: false, error: pendingError.message }, { status: 500 })
  }

  let welcomeSent = 0
  const pendingGroups = chunk(pendingRows || [], BATCH_SIZE)
  for (const rows of pendingGroups) {
    const validRows = rows
      .map(row => ({ row, recipient: toRecipient(row.metadata) }))
      .filter((item): item is { row: typeof rows[number]; recipient: RegistrationEmailRecipient } => Boolean(item.recipient))
    const invalidIds = rows.filter(row => !toRecipient(row.metadata)).map(row => row.id)
    if (invalidIds.length > 0) {
      await client.from('analytics_events').update({ page_path: 'invalid_email' }).in('id', invalidIds)
    }
    if (validRows.length === 0) continue

    const ids = validRows.map(item => item.row.id)
    const delivery = await sendWelcomeEmailBatch(validRows.map(item => item.recipient), shortKey('opv-welcome', ids))
    if (!delivery.ok) {
      return Response.json({
        ok: false,
        configured: delivery.configured,
        welcomeSent,
        queued: pendingRows?.length || 0,
        error: delivery.error,
      }, { status: 502 })
    }
    welcomeSent += delivery.sent
    const { error: markError } = await client
      .from('analytics_events')
      .update({ page_path: 'welcome_sent' })
      .in('id', ids)
    if (markError) {
      return Response.json({ ok: false, welcomeSent, error: markError.message }, { status: 500 })
    }
    await new Promise(resolve => setTimeout(resolve, 250))
  }

  const { data: digestRows, error: digestError } = await client
    .from('analytics_events')
    .select('id, metadata')
    .eq('event_type', 'registration_email')
    .eq('page_path', 'welcome_sent')
    .order('created_at', { ascending: true })
    .limit(5000)

  if (digestError) {
    return Response.json({ ok: false, welcomeSent, error: digestError.message }, { status: 500 })
  }

  const digestItems = (digestRows || [])
    .map(row => ({ row, recipient: toRecipient(row.metadata) }))
    .filter((item): item is { row: NonNullable<typeof digestRows>[number]; recipient: RegistrationEmailRecipient } => Boolean(item.recipient))

  let adminDigestSent = false
  if (digestItems.length > 0) {
    const digestIds = digestItems.map(item => item.row.id)
    const adminDelivery = await sendEmailBatch(
      [adminRegistrationDigestMessage(digestItems.map(item => item.recipient))],
      shortKey('opv-admin-digest', digestIds),
    )
    if (!adminDelivery.ok) {
      return Response.json({
        ok: false,
        welcomeSent,
        digestQueued: digestItems.length,
        error: adminDelivery.error,
      }, { status: 502 })
    }
    adminDigestSent = true
    const { error: digestMarkError } = await client
      .from('analytics_events')
      .update({ page_path: 'admin_notified' })
      .in('id', digestIds)
    if (digestMarkError) {
      return Response.json({ ok: false, welcomeSent, adminDigestSent, error: digestMarkError.message }, { status: 500 })
    }
  }

  return Response.json({
    ok: true,
    configured: true,
    queued: pendingRows?.length || 0,
    welcomeSent,
    adminDigestUsers: digestItems.length,
    adminDigestSent,
  })
}

export async function POST(request: NextRequest) {
  return GET(request)
}
