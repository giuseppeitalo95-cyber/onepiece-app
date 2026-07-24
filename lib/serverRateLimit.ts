type RateLimitEntry = {
  count: number
  resetAt: number
}

type RateLimitOptions = {
  scope: string
  limit: number
  windowMs: number
}

const buckets = new Map<string, RateLimitEntry>()
const MAX_BUCKETS = 20_000

const compactHash = (value: string) => {
  let hash = 2166136261
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return (hash >>> 0).toString(36)
}

const requestIdentity = (request: Request) => {
  const authorization = request.headers.get('authorization')
  if (authorization) return `auth:${compactHash(authorization)}`

  const forwarded = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
  return `ip:${forwarded || request.headers.get('x-real-ip') || 'unknown'}`
}

const pruneBuckets = (now: number) => {
  if (buckets.size < MAX_BUCKETS) return
  for (const [key, entry] of buckets) {
    if (entry.resetAt <= now || buckets.size >= MAX_BUCKETS) buckets.delete(key)
    if (buckets.size < MAX_BUCKETS) break
  }
}

export const checkRateLimit = (request: Request, options: RateLimitOptions) => {
  const now = Date.now()
  pruneBuckets(now)

  const key = `${options.scope}:${requestIdentity(request)}`
  const current = buckets.get(key)
  const entry = !current || current.resetAt <= now
    ? { count: 0, resetAt: now + options.windowMs }
    : current
  entry.count += 1
  buckets.set(key, entry)

  return {
    allowed: entry.count <= options.limit,
    remaining: Math.max(0, options.limit - entry.count),
    retryAfterSeconds: Math.max(1, Math.ceil((entry.resetAt - now) / 1000)),
  }
}

export const rateLimitResponse = (retryAfterSeconds: number) =>
  Response.json(
    { error: 'Troppe richieste. Riprova tra qualche secondo.' },
    {
      status: 429,
      headers: { 'Retry-After': String(retryAfterSeconds) },
    }
  )
