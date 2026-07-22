import { createHash } from 'node:crypto'
import {
  DeleteObjectCommand,
  HeadBucketCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3'
import sharp from 'sharp'

const DEFAULT_FREE_TIER_BYTES = 10_000_000_000
const DEFAULT_SAFETY_LIMIT_BYTES = 9_000_000_000
const MAX_SOURCE_IMAGE_BYTES = 15_000_000

type R2Config = {
  accountId: string
  accessKeyId: string
  secretAccessKey: string
  bucket: string
  publicBaseUrl: string
}

type UsageCache = {
  expiresAt: number
  objects: number
  bytes: number
}

let clientCache: S3Client | null = null
let usageCache: UsageCache | null = null

const trimSlash = (value: string) => value.replace(/\/+$/, '')

export const getR2Config = (): R2Config | null => {
  const accountId = process.env.R2_ACCOUNT_ID?.trim()
  const accessKeyId = process.env.R2_ACCESS_KEY_ID?.trim()
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY?.trim()
  const bucket = process.env.R2_BUCKET_NAME?.trim()
  const publicBaseUrl = process.env.R2_PUBLIC_BASE_URL?.trim()

  if (!accountId || !accessKeyId || !secretAccessKey || !bucket || !publicBaseUrl) return null

  return {
    accountId,
    accessKeyId,
    secretAccessKey,
    bucket,
    publicBaseUrl: trimSlash(publicBaseUrl),
  }
}

export const isR2Configured = () => Boolean(getR2Config())

const getClient = () => {
  const config = getR2Config()
  if (!config) throw new Error('Cloudflare R2 non configurato')

  if (!clientCache) {
    clientCache = new S3Client({
      region: 'auto',
      endpoint: `https://${config.accountId}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey,
      },
    })
  }

  return { client: clientCache, config }
}

export const getR2SafetyLimitBytes = () => {
  const configured = Number(process.env.R2_SAFETY_LIMIT_BYTES || DEFAULT_SAFETY_LIMIT_BYTES)
  return Number.isFinite(configured) && configured > 0
    ? Math.min(configured, DEFAULT_FREE_TIER_BYTES)
    : DEFAULT_SAFETY_LIMIT_BYTES
}

export const getR2FreeTierBytes = () => DEFAULT_FREE_TIER_BYTES

const sanitizeKeyPart = (value: string) => value
  .trim()
  .toLowerCase()
  .replace(/[^a-z0-9_-]+/g, '-')
  .replace(/^-+|-+$/g, '')
  .slice(0, 100)

export const buildCardImageKey = (variantId: string | null | undefined, sourceUrl: string) => {
  const fallbackId = sourceUrl.match(/([A-Z]{1,4}\d{2}-\d{3}(?:_p\d+)?)/i)?.[1] || 'card'
  const safeId = sanitizeKeyPart(variantId || fallbackId) || 'card'
  const normalizedUrl = new URL(sourceUrl)
  normalizedUrl.hash = ''
  normalizedUrl.search = ''
  const hash = createHash('sha1').update(normalizedUrl.toString()).digest('hex').slice(0, 12)
  return `cards/${safeId}-${hash}.webp`
}

export const getR2PublicUrl = (key: string) => {
  const config = getR2Config()
  if (!config) return null
  return `${config.publicBaseUrl}/${key.split('/').map(encodeURIComponent).join('/')}`
}

export const isR2PublicUrl = (url: string) => {
  const config = getR2Config()
  return Boolean(config && trimSlash(url).startsWith(`${config.publicBaseUrl}/`))
}

const isPrivateIpv4 = (hostname: string) => {
  const parts = hostname.split('.').map(Number)
  if (parts.length !== 4 || parts.some(part => !Number.isInteger(part))) return false
  return parts[0] === 10
    || parts[0] === 127
    || (parts[0] === 169 && parts[1] === 254)
    || (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31)
    || (parts[0] === 192 && parts[1] === 168)
}

export const assertSafeRemoteImageUrl = (value: string) => {
  const url = new URL(value)
  if (url.protocol !== 'https:') throw new Error('Sono consentite solo immagini HTTPS')
  const hostname = url.hostname.toLowerCase()
  if (hostname === 'localhost' || hostname === '::1' || isPrivateIpv4(hostname)) {
    throw new Error('Host immagine non consentito')
  }
  const configuredR2Host = getR2Config() ? new URL(getR2Config()!.publicBaseUrl).hostname.toLowerCase() : null
  const allowed = hostname === configuredR2Host
    || hostname === 'en.onepiece-cardgame.com'
    || hostname.endsWith('.onepiece-cardgame.com')
    || hostname === 'optcgapi.com'
    || hostname.endsWith('.optcgapi.com')
    || hostname === 'product-images.s3.cardmarket.com'
    || hostname.endsWith('.supabase.co')
    || hostname.endsWith('.r2.dev')
  if (!allowed) throw new Error('Sorgente immagine non autorizzata')
  return url
}

export const getR2Usage = async (force = false) => {
  if (!force && usageCache && usageCache.expiresAt > Date.now()) return usageCache

  const { client, config } = getClient()
  let continuationToken: string | undefined
  let objects = 0
  let bytes = 0

  do {
    const result = await client.send(new ListObjectsV2Command({
      Bucket: config.bucket,
      ContinuationToken: continuationToken,
      MaxKeys: 1000,
    }))
    for (const object of result.Contents || []) {
      objects += 1
      bytes += Number(object.Size || 0)
    }
    continuationToken = result.IsTruncated ? result.NextContinuationToken : undefined
  } while (continuationToken)

  usageCache = { expiresAt: Date.now() + 5 * 60 * 1000, objects, bytes }
  return usageCache
}

export const listR2Objects = async ({
  prefix = '',
  continuationToken,
  limit = 60,
}: {
  prefix?: string
  continuationToken?: string
  limit?: number
}) => {
  const { client, config } = getClient()
  const result = await client.send(new ListObjectsV2Command({
    Bucket: config.bucket,
    Prefix: prefix.trim().slice(0, 500) || undefined,
    ContinuationToken: continuationToken || undefined,
    MaxKeys: Math.min(100, Math.max(1, limit)),
  }))

  return {
    objects: (result.Contents || []).map(object => ({
      key: String(object.Key || ''),
      bytes: Number(object.Size || 0),
      updatedAt: object.LastModified?.toISOString() || null,
      etag: object.ETag?.replace(/"/g, '') || null,
      publicUrl: object.Key ? getR2PublicUrl(object.Key) : null,
    })).filter(object => Boolean(object.key)),
    nextToken: result.IsTruncated ? result.NextContinuationToken || null : null,
  }
}

export const deleteR2Object = async (key: string) => {
  const cleanKey = key.trim()
  if (!cleanKey || cleanKey.length > 1000) throw new Error('Chiave R2 non valida')
  const { client, config } = getClient()
  await client.send(new DeleteObjectCommand({ Bucket: config.bucket, Key: cleanKey }))
  usageCache = null
}

const objectExists = async (key: string) => {
  const { client, config } = getClient()
  try {
    const result = await client.send(new HeadObjectCommand({ Bucket: config.bucket, Key: key }))
    return { exists: true, bytes: Number(result.ContentLength || 0) }
  } catch (error) {
    const status = (error as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode
    if (status === 404) return { exists: false, bytes: 0 }
    throw error
  }
}

const downloadAndCompressImage = async (sourceUrl: string) => {
  assertSafeRemoteImageUrl(sourceUrl)
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 10_000)

  try {
    const hostname = new URL(sourceUrl).hostname.toLowerCase()
    const response = await fetch(sourceUrl, {
      headers: {
        'User-Agent': 'OnePieceVault/1.0',
        ...(hostname === 'product-images.s3.cardmarket.com'
          ? { Referer: 'https://www.cardmarket.com/' }
          : {}),
      },
      signal: controller.signal,
      cache: 'no-store',
    })
    if (!response.ok) throw new Error(`Immagine sorgente non disponibile (${response.status})`)

    const contentLength = Number(response.headers.get('content-length') || 0)
    if (contentLength > MAX_SOURCE_IMAGE_BYTES) throw new Error('Immagine sorgente troppo grande')

    const source = Buffer.from(await response.arrayBuffer())
    if (source.length > MAX_SOURCE_IMAGE_BYTES) throw new Error('Immagine sorgente troppo grande')

    return sharp(source)
      .rotate()
      .resize({ width: 1000, height: 1400, fit: 'inside', withoutEnlargement: true })
      .webp({ quality: 84, effort: 4 })
      .toBuffer()
  } finally {
    clearTimeout(timeout)
  }
}

export const mirrorCardImage = async ({
  sourceUrl,
  variantId,
  force = false,
}: {
  sourceUrl: string
  variantId?: string | null
  force?: boolean
}) => {
  const { client, config } = getClient()
  const key = buildCardImageKey(variantId, sourceUrl)
  const publicUrl = getR2PublicUrl(key)
  if (!publicUrl) throw new Error('URL pubblico R2 non configurato')

  if (!force) {
    const existing = await objectExists(key)
    if (existing.exists) return { key, publicUrl, bytes: existing.bytes, created: false }
  }

  const image = await downloadAndCompressImage(sourceUrl)
  const usage = await getR2Usage()
  const safetyLimit = getR2SafetyLimitBytes()
  if (usage.bytes + image.length > safetyLimit) {
    throw new Error(`Limite di sicurezza R2 raggiunto (${safetyLimit} byte)`)
  }

  await client.send(new PutObjectCommand({
    Bucket: config.bucket,
    Key: key,
    Body: image,
    ContentType: 'image/webp',
    CacheControl: 'public, max-age=31536000, immutable',
    Metadata: {
      source: sourceUrl.slice(0, 1900),
      variant: String(variantId || '').slice(0, 120),
    },
  }))

  usageCache = {
    expiresAt: Date.now() + 5 * 60 * 1000,
    objects: usage.objects + 1,
    bytes: usage.bytes + image.length,
  }

  return { key, publicUrl, bytes: image.length, created: true }
}

export const getR2Status = async () => {
  const config = getR2Config()
  if (!config) {
    return {
      configured: false,
      online: false,
      objects: 0,
      bytes: 0,
      limitBytes: getR2SafetyLimitBytes(),
      freeTierBytes: getR2FreeTierBytes(),
      error: 'Variabili R2 mancanti',
    }
  }

  const startedAt = Date.now()
  try {
    const { client } = getClient()
    await client.send(new HeadBucketCommand({ Bucket: config.bucket }))
    const usage = await getR2Usage(true)
    return {
      configured: true,
      online: true,
      bucket: config.bucket,
      publicBaseUrl: config.publicBaseUrl,
      objects: usage.objects,
      bytes: usage.bytes,
      limitBytes: getR2SafetyLimitBytes(),
      freeTierBytes: getR2FreeTierBytes(),
      latencyMs: Date.now() - startedAt,
      error: null,
    }
  } catch (error) {
    return {
      configured: true,
      online: false,
      bucket: config.bucket,
      publicBaseUrl: config.publicBaseUrl,
      objects: 0,
      bytes: 0,
      limitBytes: getR2SafetyLimitBytes(),
      freeTierBytes: getR2FreeTierBytes(),
      latencyMs: Date.now() - startedAt,
      error: error instanceof Error ? error.message : 'R2 non raggiungibile',
    }
  }
}
