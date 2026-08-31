// Catalog IDs are case-sensitive in Postgres. OPTCG's DON IDs are lowercase,
// unlike regular card codes; keep the original as well as known source aliases.
export const catalogVariantIdAliases = (values: string[]) => [...new Set(values.flatMap(value => {
  const original = String(value || '').trim()
  if (!original) return []
  const canonical = original.toUpperCase().replace(/_([PR])(\d+)$/i, (_, kind: string, number: string) => `_${kind.toLowerCase()}${number}`)
  return /^don_/i.test(original)
    ? [original, canonical, original.toLowerCase()]
    : [original, canonical]
}))]
