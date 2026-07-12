import { supabase } from './supabase'

export type ProgressCard = {
  card_id: string
  quantity: number
  name: string | null
  rarity: string | null
  card_color?: string | null
  card_type?: string | null
  card_cost?: number | null
  card_power?: number | null
  market_price?: number | null
  inventory_price?: number | null
}

export type ProgressData = {
  dailyClaimDates: string[]
  unlockedBadgeIds: string[]
  updatedAt?: string
}

export type BadgeDefinition = {
  id: string
  title: string
  description: string
  xp: number
  code: string
  tone: 'cyan' | 'rose' | 'emerald' | 'violet' | 'amber'
  category: 'daily' | 'collection' | 'rarity' | 'value' | 'crew' | 'set' | 'mastery'
  isUnlocked: (stats: ProgressStats) => boolean
  progress?: (stats: ProgressStats) => { current: number; target: number }
}

type ProgressStats = {
  cards: ProgressCard[]
  totalQuantity: number
  uniqueCount: number
  duplicateCount: number
  fourCopiesCount: number
  totalValue: number
  maxValue: number
  dailyCount: number
  dailyStreak: number
  colors: Record<string, number>
  rarities: Record<string, number>
  prefixes: Record<string, number>
  hasName: (value: string) => boolean
  hasRarity: (value: string) => boolean
  hasType: (value: string) => boolean
  hasColorQuantity: (value: string, count: number) => boolean
  hasPrefixQuantity: (value: string, count: number) => boolean
}

export type BadgeState = BadgeDefinition & {
  unlocked: boolean
  progressValue?: { current: number; target: number }
}

export type ProgressSummary = {
  xp: number
  level: number
  levelXp: number
  nextLevelXp: number
  progressPercent: number
  dailyClaimedToday: boolean
  dailyStreak: number
  unlockedCount: number
  totalBadges: number
  badges: BadgeState[]
  newlyUnlocked: BadgeDefinition[]
}

const XP_SCALE = 0.12
const DAILY_LOGIN_XP = 5

const badgeXp = (badge: BadgeDefinition) => Math.max(5, Math.round(badge.xp * XP_SCALE))
const withScaledXp = (badge: BadgeDefinition): BadgeDefinition => ({
  ...badge,
  xp: badgeXp(badge)
})

const emitUnlockedBadges = (badges: BadgeDefinition[]) => {
  if (typeof window === 'undefined' || badges.length === 0) return
  window.dispatchEvent(new CustomEvent('opv:badges-unlocked', { detail: { badges: badges.map(withScaledXp) } }))
}

const todayKey = () => new Date().toISOString().slice(0, 10)

const normalize = (value?: string | null) =>
  (value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

const compact = (value?: string | null) => normalize(value).replace(/\s/g, '')

const clampProgress = (current: number, target: number) => ({
  current: Math.min(current, target),
  target
})

const priceOf = (card: ProgressCard) => card.market_price ?? card.inventory_price ?? 0

const progressKey = (userId: string) => `opv-progress:${userId}`

export const emptyProgressData = (): ProgressData => ({
  dailyClaimDates: [],
  unlockedBadgeIds: []
})

export const loadProgressData = (userId: string): ProgressData => {
  if (typeof window === 'undefined') return emptyProgressData()

  try {
    const raw = window.localStorage.getItem(progressKey(userId))
    if (!raw) return emptyProgressData()
    const parsed = JSON.parse(raw) as Partial<ProgressData>

    return {
      dailyClaimDates: Array.isArray(parsed.dailyClaimDates) ? parsed.dailyClaimDates : [],
      unlockedBadgeIds: Array.isArray(parsed.unlockedBadgeIds) ? parsed.unlockedBadgeIds : [],
      updatedAt: parsed.updatedAt
    }
  } catch {
    return emptyProgressData()
  }
}

const saveProgressData = (userId: string, data: ProgressData) => {
  if (typeof window === 'undefined') return
  window.localStorage.setItem(progressKey(userId), JSON.stringify({
    ...data,
    dailyClaimDates: [...new Set(data.dailyClaimDates)].sort(),
    unlockedBadgeIds: [...new Set(data.unlockedBadgeIds)],
    updatedAt: new Date().toISOString()
  }))
}

const cleanProgressData = (data: ProgressData): ProgressData => ({
  dailyClaimDates: [...new Set(data.dailyClaimDates)].sort(),
  unlockedBadgeIds: [...new Set(data.unlockedBadgeIds)],
  updatedAt: data.updatedAt
})

const mergeProgressData = (...items: ProgressData[]): ProgressData => cleanProgressData({
  dailyClaimDates: items.flatMap(item => item.dailyClaimDates || []),
  unlockedBadgeIds: items.flatMap(item => item.unlockedBadgeIds || []),
  updatedAt: new Date().toISOString()
})

const loadRemoteProgressData = async (userId: string): Promise<ProgressData | null> => {
  const { data, error } = await supabase
    .from('user_progress')
    .select('daily_claim_dates, unlocked_badge_ids, updated_at')
    .eq('user_id', userId)
    .maybeSingle()

  if (error) return null

  return {
    dailyClaimDates: Array.isArray(data?.daily_claim_dates) ? data.daily_claim_dates : [],
    unlockedBadgeIds: Array.isArray(data?.unlocked_badge_ids) ? data.unlocked_badge_ids : [],
    updatedAt: data?.updated_at
  }
}

const saveRemoteProgressData = async (userId: string, data: ProgressData) => {
  const clean = cleanProgressData(data)
  const { error } = await supabase
    .from('user_progress')
    .upsert({
      user_id: userId,
      daily_claim_dates: clean.dailyClaimDates,
      unlocked_badge_ids: clean.unlockedBadgeIds,
      updated_at: new Date().toISOString()
    })

  return !error
}

const getDailyStreak = (dates: string[]) => {
  const set = new Set(dates)
  const cursor = new Date()
  let streak = 0

  for (;;) {
    const key = cursor.toISOString().slice(0, 10)
    if (!set.has(key)) break
    streak += 1
    cursor.setDate(cursor.getDate() - 1)
  }

  return streak
}

const getLevelXp = (level: number) => {
  if (level <= 1) return 0
  return Math.round(260 * Math.pow(level - 1, 1.7))
}

export const getLevelInfo = (xp: number) => {
  let level = 1
  while (xp >= getLevelXp(level + 1)) level += 1

  const levelXp = getLevelXp(level)
  const nextLevelXp = getLevelXp(level + 1)
  const progressPercent = Math.max(0, Math.min(100, ((xp - levelXp) / (nextLevelXp - levelXp)) * 100))

  return { level, levelXp, nextLevelXp, progressPercent }
}

const buildStats = (cards: ProgressCard[], progress: ProgressData): ProgressStats => {
  const colors: Record<string, number> = {}
  const rarities: Record<string, number> = {}
  const prefixes: Record<string, number> = {}
  let totalQuantity = 0
  let totalValue = 0
  let maxValue = 0
  let duplicateCount = 0
  let fourCopiesCount = 0

  for (const card of cards) {
    const quantity = Number(card.quantity || 0)
    const price = Number(priceOf(card) || 0)
    const color = normalize(card.card_color || 'unknown')
    const rarity = normalize(card.rarity || 'unknown')
    const prefix = compact(card.card_id).match(/^[a-z]+\d{2}/)?.[0] || 'other'

    totalQuantity += quantity
    totalValue += price * quantity
    maxValue = Math.max(maxValue, price)
    if (quantity > 1) duplicateCount += 1
    if (quantity >= 4) fourCopiesCount += 1
    colors[color] = (colors[color] || 0) + quantity
    rarities[rarity] = (rarities[rarity] || 0) + quantity
    prefixes[prefix] = (prefixes[prefix] || 0) + quantity
  }

  const hasName = (value: string) => {
    const wanted = normalize(value)
    return cards.some(card => normalize(card.name).includes(wanted))
  }

  const hasRarity = (value: string) => {
    const wanted = normalize(value)
    return cards.some(card => normalize(card.rarity).includes(wanted))
  }

  const hasType = (value: string) => {
    const wanted = normalize(value)
    return cards.some(card => normalize(card.card_type).includes(wanted))
  }

  return {
    cards,
    totalQuantity,
    uniqueCount: cards.length,
    duplicateCount,
    fourCopiesCount,
    totalValue,
    maxValue,
    dailyCount: progress.dailyClaimDates.length,
    dailyStreak: getDailyStreak(progress.dailyClaimDates),
    colors,
    rarities,
    prefixes,
    hasName,
    hasRarity,
    hasType,
    hasColorQuantity: (value, count) => (colors[normalize(value)] || 0) >= count,
    hasPrefixQuantity: (value, count) => (prefixes[compact(value)] || 0) >= count,
  }
}

const countProgress = (getValue: (stats: ProgressStats) => number, target: number) =>
  (stats: ProgressStats) => clampProgress(getValue(stats), target)

const streakBadge = (days: number, xp: number): BadgeDefinition => ({
  id: `streak_${days}`,
  title: `Streak ${days}`,
  description: `Apri l'app per ${days} giorni consecutivi.`,
  xp,
  code: `S${days}`,
  tone: days >= 14 ? 'emerald' : 'cyan',
  category: 'daily',
  isUnlocked: stats => stats.dailyStreak >= days,
  progress: countProgress(stats => stats.dailyStreak, days)
})

const cardQuantityBadge = (target: number, xp: number, title: string): BadgeDefinition => ({
  id: `cards_${target}`,
  title,
  description: `Raggiungi ${target} carte totali.`,
  xp,
  code: `${target}`,
  tone: target >= 500 ? 'rose' : 'amber',
  category: 'collection',
  isUnlocked: s => s.totalQuantity >= target,
  progress: countProgress(s => s.totalQuantity, target)
})

const uniqueBadge = (target: number, xp: number): BadgeDefinition => ({
  id: `unique_${target}`,
  title: `${target} uniche`,
  description: `Possiedi ${target} carte diverse.`,
  xp,
  code: `U${target}`,
  tone: target >= 250 ? 'rose' : 'violet',
  category: 'collection',
  isUnlocked: s => s.uniqueCount >= target,
  progress: countProgress(s => s.uniqueCount, target)
})

const colorBadge = (color: string, label: string, target: number, tone: BadgeDefinition['tone']): BadgeDefinition => ({
  id: `color_${color}_${target}`,
  title: `${label} ${target}`,
  description: `Possiedi ${target} carte ${label.toLowerCase()}.`,
  xp: target >= 50 ? 420 : 220,
  code: `${label.slice(0, 3).toUpperCase()}${target}`,
  tone,
  category: 'mastery',
  isUnlocked: s => s.hasColorQuantity(color, target),
  progress: countProgress(s => s.colors[color] || 0, target)
})

const setBadge = (prefix: string, title: string, target: number, xp: number, tone: BadgeDefinition['tone']): BadgeDefinition => ({
  id: `set_${prefix}_${target}`,
  title,
  description: `Possiedi ${target} carte ${prefix.toUpperCase()}.`,
  xp,
  code: prefix.toUpperCase(),
  tone,
  category: 'set',
  isUnlocked: s => s.hasPrefixQuantity(prefix, target),
  progress: countProgress(s => s.prefixes[prefix] || 0, target)
})

const crewBadge = (id: string, title: string, names: string[], xp: number, tone: BadgeDefinition['tone']): BadgeDefinition => ({
  id: `crew_${id}`,
  title,
  description: `Aggiungi una carta ${names[0]}.`,
  xp,
  code: id.slice(0, 3).toUpperCase(),
  tone,
  category: 'crew',
  isUnlocked: s => names.some(name => s.hasName(name))
})

export const BADGES: BadgeDefinition[] = [
  { id: 'daily_1', title: 'Primo attracco', description: 'Apri l’app in un nuovo giorno.', xp: 25, code: 'D1', tone: 'cyan', category: 'daily', isUnlocked: s => s.dailyCount >= 1, progress: countProgress(s => s.dailyCount, 1) },
  { id: 'daily_3', title: 'Tre giorni in rotta', description: 'Ottieni il bonus giornaliero 3 volte.', xp: 60, code: 'D3', tone: 'cyan', category: 'daily', isUnlocked: s => s.dailyCount >= 3, progress: countProgress(s => s.dailyCount, 3) },
  { id: 'daily_7', title: 'Settimana di mare', description: 'Ottieni il bonus giornaliero 7 volte.', xp: 140, code: 'D7', tone: 'cyan', category: 'daily', isUnlocked: s => s.dailyCount >= 7, progress: countProgress(s => s.dailyCount, 7) },
  { id: 'daily_14', title: 'Rotta costante', description: 'Ottieni il bonus giornaliero 14 volte.', xp: 260, code: '14', tone: 'cyan', category: 'daily', isUnlocked: s => s.dailyCount >= 14, progress: countProgress(s => s.dailyCount, 14) },
  { id: 'daily_30', title: 'Log Pose stabile', description: 'Ottieni il bonus giornaliero 30 volte.', xp: 600, code: '30', tone: 'cyan', category: 'daily', isUnlocked: s => s.dailyCount >= 30, progress: countProgress(s => s.dailyCount, 30) },
  { id: 'daily_60', title: 'Due mesi in mare', description: 'Ottieni il bonus giornaliero 60 volte.', xp: 1250, code: 'D60', tone: 'emerald', category: 'daily', isUnlocked: s => s.dailyCount >= 60, progress: countProgress(s => s.dailyCount, 60) },
  { id: 'daily_90', title: 'Rotta leggendaria', description: 'Ottieni il bonus giornaliero 90 volte.', xp: 2100, code: 'D90', tone: 'rose', category: 'daily', isUnlocked: s => s.dailyCount >= 90, progress: countProgress(s => s.dailyCount, 90) },
  ...[
    streakBadge(2, 45),
    streakBadge(3, 70),
    streakBadge(4, 100),
    streakBadge(5, 135),
    streakBadge(6, 175),
    streakBadge(7, 230),
    streakBadge(10, 360),
    streakBadge(14, 560),
    streakBadge(21, 860),
    streakBadge(30, 1300),
    streakBadge(60, 3200),
    streakBadge(90, 5400),
  ],

  { id: 'cards_1', title: 'Prima carta', description: 'Aggiungi la prima carta alla collezione.', xp: 30, code: '01', tone: 'amber', category: 'collection', isUnlocked: s => s.totalQuantity >= 1, progress: countProgress(s => s.totalQuantity, 1) },
  { id: 'cards_10', title: 'Mini raccoglitore', description: 'Raggiungi 10 carte totali.', xp: 70, code: '10', tone: 'amber', category: 'collection', isUnlocked: s => s.totalQuantity >= 10, progress: countProgress(s => s.totalQuantity, 10) },
  { id: 'cards_25', title: 'Raccoglitore vivo', description: 'Raggiungi 25 carte totali.', xp: 130, code: '25', tone: 'amber', category: 'collection', isUnlocked: s => s.totalQuantity >= 25, progress: countProgress(s => s.totalQuantity, 25) },
  { id: 'cards_50', title: 'Mezzo box', description: 'Raggiungi 50 carte totali.', xp: 220, code: '50', tone: 'amber', category: 'collection', isUnlocked: s => s.totalQuantity >= 50, progress: countProgress(s => s.totalQuantity, 50) },
  { id: 'cards_100', title: 'Vault serio', description: 'Raggiungi 100 carte totali.', xp: 420, code: '100', tone: 'amber', category: 'collection', isUnlocked: s => s.totalQuantity >= 100, progress: countProgress(s => s.totalQuantity, 100) },
  { id: 'cards_250', title: 'Archivio pirata', description: 'Raggiungi 250 carte totali.', xp: 900, code: '250', tone: 'amber', category: 'collection', isUnlocked: s => s.totalQuantity >= 250, progress: countProgress(s => s.totalQuantity, 250) },
  cardQuantityBadge(500, 1700, 'Mezzo migliaio'),
  cardQuantityBadge(1000, 3800, 'Grande archivio'),
  uniqueBadge(50, 330),
  { id: 'unique_25', title: '25 uniche', description: 'Possiedi 25 carte diverse.', xp: 180, code: 'U25', tone: 'violet', category: 'collection', isUnlocked: s => s.uniqueCount >= 25, progress: countProgress(s => s.uniqueCount, 25) },
  { id: 'unique_100', title: '100 uniche', description: 'Possiedi 100 carte diverse.', xp: 700, code: 'U100', tone: 'violet', category: 'collection', isUnlocked: s => s.uniqueCount >= 100, progress: countProgress(s => s.uniqueCount, 100) },
  uniqueBadge(250, 1800),
  uniqueBadge(500, 4200),
  { id: 'duplicates_5', title: 'Materiale scambi', description: 'Possiedi almeno 5 carte doppie.', xp: 120, code: 'x2', tone: 'emerald', category: 'collection', isUnlocked: s => s.duplicateCount >= 5, progress: countProgress(s => s.duplicateCount, 5) },
  { id: 'duplicates_15', title: 'Banca scambi', description: 'Possiedi almeno 15 carte doppie.', xp: 300, code: 'x15', tone: 'emerald', category: 'collection', isUnlocked: s => s.duplicateCount >= 15, progress: countProgress(s => s.duplicateCount, 15) },
  { id: 'duplicates_30', title: 'Mercante del porto', description: 'Possiedi almeno 30 carte doppie.', xp: 650, code: 'x30', tone: 'emerald', category: 'collection', isUnlocked: s => s.duplicateCount >= 30, progress: countProgress(s => s.duplicateCount, 30) },
  { id: 'playset_5', title: 'Playset builder', description: 'Possiedi 5 carte con almeno 4 copie.', xp: 260, code: 'x4', tone: 'emerald', category: 'collection', isUnlocked: s => s.fourCopiesCount >= 5, progress: countProgress(s => s.fourCopiesCount, 5) },
  { id: 'playset_15', title: 'Deck pronto', description: 'Possiedi 15 carte con almeno 4 copie.', xp: 620, code: 'P15', tone: 'emerald', category: 'collection', isUnlocked: s => s.fourCopiesCount >= 15, progress: countProgress(s => s.fourCopiesCount, 15) },
  { id: 'playset_30', title: 'Playset master', description: 'Possiedi 30 carte con almeno 4 copie.', xp: 1400, code: 'P30', tone: 'rose', category: 'collection', isUnlocked: s => s.fourCopiesCount >= 30, progress: countProgress(s => s.fourCopiesCount, 30) },

  { id: 'rarity_r', title: 'Prima R', description: 'Aggiungi una carta Rare.', xp: 40, code: 'R', tone: 'cyan', category: 'rarity', isUnlocked: s => s.hasRarity('r') || s.hasRarity('rare') },
  { id: 'rarity_sr', title: 'Prima SR', description: 'Aggiungi una Super Rare.', xp: 90, code: 'SR', tone: 'rose', category: 'rarity', isUnlocked: s => s.hasRarity('sr') || s.hasRarity('super rare') },
  { id: 'rarity_sec', title: 'Secret pull', description: 'Aggiungi una Secret Rare.', xp: 220, code: 'SEC', tone: 'rose', category: 'rarity', isUnlocked: s => s.hasRarity('sec') || s.hasRarity('secret') },
  { id: 'rarity_leader', title: 'Leader trovato', description: 'Aggiungi una carta Leader.', xp: 100, code: 'L', tone: 'violet', category: 'rarity', isUnlocked: s => s.hasType('leader') || s.hasRarity('leader') },
  { id: 'rarity_manga', title: 'Leggenda Manga', description: 'Aggiungi una carta Manga o Manga Rare.', xp: 1200, code: 'MG', tone: 'rose', category: 'rarity', isUnlocked: s => s.hasRarity('manga') || s.cards.some(card => normalize(card.name).includes('manga')) },
  { id: 'rarity_tr', title: 'Treasure Rare', description: 'Aggiungi una Treasure Rare.', xp: 260, code: 'TR', tone: 'amber', category: 'rarity', isUnlocked: s => s.hasRarity('tr') || s.hasRarity('treasure') },

  { id: 'value_5', title: 'Prima taglia', description: 'Possiedi una carta da almeno 5 dollari.', xp: 90, code: '$5', tone: 'emerald', category: 'value', isUnlocked: s => s.maxValue >= 5, progress: countProgress(s => Math.floor(s.maxValue), 5) },
  { id: 'value_20', title: 'Carta importante', description: 'Possiedi una carta da almeno 20 dollari.', xp: 240, code: '$20', tone: 'emerald', category: 'value', isUnlocked: s => s.maxValue >= 20, progress: countProgress(s => Math.floor(s.maxValue), 20) },
  { id: 'value_50', title: 'Wanted alta', description: 'Possiedi una carta da almeno 50 dollari.', xp: 520, code: '$50', tone: 'emerald', category: 'value', isUnlocked: s => s.maxValue >= 50, progress: countProgress(s => Math.floor(s.maxValue), 50) },
  { id: 'value_100', title: 'Wanted rossa', description: 'Possiedi una carta da almeno 100 dollari.', xp: 1150, code: '$100', tone: 'rose', category: 'value', isUnlocked: s => s.maxValue >= 100, progress: countProgress(s => Math.floor(s.maxValue), 100) },
  { id: 'value_total_100', title: 'Vault 100', description: 'Raggiungi 100 dollari di valore stimato.', xp: 280, code: 'V100', tone: 'emerald', category: 'value', isUnlocked: s => s.totalValue >= 100, progress: countProgress(s => Math.floor(s.totalValue), 100) },
  { id: 'value_total_500', title: 'Tesoro serio', description: 'Raggiungi 500 dollari di valore stimato.', xp: 900, code: 'V500', tone: 'emerald', category: 'value', isUnlocked: s => s.totalValue >= 500, progress: countProgress(s => Math.floor(s.totalValue), 500) },
  { id: 'value_total_1000', title: 'Tesoro da Yonko', description: 'Raggiungi 1000 dollari di valore stimato.', xp: 2100, code: 'V1K', tone: 'rose', category: 'value', isUnlocked: s => s.totalValue >= 1000, progress: countProgress(s => Math.floor(s.totalValue), 1000) },

  { id: 'color_red_10', title: 'Rosso acceso', description: 'Possiedi 10 carte rosse.', xp: 120, code: 'RED', tone: 'rose', category: 'mastery', isUnlocked: s => s.hasColorQuantity('red', 10), progress: countProgress(s => s.colors.red || 0, 10) },
  { id: 'color_green_10', title: 'Verde solido', description: 'Possiedi 10 carte verdi.', xp: 120, code: 'GRN', tone: 'emerald', category: 'mastery', isUnlocked: s => s.hasColorQuantity('green', 10), progress: countProgress(s => s.colors.green || 0, 10) },
  { id: 'color_blue_10', title: 'Blu controllo', description: 'Possiedi 10 carte blu.', xp: 120, code: 'BLU', tone: 'cyan', category: 'mastery', isUnlocked: s => s.hasColorQuantity('blue', 10), progress: countProgress(s => s.colors.blue || 0, 10) },
  { id: 'color_purple_10', title: 'Viola DON', description: 'Possiedi 10 carte viola.', xp: 120, code: 'PUR', tone: 'violet', category: 'mastery', isUnlocked: s => s.hasColorQuantity('purple', 10), progress: countProgress(s => s.colors.purple || 0, 10) },
  { id: 'color_black_10', title: 'Nero tattico', description: 'Possiedi 10 carte nere.', xp: 120, code: 'BLK', tone: 'violet', category: 'mastery', isUnlocked: s => s.hasColorQuantity('black', 10), progress: countProgress(s => s.colors.black || 0, 10) },
  { id: 'color_yellow_10', title: 'Giallo trigger', description: 'Possiedi 10 carte gialle.', xp: 120, code: 'YLW', tone: 'amber', category: 'mastery', isUnlocked: s => s.hasColorQuantity('yellow', 10), progress: countProgress(s => s.colors.yellow || 0, 10) },
  ...[
    colorBadge('red', 'Rosso', 25, 'rose'),
    colorBadge('red', 'Rosso', 50, 'rose'),
    colorBadge('green', 'Verde', 25, 'emerald'),
    colorBadge('green', 'Verde', 50, 'emerald'),
    colorBadge('blue', 'Blu', 25, 'cyan'),
    colorBadge('blue', 'Blu', 50, 'cyan'),
    colorBadge('purple', 'Viola', 25, 'violet'),
    colorBadge('purple', 'Viola', 50, 'violet'),
    colorBadge('black', 'Nero', 25, 'violet'),
    colorBadge('black', 'Nero', 50, 'violet'),
    colorBadge('yellow', 'Giallo', 25, 'amber'),
    colorBadge('yellow', 'Giallo', 50, 'amber'),
  ],

  { id: 'crew_luffy', title: 'Capitano', description: 'Aggiungi una carta Luffy.', xp: 80, code: 'LUF', tone: 'rose', category: 'crew', isUnlocked: s => s.hasName('luffy') },
  { id: 'crew_zoro', title: 'Spadaccino', description: 'Aggiungi una carta Zoro.', xp: 80, code: 'ZOR', tone: 'emerald', category: 'crew', isUnlocked: s => s.hasName('zoro') },
  { id: 'crew_nami', title: 'Navigatrice', description: 'Aggiungi una carta Nami.', xp: 80, code: 'NAM', tone: 'amber', category: 'crew', isUnlocked: s => s.hasName('nami') },
  { id: 'crew_sanji', title: 'Cuoco', description: 'Aggiungi una carta Sanji.', xp: 80, code: 'SAN', tone: 'cyan', category: 'crew', isUnlocked: s => s.hasName('sanji') },
  { id: 'crew_robin', title: 'Archeologa', description: 'Aggiungi una carta Robin.', xp: 80, code: 'ROB', tone: 'violet', category: 'crew', isUnlocked: s => s.hasName('robin') },
  { id: 'crew_boa', title: 'Imperatrice', description: 'Aggiungi una carta Boa Hancock.', xp: 120, code: 'BOA', tone: 'rose', category: 'crew', isUnlocked: s => s.hasName('boa') || s.hasName('hancock') },
  { id: 'crew_ace', title: 'Fuoco vivo', description: 'Aggiungi una carta Ace.', xp: 120, code: 'ACE', tone: 'rose', category: 'crew', isUnlocked: s => s.hasName('ace') },
  { id: 'crew_law', title: 'Room', description: 'Aggiungi una carta Trafalgar Law.', xp: 120, code: 'LAW', tone: 'cyan', category: 'crew', isUnlocked: s => s.hasName('law') || s.hasName('trafalgar') },
  ...[
    crewBadge('shanks', 'Capelli rossi', ['shanks'], 140, 'rose'),
    crewBadge('blackbeard', 'Barbanera', ['blackbeard', 'teach'], 160, 'violet'),
    crewBadge('mihawk', 'Occhi di falco', ['mihawk'], 140, 'emerald'),
    crewBadge('crocodile', 'Mr. Zero', ['crocodile'], 120, 'amber'),
    crewBadge('doflamingo', 'Fili invisibili', ['doflamingo'], 140, 'rose'),
    crewBadge('perona', 'Ghost princess', ['perona'], 120, 'violet'),
    crewBadge('kaido', 'Drago imperatore', ['kaido'], 160, 'emerald'),
    crewBadge('bigmom', 'Soul queen', ['big mom', 'linlin'], 160, 'amber'),
    crewBadge('jinbe', 'Cavaliere del mare', ['jinbe', 'jimbei'], 120, 'cyan'),
    crewBadge('usopp', 'Cecchino', ['usopp'], 80, 'amber'),
    crewBadge('chopper', 'Dottore', ['chopper'], 80, 'rose'),
    crewBadge('franky', 'Super', ['franky'], 80, 'cyan'),
    crewBadge('brook', 'Soul king', ['brook'], 80, 'violet'),
  ],

  { id: 'set_op01_5', title: 'Romance Dawn', description: 'Possiedi 5 carte OP01.', xp: 150, code: 'OP01', tone: 'amber', category: 'set', isUnlocked: s => s.hasPrefixQuantity('op01', 5), progress: countProgress(s => s.prefixes.op01 || 0, 5) },
  { id: 'set_op05_5', title: 'Era nuova', description: 'Possiedi 5 carte OP05.', xp: 150, code: 'OP05', tone: 'rose', category: 'set', isUnlocked: s => s.hasPrefixQuantity('op05', 5), progress: countProgress(s => s.prefixes.op05 || 0, 5) },
  { id: 'set_op09_5', title: 'Imperatori', description: 'Possiedi 5 carte OP09.', xp: 150, code: 'OP09', tone: 'violet', category: 'set', isUnlocked: s => s.hasPrefixQuantity('op09', 5), progress: countProgress(s => s.prefixes.op09 || 0, 5) },
  { id: 'set_op13_5', title: 'Will Hunter', description: 'Possiedi 5 carte OP13.', xp: 150, code: 'OP13', tone: 'cyan', category: 'set', isUnlocked: s => s.hasPrefixQuantity('op13', 5), progress: countProgress(s => s.prefixes.op13 || 0, 5) },
  ...[
    setBadge('op02', 'Paramount War', 5, 150, 'rose'),
    setBadge('op03', 'Pillars of Strength', 5, 150, 'emerald'),
    setBadge('op04', 'Kingdoms of Intrigue', 5, 150, 'amber'),
    setBadge('op06', 'Wings of the Captain', 5, 150, 'cyan'),
    setBadge('op07', '500 Years Future', 5, 150, 'violet'),
    setBadge('op08', 'Two Legends', 5, 150, 'emerald'),
    setBadge('op10', 'Royal Blood', 5, 150, 'rose'),
    setBadge('op11', 'A Fist of Divine Speed', 5, 150, 'cyan'),
    setBadge('op12', 'Legacy of the Master', 5, 150, 'amber'),
    setBadge('op14', 'Full set hunter OP14', 5, 170, 'violet'),
    setBadge('op15', 'Full set hunter OP15', 5, 170, 'emerald'),
    setBadge('op16', 'Meta OP16', 5, 170, 'cyan'),
    setBadge('op01', 'Romance Dawn 15', 15, 380, 'amber'),
    setBadge('op05', 'Era nuova 15', 15, 380, 'rose'),
    setBadge('op09', 'Imperatori 15', 15, 380, 'violet'),
    setBadge('op13', 'Will Hunter 15', 15, 380, 'cyan'),
  ],
  { id: 'set_st_5', title: 'Starter crew', description: 'Possiedi 5 carte Starter Deck.', xp: 140, code: 'ST', tone: 'emerald', category: 'set', isUnlocked: s => Object.entries(s.prefixes).some(([key, count]) => key.startsWith('st') && count >= 5) },
  { id: 'set_eb_5', title: 'Extra booster', description: 'Possiedi 5 carte EB.', xp: 160, code: 'EB', tone: 'violet', category: 'set', isUnlocked: s => Object.entries(s.prefixes).some(([key, count]) => key.startsWith('eb') && count >= 5) },

  { id: 'theme_thriller', title: 'Ombre di Thriller Bark', description: 'Trova 3 carte tra Ryuma, Perona, Brook, Moria, Absalom o Hogback.', xp: 260, code: 'TB', tone: 'violet', category: 'crew', isUnlocked: s => ['ryuma', 'perona', 'brook', 'moria', 'absalom', 'hogback'].filter(name => s.hasName(name)).length >= 3, progress: countProgress(s => ['ryuma', 'perona', 'brook', 'moria', 'absalom', 'hogback'].filter(name => s.hasName(name)).length, 3) },
  { id: 'theme_wano', title: 'Rotta Wano', description: 'Trova 3 carte tra Oden, Kinemon, Yamato, Momonosuke, Hiyori o Kaido.', xp: 260, code: 'WAN', tone: 'emerald', category: 'crew', isUnlocked: s => ['oden', 'kinemon', 'yamato', 'momonosuke', 'hiyori', 'kaido'].filter(name => s.hasName(name)).length >= 3, progress: countProgress(s => ['oden', 'kinemon', 'yamato', 'momonosuke', 'hiyori', 'kaido'].filter(name => s.hasName(name)).length, 3) },
  { id: 'power_10000', title: 'Forza 10000', description: 'Aggiungi una carta con Power 10000 o superiore.', xp: 160, code: '10K', tone: 'rose', category: 'mastery', isUnlocked: s => s.cards.some(card => Number(card.card_power || 0) >= 10000) },
  { id: 'cost_8', title: 'Costo pesante', description: 'Aggiungi una carta con costo 8 o superiore.', xp: 140, code: 'C8', tone: 'amber', category: 'mastery', isUnlocked: s => s.cards.some(card => Number(card.card_cost || 0) >= 8) },
]

export const evaluateProgress = (
  userId: string,
  cards: ProgressCard[],
  options: { claimDaily?: boolean } = {}
): ProgressSummary => {
  const progress = loadProgressData(userId)
  return evaluateProgressWithData(userId, cards, progress, options, true)
}

const evaluateProgressWithData = (
  userId: string,
  cards: ProgressCard[],
  progress: ProgressData,
  options: { claimDaily?: boolean } = {},
  persistLocal = true
): ProgressSummary => {
  const today = todayKey()
  let dailyClaimedToday = progress.dailyClaimDates.includes(today)

  if (options.claimDaily && !dailyClaimedToday) {
    progress.dailyClaimDates = [...progress.dailyClaimDates, today]
    dailyClaimedToday = true
  }

  const stats = buildStats(cards, progress)
  const unlocked = new Set(progress.unlockedBadgeIds)
  const newlyUnlocked: BadgeDefinition[] = []

  for (const badge of BADGES) {
    if (!unlocked.has(badge.id) && badge.isUnlocked(stats)) {
      unlocked.add(badge.id)
      newlyUnlocked.push(badge)
    }
  }

  progress.unlockedBadgeIds = [...unlocked]
  if (persistLocal) saveProgressData(userId, progress)

  const xp = progress.dailyClaimDates.length * DAILY_LOGIN_XP +
    BADGES.reduce((sum, badge) => sum + (unlocked.has(badge.id) ? badgeXp(badge) : 0), 0)
  const levelInfo = getLevelInfo(xp)
  const badges = BADGES.map(badge => ({
    ...badge,
    xp: badgeXp(badge),
    unlocked: unlocked.has(badge.id),
    progressValue: badge.progress?.(stats)
  }))
  const orderedBadges = [
    ...badges.filter(badge => badge.unlocked),
    ...badges.filter(badge => !badge.unlocked)
  ]

  const scaledNewlyUnlocked = newlyUnlocked.map(withScaledXp)
  emitUnlockedBadges(newlyUnlocked)

  return {
    xp,
    ...levelInfo,
    dailyClaimedToday,
    dailyStreak: stats.dailyStreak,
    unlockedCount: badges.filter(badge => badge.unlocked).length,
    totalBadges: BADGES.length,
    badges: orderedBadges,
    newlyUnlocked: scaledNewlyUnlocked
  }
}

export const evaluateProgressSynced = async (
  userId: string,
  cards: ProgressCard[],
  options: { claimDaily?: boolean } = {}
): Promise<ProgressSummary> => {
  const localProgress = loadProgressData(userId)
  const remoteProgress = await loadRemoteProgressData(userId)

  if (!remoteProgress) {
    return evaluateProgress(userId, cards, options)
  }

  const mergedProgress = mergeProgressData(remoteProgress, localProgress)
  const summary = evaluateProgressWithData(userId, cards, mergedProgress, options, true)

  const saved = await saveRemoteProgressData(userId, {
    dailyClaimDates: summary.dailyClaimedToday
      ? [...new Set([...mergedProgress.dailyClaimDates, todayKey()])]
      : mergedProgress.dailyClaimDates,
    unlockedBadgeIds: summary.badges.filter(badge => badge.unlocked).map(badge => badge.id)
  })

  if (!saved) return evaluateProgress(userId, cards, options)
  return summary
}

export const summarizeProgress = (
  cards: ProgressCard[],
  progress: ProgressData = emptyProgressData()
): ProgressSummary => {
  const stats = buildStats(cards, progress)
  const unlocked = new Set(progress.unlockedBadgeIds)

  for (const badge of BADGES) {
    if (badge.isUnlocked(stats)) unlocked.add(badge.id)
  }

  const xp = progress.dailyClaimDates.length * DAILY_LOGIN_XP +
    BADGES.reduce((sum, badge) => sum + (unlocked.has(badge.id) ? badgeXp(badge) : 0), 0)
  const levelInfo = getLevelInfo(xp)
  const badges = BADGES.map(badge => ({
    ...badge,
    xp: badgeXp(badge),
    unlocked: unlocked.has(badge.id),
    progressValue: badge.progress?.(stats)
  }))
  const orderedBadges = [
    ...badges.filter(badge => badge.unlocked),
    ...badges.filter(badge => !badge.unlocked)
  ]

  return {
    xp,
    ...levelInfo,
    dailyClaimedToday: progress.dailyClaimDates.includes(todayKey()),
    dailyStreak: stats.dailyStreak,
    unlockedCount: orderedBadges.filter(badge => badge.unlocked).length,
    totalBadges: BADGES.length,
    badges: orderedBadges,
    newlyUnlocked: []
  }
}

export const emptyProgressSummary = (): ProgressSummary => {
  const levelInfo = getLevelInfo(0)
  return {
    xp: 0,
    ...levelInfo,
    dailyClaimedToday: false,
    dailyStreak: 0,
    unlockedCount: 0,
    totalBadges: BADGES.length,
    badges: BADGES.map(badge => ({ ...badge, xp: badgeXp(badge), unlocked: false, progressValue: { current: 0, target: 1 } })),
    newlyUnlocked: []
  }
}
