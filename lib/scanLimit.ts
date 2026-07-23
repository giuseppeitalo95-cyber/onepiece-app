import type { SupabaseClient } from '@supabase/supabase-js'

export const DEFAULT_MONTHLY_SCAN_LIMIT = 1000
export const MAX_MONTHLY_SCAN_LIMIT = 100_000
export const SCAN_LIMIT_SETTINGS_KEY = '__monthly_limit__'

export const normalizeMonthlyScanLimit = (value: unknown) => {
  const parsed = Math.floor(Number(value))
  if (!Number.isFinite(parsed)) return DEFAULT_MONTHLY_SCAN_LIMIT
  return Math.min(MAX_MONTHLY_SCAN_LIMIT, Math.max(1, parsed))
}

export const readMonthlyScanLimit = async (client: SupabaseClient) => {
  const { data, error } = await client
    .from('scan_usage_global')
    .select('scan_count')
    .eq('month', SCAN_LIMIT_SETTINGS_KEY)
    .maybeSingle()

  if (error) {
    console.error('Monthly scan limit read error:', error.message)
    return DEFAULT_MONTHLY_SCAN_LIMIT
  }

  return data ? normalizeMonthlyScanLimit(data.scan_count) : DEFAULT_MONTHLY_SCAN_LIMIT
}
