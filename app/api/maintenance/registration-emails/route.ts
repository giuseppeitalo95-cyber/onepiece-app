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

  const { data: digestRows, error: digestError } = await client
    .from('analytics_events')
    .select('id, page_path, metadata')
    .eq('event_type', 'registration_email')
    .in('page_path', ['pending', 'welcome_sent'])
    .order('created_at', { ascending: true })
    .limit(5000)

  if (digestError) {
    return Response.json({ ok: false, error: digestError.message }, { status: 500 })
  }

  const digestItems = (digestRows || [])
    .map(row => ({ row, recipient: toRecipient(row.metadata) }))
    .filter((item): item is { row: NonNullable<typeof digestRows>[number]; recipient: RegistrationEmailRecipient } => Boolean(item.recipient))
  const invalidDigestIds = (digestRows || []).filter(row => !toRecipient(row.metadata)).map(row => row.id)
  if (invalidDigestIds.length > 0) {
    await client.from('analytics_events').update({ page_path: 'invalid_email' }).in('id', invalidDigestIds)
  }

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
        welcomeSent: 0,
        digestQueued: digestItems.length,
        error: adminDelivery.error,
      }, { status: 502 })
    }
    adminDigestSent = true
    const pendingDigestIds = digestItems.filter(item => item.row.page_path === 'pending').map(item => item.row.id)
    const welcomedDigestIds = digestItems.filter(item => item.row.page_path === 'welcome_sent').map(item => item.row.id)
    if (pendingDigestIds.length > 0) {
      const { error } = await client
        .from('analytics_events')
        .update({ page_path: 'admin_notified' })
        .in('id', pendingDigestIds)
      if (error) return Response.json({ ok: false, adminDigestSent, error: error.message }, { status: 500 })
    }
    if (welcomedDigestIds.length > 0) {
      const { error } = await client
        .from('analytics_events')
        .update({ page_path: 'complete' })
        .in('id', welcomedDigestIds)
      if (error) return Response.json({ ok: false, adminDigestSent, error: error.message }, { status: 500 })
    }
  }

  const { data: welcomeRows, error: welcomeError } = await client
    .from('analytics_events')
    .select('id, page_path, metadata')
    .eq('event_type', 'registration_email')
    .in('page_path', ['pending', 'admin_notified'])
    .order('created_at', { ascending: true })
    .limit(maxPerRun)

  if (welcomeError) {
    return Response.json({ ok: false, adminDigestSent, error: welcomeError.message }, { status: 500 })
  }

  let welcomeSent = 0
  const welcomeGroups = chunk(welcomeRows || [], BATCH_SIZE)
  for (const rows of welcomeGroups) {
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
        adminDigestSent,
        welcomeSent,
        queued: welcomeRows?.length || 0,
        error: delivery.error,
      }, { status: 502 })
    }
    welcomeSent += delivery.sent

    const adminNotifiedIds = validRows.filter(item => item.row.page_path === 'admin_notified').map(item => item.row.id)
    const pendingIds = validRows.filter(item => item.row.page_path === 'pending').map(item => item.row.id)
    if (adminNotifiedIds.length > 0) {
      const { error } = await client.from('analytics_events').update({ page_path: 'complete' }).in('id', adminNotifiedIds)
      if (error) return Response.json({ ok: false, welcomeSent, error: error.message }, { status: 500 })
    }
    if (pendingIds.length > 0) {
      const { error } = await client.from('analytics_events').update({ page_path: 'welcome_sent' }).in('id', pendingIds)
      if (error) return Response.json({ ok: false, welcomeSent, error: error.message }, { status: 500 })
    }
    await new Promise(resolve => setTimeout(resolve, 250))
  }

  return Response.json({
    ok: true,
    configured: true,
    queued: welcomeRows?.length || 0,
    welcomeSent,
    adminDigestUsers: digestItems.length,
    adminDigestSent,
  })
}

export async function POST(request: NextRequest) {
  return GET(request)
}
