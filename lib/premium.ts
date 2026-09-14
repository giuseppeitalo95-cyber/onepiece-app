import { ADMIN_ACCOUNT, isAdminAccount } from './admin'

export type PremiumTier = 'free' | 'premium' | 'vip' | 'admin'

export type PremiumProfile = {
  id?: string | null
  email?: string | null
  username?: string | null
  is_premium?: boolean | null
  premium_until?: string | null
  premium_since?: string | null
  premium_source?: string | null
  stripe_customer_id?: string | null
  stripe_subscription_id?: string | null
  is_vip?: boolean | null
  vip_since?: string | null
  vip_granted_by?: string | null
  vip_note?: string | null
}

export const FREE_DECK_LIMIT = 4
export const FREE_DAILY_SCAN_LIMIT = 12
export const FREE_BOARD_POST_DAYS = 7
export const PREMIUM_BOARD_POST_DAYS = 21
export const FREE_BOARD_DAILY_POST_LIMIT = 1
export const FREE_BOARD_WEEKLY_POST_LIMIT = 3

/**
 * Premium is intentionally dormant while OPV grows its first user base.
 * Keep the Stripe/profile fields and the limits below intact: changing this
 * flag back to true restores the existing paid-access rules in the callers.
 * Daily Reward VIP remains a visible profile title, but grants no extra access.
 */
export const PREMIUM_FEATURES_ENABLED = false

const nowMs = () => Date.now()

export const hasActivePremiumDate = (premiumUntil?: string | null) => {
  if (!premiumUntil) return false
  const time = new Date(premiumUntil).getTime()
  return Number.isFinite(time) && time > nowMs()
}

export const DAILY_REWARD_VIP_NOTE_PREFIX = 'daily_reward_vip_until:'

export const getDailyRewardVipUntil = (note?: string | null) => {
  if (!note?.startsWith(DAILY_REWARD_VIP_NOTE_PREFIX)) return null
  const value = note.slice(DAILY_REWARD_VIP_NOTE_PREFIX.length)
  return hasActivePremiumDate(value) ? value : null
}

export const getPremiumTier = (
  profile?: PremiumProfile | null,
  user?: { id?: string | null; email?: string | null } | null
): PremiumTier => {
  if (isAdminAccount(user, profile)) return 'admin'
  if (getDailyRewardVipUntil(profile?.vip_note)) return 'vip'
  if (!PREMIUM_FEATURES_ENABLED) return 'free'
  if (profile?.is_vip) return 'vip'
  if (profile?.is_premium || hasActivePremiumDate(profile?.premium_until)) return 'premium'
  return 'free'
}

export const hasPremiumAccess = (
  profile?: PremiumProfile | null,
  user?: { id?: string | null; email?: string | null } | null
) => !PREMIUM_FEATURES_ENABLED || getPremiumTier(profile, user) !== 'free'

export const premiumLabel = (tier: PremiumTier) => {
  if (tier === 'admin') return 'Admin'
  if (tier === 'vip') return 'VIP'
  if (tier === 'premium') return 'Premium'
  return ''
}

export const premiumClassName = (tier: PremiumTier) => {
  if (tier === 'admin') return 'op-name-admin'
  if (tier === 'vip') return 'op-name-vip'
  if (tier === 'premium') return 'op-name-premium'
  return ''
}

export const normalizePremiumProfile = (profile?: PremiumProfile | null): PremiumProfile => ({
  ...profile,
  is_premium: Boolean(profile?.is_premium),
  is_vip: Boolean(profile?.is_vip)
})

export const adminPremiumProfile: PremiumProfile = {
  id: ADMIN_ACCOUNT.id,
  email: ADMIN_ACCOUNT.email,
  username: ADMIN_ACCOUNT.username,
  is_vip: true,
  premium_source: 'admin'
}
