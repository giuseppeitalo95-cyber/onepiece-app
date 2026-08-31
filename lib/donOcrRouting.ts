export const looksLikeDonOcrText = (value: string) => {
  const normalized = value.toLowerCase().replace(/[^a-z0-9]/g, ' ')
  const hasPrintedDon = /DON\s*!{1,2}/i.test(value)
  const hasDonBoost = /\bYOUR\s+TURN\b/i.test(value) && /\+?\s*1000\b/.test(value)
  const hasNormalCardText = /\b(characters?|leaders?|event|stage|counter|trigger|cost|power|activate|on\s+play)\b/.test(normalized)

  // ST15-002 mentions "DON!! card" in its effect. Normal card evidence must
  // veto BOTH DON hints, otherwise we skip text matching and search DON art.
  return !hasNormalCardText && (hasPrintedDon || hasDonBoost)
}
