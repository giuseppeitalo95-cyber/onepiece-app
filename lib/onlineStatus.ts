export const ONLINE_WINDOW_MS = 60 * 1000

export type OnlineProfile = {
  last_seen_at?: string | null
}

export const isProfileOnline = (profile?: OnlineProfile | null) => {
  if (!profile?.last_seen_at) return false
  const lastSeen = new Date(profile.last_seen_at).getTime()
  if (Number.isNaN(lastSeen)) return false
  return Date.now() - lastSeen <= ONLINE_WINDOW_MS
}

export const onlineLabel = (profile?: OnlineProfile | null) =>
  isProfileOnline(profile) ? 'Ora online' : 'Offline'
