import {
  constants,
  createCipheriv,
  createHash,
  createPublicKey,
  publicEncrypt,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const EXPIRES_AT = 1784270969334
const TOKEN_HASH = Buffer.from('c485def849cbaa0c035d04dc874bcb6aa48bcafe73c0dea998daca9a77386f22', 'hex')
const PUBLIC_KEY_DER = 'MIICIjANBgkqhkiG9w0BAQEFAAOCAg8AMIICCgKCAgEAy49NCOm6dnuyJAtulL2+qlcycKVA6v09nqn7PiFNPDqHBDeV6fQBwOnDa3bjdYjhY2sjhkIg47wAcDAEqWciK8STAJMFltauq8Xv9y/PqMtNijcPU5/6tmWkeAvVL6xR0zvmR6u+FEwoRhS5Q1Daz5qWpKt1F9BW3vXkO/htC+e4wwYcXbQYCpnQGYlvIUYg2ESAgAzWvubGzzjmvOOykww33LjMtoUf6EAc0YBZt0yW5hrc9IRYCKwNRXTzf3+dpjE6jFBzHI+XYfXkJHaDXpfnhqOx3tLgJTYbaQ9O6qPM3F/kNmlSP9/CaA2xITMfnSHqqXM6Yodr1r6G5ya2RnAjBZKOy0sVkTrIVmXmQldYzv6S458MAnGcOvSFrILlbtaBqd3fB/CBh41eOgTn0DtF2jJzl89DjAoV0zKV/ZL5FUM2pI8P4YFu1iZir5WWlWsJJEzzZk3gz/NTqPvT2jiZm3nSr+8RCzNUykzqs+JM/ZXMiAeSNFW7T36yT7o1qivgQ5tSaN2J6jDQdnFgh1ZrQxhCV13l355B/FoBoHRuk5FWB9JLUcFJaXUBRKI+wnInp7t813VUnBvsJCX3sDYHEQrqT0sdMhKNqNAdW5r33CjsEMTzFTEy/v5rqD44e3f7YAO8w5rp1JpUtwKjhnSIwczrriOD930MBQXgFxMCAwEAAQ=='

const ENV_KEYS = [
  'R2_PUBLIC_BASE_URL',
  'R2_BUCKET_NAME',
  'R2_SECRET_ACCESS_KEY',
  'R2_ACCESS_KEY_ID',
  'R2_ACCOUNT_ID',
  'MAINTENANCE_SECRET',
  'CARDMARKET_SYNC_SECRET',
  'CRON_SECRET',
  'VAPID_SUBJECT',
  'VAPID_PRIVATE_KEY',
  'NEXT_PUBLIC_VAPID_PUBLIC_KEY',
  'STRIPE_WEBHOOK_SECRET',
  'STRIPE_PREMIUM_PRICE_ID',
  'STRIPE_SECRET_KEY',
  'SUPABASE_SERVICE_ROLE_KEY',
  'NEXT_PUBLIC_SUPABASE_URL',
  'GOOGLE_VISION_API_KEY',
] as const

const unauthorized = () => Response.json({ error: 'Unauthorized' }, {
  status: 401,
  headers: { 'Cache-Control': 'no-store' },
})

export async function GET(request: Request) {
  if (Date.now() > EXPIRES_AT) {
    return Response.json({ error: 'Transfer expired' }, {
      status: 410,
      headers: { 'Cache-Control': 'no-store' },
    })
  }

  const token = (request.headers.get('authorization') || '').replace(/^Bearer\s+/i, '')
  const receivedHash = createHash('sha256').update(token).digest()
  if (!token || receivedHash.length !== TOKEN_HASH.length || !timingSafeEqual(receivedHash, TOKEN_HASH)) {
    return unauthorized()
  }

  const values = Object.fromEntries(ENV_KEYS.map(key => [key, process.env[key] || '']))

  const encryptionKey = randomBytes(32)
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', encryptionKey, iv)
  const encrypted = Buffer.concat([
    cipher.update(Buffer.from(JSON.stringify(values), 'utf8')),
    cipher.final(),
  ])
  const publicKey = createPublicKey({
    key: Buffer.from(PUBLIC_KEY_DER, 'base64'),
    format: 'der',
    type: 'spki',
  })
  const wrappedKey = publicEncrypt({
    key: publicKey,
    padding: constants.RSA_PKCS1_OAEP_PADDING,
    oaepHash: 'sha256',
  }, encryptionKey)

  return Response.json({
    algorithm: 'RSA-OAEP-4096/AES-256-GCM',
    key: wrappedKey.toString('base64'),
    iv: iv.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'),
    data: encrypted.toString('base64'),
    expiresAt: EXPIRES_AT,
  }, {
    headers: { 'Cache-Control': 'no-store' },
  })
}
