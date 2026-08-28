import { readFile } from 'node:fs/promises'
import { basename, resolve } from 'node:path'
import sharp, { type OverlayOptions } from 'sharp'

type AuditRow = {
  status: string
  variantId: string
  name: string
  sourceImageUrl: string | null
  current: { productId: number | null; imageUrl: string | null }
  visual: {
    proposedProductId: number | null
    candidates: Array<{ productId: number; imageUrl: string }>
  }
}

const reportPath = resolve(process.argv[2] || '.optimizer/cardmarket-price-audit.json')
const wantedStatus = process.argv[3] || 'likely_mismatch'
const reportName = basename(reportPath, '.json')
const candidateCount = Math.max(1, Math.min(4, Number(process.argv[4] || 1)))

const fetchImage = async (url?: string | null) => {
  if (!url) return null
  const cardmarket = url.startsWith('https://product-images.s3.cardmarket.com/')
  const response = await fetch(url, {
    headers: {
      'User-Agent': 'OnePieceVault-Optimizer/1.0',
      ...(cardmarket ? { Referer: 'https://www.cardmarket.com/' } : {}),
    },
  })
  return response.ok ? Buffer.from(await response.arrayBuffer()) : null
}

const escapeXml = (value: unknown) => String(value || '').replace(/[&<>"']/g, character => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;',
})[character] || character)

const textBar = (text: string, width: number, height: number, color = '#ffffff') => Buffer.from(`
  <svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
    <rect width="${width}" height="${height}" fill="#10262d"/>
    <text x="${width / 2}" y="${Math.round(height * 0.68)}" text-anchor="middle"
      font-family="Arial" font-size="12" fill="${color}">${escapeXml(text)}</text>
  </svg>
`)

const main = async () => {
  const report = JSON.parse(await readFile(reportPath, 'utf8')) as { audits: AuditRow[] }
  const rows = report.audits.filter(row => row.status === wantedStatus)
  const perPage = candidateCount > 1 ? 6 : 8

  for (let page = 0; page < Math.ceil(rows.length / perPage); page += 1) {
    const pageRows = rows.slice(page * perPage, page * perPage + perPage)
    const columnCount = 2 + candidateCount
    const columnWidth = 185
    const width = 15 + columnCount * columnWidth
    const rowHeight = 270
    const composites: OverlayOptions[] = []

    for (let rowIndex = 0; rowIndex < pageRows.length; rowIndex += 1) {
      const row = pageRows[rowIndex]
      const candidates = row.visual.candidates.slice(0, candidateCount)
      const urls = [row.sourceImageUrl, row.current.imageUrl, ...candidates.map(candidate => candidate.imageUrl)]
      const labels = [
        'OPV',
        `ATTUALE ${row.current.productId || '-'}`,
        ...candidates.map((candidate, index) => `${index === 0 ? 'PROPOSTA' : `CAND. ${index + 1}`} ${candidate.productId}`),
      ]
      const top = rowIndex * rowHeight

      for (let column = 0; column < columnCount; column += 1) {
        const source = await fetchImage(urls[column])
        if (source) {
          const image = await sharp(source)
            .resize(150, 210, { fit: 'contain', background: '#132c34' })
            .toBuffer()
          composites.push({ input: image, left: 20 + column * 185, top: top + 32 })
        }
        composites.push({ input: textBar(labels[column], 170, 28), left: 10 + column * 185, top })
      }

      composites.push({
        input: textBar(`${row.variantId} - ${row.name}`, width - 10, 24, '#ffd45a'),
        left: 5,
        top: top + 243,
      })
    }

    await sharp({
      create: { width, height: pageRows.length * rowHeight, channels: 3, background: '#0b2027' },
    })
      .composite(composites)
      .png()
      .toFile(resolve(`.optimizer/${reportName}-${wantedStatus}${candidateCount > 1 ? `-top-${candidateCount}` : ''}-sheet-${page + 1}.png`))
  }

  console.log(`Create ${Math.ceil(rows.length / perPage)} tavole per ${rows.length} casi probabili.`)
}

main().catch(error => {
  console.error(error)
  process.exitCode = 1
})
