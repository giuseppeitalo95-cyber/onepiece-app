import { randomInt } from 'node:crypto'
import { createClient } from '@supabase/supabase-js'
import { isAdminAccount } from '@/lib/admin'
import { DAILY_REWARD_COMMONS } from '@/lib/dailyRewardCards'
import {
  DAILY_REWARD_VIP_NOTE_PREFIX,
  getDailyRewardVipUntil
} from '@/lib/premium'

export const dynamic = 'force-dynamic'

const WIN_CHANCE_PER_THOUSAND = 50
const REWARD_DAYS = 7
const DEFAULT_SUPABASE_URL = 'https://jxwgbzatdueefdiyxlns.supabase.co'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || DEFAULT_SUPABASE_URL
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
const adminSupabase = serviceRoleKey
  ? createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false }
    })
  : null

type RewardProfile = {
  username?: string | null
  vip_note?: string | null
}

const romeDateKey = (date = new Date()) => {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Rome',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(date)
  const value = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find(part => part.type === type)?.value || ''
  return `${value('year')}-${value('month')}-${value('day')}`
}

const getAuthenticatedUser = async (request: Request) => {
  if (!adminSupabase) return { user: null, error: 'Server reward non configurato' }
  const token = (request.headers.get('authorization') || '').replace(/^Bearer\s+/i, '')
  if (!token) return { user: null, error: 'Sessione mancante' }

  const { data: { user }, error } = await adminSupabase.auth.getUser(token)
  return { user: error ? null : user, error: error?.message || null }
}

const loadProfile = async (userId: string) => {
  if (!adminSupabase) return null
  const { data } = await adminSupabase
    .from('profiles')
    .select('username, vip_note')
    .eq('id', userId)
    .maybeSingle()
  return data as RewardProfile | null
}

const tableMissing = (message?: string | null) =>
  Boolean(message && /user_scan_usage_daily|schema cache|does not exist|could not find/i.test(message))

const randomCatalogCard = () =>
  DAILY_REWARD_COMMONS[randomInt(DAILY_REWARD_COMMONS.length)]

const rewardUsageKey = (date = new Date()) => `${romeDateKey(date)}:reward`

const addVipWeek = async (userId: string, currentVipUntil?: string | null) => {
  if (!adminSupabase) throw new Error('Server reward non configurato')
  const now = Date.now()
  const current = currentVipUntil ? new Date(currentVipUntil).getTime() : 0
  const base = Number.isFinite(current) && current > now ? current : now
  const vipUntil = new Date(base + REWARD_DAYS * 24 * 60 * 60 * 1000).toISOString()

  const { error } = await adminSupabase
    .from('profiles')
    .update({
      vip_since: new Date().toISOString(),
      vip_granted_by: userId,
      vip_note: `${DAILY_REWARD_VIP_NOTE_PREFIX}${vipUntil}`
    })
    .eq('id', userId)

  if (error) throw error
  return vipUntil
}

export async function GET(request: Request) {
  try {
    const { user, error } = await getAuthenticatedUser(request)
    if (!user) return Response.json({ available: false, error }, { status: 401 })

    const profile = await loadProfile(user.id)
    const founder = isAdminAccount(user, profile)
    if (founder) {
      return Response.json({
        available: true,
        founder: true,
        unlimited: true,
        rewardDate: romeDateKey(),
        vipUntil: getDailyRewardVipUntil(profile?.vip_note)
      })
    }

    if (!adminSupabase) {
      return Response.json({ available: false, error: 'Server reward non configurato' }, { status: 503 })
    }

    const rewardDate = romeDateKey()
    const { data, error: playError } = await adminSupabase
      .from('user_scan_usage_daily')
      .select('updated_at')
      .eq('user_id', user.id)
      .eq('day', rewardUsageKey())
      .maybeSingle()

    if (playError) {
      return Response.json({
        available: false,
        setupRequired: tableMissing(playError.message),
        error: playError.message
      }, { status: 503 })
    }

    return Response.json({
      available: !data,
      founder: false,
      unlimited: false,
      rewardDate,
      playedToday: Boolean(data),
      vipUntil: getDailyRewardVipUntil(profile?.vip_note)
    })
  } catch (error) {
    console.error('Daily reward status error:', error)
    return Response.json({ available: false, error: 'Reward non disponibile' }, { status: 500 })
  }
}

export async function POST(request: Request) {
  try {
    const { user, error } = await getAuthenticatedUser(request)
    if (!user) return Response.json({ error }, { status: 401 })

    const body = await request.json()
    const selectedIndex = Number(body?.selectedIndex)
    if (!Number.isInteger(selectedIndex) || selectedIndex < 0 || selectedIndex > 8) {
      return Response.json({ error: 'Scelta non valida' }, { status: 400 })
    }

    const profile = await loadProfile(user.id)
    const founder = isAdminAccount(user, profile)
    const founderAttempt = Number(body?.founderAttempt || 0)
    const won = founder
      ? founderAttempt % 2 === 1
      : randomInt(1000) < WIN_CHANCE_PER_THOUSAND
    if (!founder) {
      if (!adminSupabase) {
        return Response.json({ error: 'Server reward non configurato' }, { status: 503 })
      }

      const { error: insertError } = await adminSupabase
        .from('user_scan_usage_daily')
        .insert({
          user_id: user.id,
          day: rewardUsageKey(),
          scan_count: 0,
          updated_at: new Date().toISOString()
        })

      if (insertError) {
        if (insertError.code === '23505') {
          return Response.json({ alreadyPlayed: true, error: 'Reward già giocato oggi' }, { status: 409 })
        }
        return Response.json({
          setupRequired: tableMissing(insertError.message),
          error: insertError.message
        }, { status: 503 })
      }
    }

    const revealedCard = won ? null : randomCatalogCard()

    let vipUntil = getDailyRewardVipUntil(profile?.vip_note)
    if (won && !founder) {
      try {
        vipUntil = await addVipWeek(user.id, getDailyRewardVipUntil(profile?.vip_note))
      } catch (vipError) {
        if (adminSupabase) {
          await adminSupabase
            .from('user_scan_usage_daily')
            .delete()
            .eq('user_id', user.id)
            .eq('day', rewardUsageKey())
        }
        throw vipError
      }
    }

    return Response.json({
      won,
      founder,
      rewardDays: won ? REWARD_DAYS : 0,
      vipUntil,
      card: won
        ? {
            cardId: 'OPV-001',
            name: "Pirate King's Ticket",
            imageUrl: '/rewards/opv-special-card.jpeg'
          }
        : revealedCard
    })
  } catch (error) {
    console.error('Daily reward play error:', error)
    return Response.json({ error: 'Non sono riuscito a completare il reward' }, { status: 500 })
  }
}
