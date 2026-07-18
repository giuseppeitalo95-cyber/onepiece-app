import { GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3'
import sharp from 'sharp'
import { isAdminAccount } from '@/lib/admin'
import { encodeBinderKit, type BinderKit } from '@/lib/binderKits'
import { getR2Config, getR2PublicUrl, getR2SafetyLimitBytes, getR2Usage } from '@/lib/r2Storage'
import { requireServiceClient } from '@/lib/serverSupabase'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const MANIFEST_KEY = 'binder-kits/manifest.json'
const MAX_FILE_BYTES = 7_000_000

const storage = () => {
  const config = getR2Config()
  if (!config) throw new Error('Cloudflare R2 non configurato.')
  const client = new S3Client({
    region: 'auto',
    endpoint: `https://${config.accountId}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey },
  })
  return { client, config }
}

const readManifest = async (): Promise<BinderKit[]> => {
  const { client, config } = storage()
  try {
    const result = await client.send(new GetObjectCommand({ Bucket: config.bucket, Key: MANIFEST_KEY }))
    const data = JSON.parse(await result.Body!.transformToString())
    return Array.isArray(data?.kits) ? data.kits : []
  } catch (error) {
    const status = (error as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode
    if (status === 404) return []
    throw error
  }
}

const writeManifest = async (kits: BinderKit[]) => {
  const { client, config } = storage()
  await client.send(new PutObjectCommand({
    Bucket: config.bucket,
    Key: MANIFEST_KEY,
    Body: JSON.stringify({ kits }),
    ContentType: 'application/json; charset=utf-8',
    CacheControl: 'no-cache',
  }))
}

const getAdmin = async (request: Request) => {
  const db = requireServiceClient()
  const token = (request.headers.get('authorization') || '').replace(/^Bearer\s+/i, '')
  if (!token) return null
  const { data: { user } } = await db.auth.getUser(token)
  if (!user) return null
  const { data: profile } = await db.from('profiles').select('username').eq('id', user.id).maybeSingle()
  return isAdminAccount(user, profile) ? user : null
}

const safeId = (value: string) => value.toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-|-$/g, '').slice(0, 80)

const processImage = async (file: File, width: number, height: number) => {
  if (!file.type.startsWith('image/')) throw new Error('Carica soltanto immagini PNG, JPG o WebP.')
  if (file.size > MAX_FILE_BYTES) throw new Error('Ogni immagine deve pesare meno di 7 MB.')
  return sharp(Buffer.from(await file.arrayBuffer()))
    .rotate()
    .resize(width, height, { fit: 'cover', position: 'centre' })
    .webp({ quality: 90, effort: 4 })
    .toBuffer()
}

const uploadImage = async (kitId: string, slot: string, file: File, width: number, height: number) => {
  const body = await processImage(file, width, height)
  const usage = await getR2Usage()
  if (usage.bytes + body.length > getR2SafetyLimitBytes()) throw new Error('Limite di sicurezza R2 raggiunto.')
  const { client, config } = storage()
  const key = `binder-kits/${safeId(kitId)}/${slot}-${Date.now()}.webp`
  await client.send(new PutObjectCommand({
    Bucket: config.bucket,
    Key: key,
    Body: body,
    ContentType: 'image/webp',
    CacheControl: 'public, max-age=31536000, immutable',
  }))
  return { key, url: getR2PublicUrl(key)! }
}

export async function GET() {
  try {
    return Response.json({ ok: true, kits: await readManifest() }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (error) {
    return Response.json({ ok: false, kits: [], error: error instanceof Error ? error.message : 'Kit non disponibili.' }, { status: 500 })
  }
}

export async function POST(request: Request) {
  try {
    if (!(await getAdmin(request))) return Response.json({ ok: false, error: 'Accesso Admin richiesto.' }, { status: 403 })
    const form = await request.formData()
    const title = String(form.get('title') || '').trim().slice(0, 80)
    const requestedId = String(form.get('id') || '').trim()
    if (!title) throw new Error('Inserisci il titolo del kit.')

    const kits = await readManifest()
    const existing = kits.find(kit => kit.id === requestedId)
    const id = existing?.id || crypto.randomUUID()
    const specs = {
      closed: [1536, 2048],
      open: [2400, 1620],
      left: [1440, 2000],
      right: [1440, 2000],
    } as const
    const urls: Record<string, string> = {
      closed: existing?.closed_url || '', open: existing?.open_url || '',
      left: existing?.left_url || '', right: existing?.right_url || '',
    }

    for (const [slot, [width, height]] of Object.entries(specs)) {
      const file = form.get(slot)
      if (file instanceof File && file.size > 0) urls[slot] = (await uploadImage(id, slot, file, width, height)).url
    }
    if (Object.values(urls).some(value => !value)) throw new Error('Per un nuovo kit sono obbligatorie tutte e quattro le immagini.')

    const now = new Date().toISOString()
    const kit: BinderKit = {
      id, title,
      closed_url: urls.closed, open_url: urls.open,
      left_url: urls.left, right_url: urls.right,
      created_at: existing?.created_at || now,
      updated_at: now,
    }
    await writeManifest([kit, ...kits.filter(item => item.id !== id)])
    if (existing) {
      const db = requireServiceClient()
      const oldReference = encodeBinderKit(existing)
      const newReference = encodeBinderKit(kit)
      const { data: usedBinders } = await db.from('binders').select('id').eq('cover_image_url', oldReference)
      await db.from('binders').update({ cover_image_url: newReference }).eq('cover_image_url', oldReference)
      const binderIds = (usedBinders || []).map(item => item.id)
      if (binderIds.length) await db.from('board_posts').update({ card_image_url: kit.closed_url }).in('binder_id', binderIds)
    }
    return Response.json({ ok: true, kit })
  } catch (error) {
    return Response.json({ ok: false, error: error instanceof Error ? error.message : 'Salvataggio non riuscito.' }, { status: 400 })
  }
}

export async function DELETE(request: Request) {
  try {
    if (!(await getAdmin(request))) return Response.json({ ok: false, error: 'Accesso Admin richiesto.' }, { status: 403 })
    const id = String((await request.json().catch(() => null))?.id || '')
    const kits = await readManifest()
    const kit = kits.find(item => item.id === id)
    if (!kit) return Response.json({ ok: false, error: 'Kit non trovato.' }, { status: 404 })
    await writeManifest(kits.filter(item => item.id !== id))

    return Response.json({ ok: true })
  } catch (error) {
    return Response.json({ ok: false, error: error instanceof Error ? error.message : 'Eliminazione non riuscita.' }, { status: 400 })
  }
}
