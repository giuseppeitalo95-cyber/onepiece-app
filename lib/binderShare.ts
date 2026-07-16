import type { BinderCard, BinderRecord } from '@/lib/binders'

const loadImage = (src: string) => new Promise<HTMLImageElement>((resolve, reject) => {
  const image = new Image()
  image.onload = () => resolve(image)
  image.onerror = reject
  image.src = src.startsWith('/') ? src : `/api/cards/recognition-image?url=${encodeURIComponent(src)}`
})

const roundedRect = (ctx: CanvasRenderingContext2D, x: number, y: number, width: number, height: number, radius: number) => {
  const safeRadius = Math.min(radius, width / 2, height / 2)
  ctx.beginPath()
  ctx.moveTo(x + safeRadius, y)
  ctx.lineTo(x + width - safeRadius, y)
  ctx.arcTo(x + width, y, x + width, y + safeRadius, safeRadius)
  ctx.lineTo(x + width, y + height - safeRadius)
  ctx.arcTo(x + width, y + height, x + width - safeRadius, y + height, safeRadius)
  ctx.lineTo(x + safeRadius, y + height)
  ctx.arcTo(x, y + height, x, y + height - safeRadius, safeRadius)
  ctx.lineTo(x, y + safeRadius)
  ctx.arcTo(x, y, x + safeRadius, y, safeRadius)
  ctx.closePath()
}

const drawCoverImage = (ctx: CanvasRenderingContext2D, image: HTMLImageElement, x: number, y: number, width: number, height: number) => {
  const scale = Math.max(width / image.naturalWidth, height / image.naturalHeight)
  const sourceWidth = width / scale
  const sourceHeight = height / scale
  ctx.drawImage(image, (image.naturalWidth - sourceWidth) / 2, (image.naturalHeight - sourceHeight) / 2, sourceWidth, sourceHeight, x, y, width, height)
}

const drawContainedImage = (ctx: CanvasRenderingContext2D, image: HTMLImageElement, x: number, y: number, width: number, height: number) => {
  const scale = Math.min(width / image.naturalWidth, height / image.naturalHeight)
  const drawWidth = image.naturalWidth * scale
  const drawHeight = image.naturalHeight * scale
  ctx.drawImage(image, x + (width - drawWidth) / 2, y + (height - drawHeight) / 2, drawWidth, drawHeight)
}

const getCardImage = async (card: BinderCard | null) => {
  if (!card) return null
  const candidates = [card.image_url, `https://en.onepiece-cardgame.com/images/cardlist/card/${card.card_id}.png`].filter(Boolean) as string[]
  for (const source of candidates) {
    try {
      return await loadImage(source)
    } catch {
      // Try the next known source.
    }
  }
  return null
}

export const binderShareText = (binder: BinderRecord) =>
  `Questo e il mio raccoglitore personalizzato "${binder.title}". Crealo anche tu con OPV, clicca qui:`

export const createBinderShareImage = async (binder: BinderRecord, spreadIndex: number, username: string) => {
  const canvas = document.createElement('canvas')
  canvas.width = 1600
  canvas.height = 1100
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Canvas non disponibile')

  const background = ctx.createLinearGradient(0, 0, canvas.width, canvas.height)
  background.addColorStop(0, '#173f48')
  background.addColorStop(0.55, '#245965')
  background.addColorStop(1, '#122d35')
  ctx.fillStyle = background
  ctx.fillRect(0, 0, canvas.width, canvas.height)

  ctx.fillStyle = 'rgba(255,255,255,0.05)'
  for (let x = -300; x < 1800; x += 160) {
    ctx.save()
    ctx.translate(x, 0)
    ctx.rotate(-0.22)
    ctx.fillRect(0, -100, 2, 1500)
    ctx.restore()
  }

  const shell = { x: 95, y: 210, width: 1410, height: 760 }
  ctx.save()
  ctx.shadowColor = 'rgba(0,0,0,0.48)'
  ctx.shadowBlur = 46
  ctx.shadowOffsetY = 26
  roundedRect(ctx, shell.x, shell.y, shell.width, shell.height, 54)
  ctx.fillStyle = binder.cover_color
  ctx.fill()
  ctx.restore()

  if (binder.cover_image_url) {
    try {
      const cover = await loadImage(binder.cover_image_url)
      ctx.save()
      roundedRect(ctx, shell.x, shell.y, shell.width, shell.height, 54)
      ctx.clip()
      ctx.globalAlpha = 0.28
      drawCoverImage(ctx, cover, shell.x, shell.y, shell.width, shell.height)
      ctx.restore()
    } catch {
      // The selected color remains a complete cover if the image fails.
    }
  }

  const pageGap = 42
  const pageWidth = (shell.width - 132 - pageGap) / 2
  const pageHeight = shell.height - 94
  const pageY = shell.y + 47
  const leftX = shell.x + 45
  const rightX = leftX + pageWidth + pageGap
  const pageIndexes = [spreadIndex * 2, spreadIndex * 2 + 1]

  for (let side = 0; side < 2; side += 1) {
    const pageX = side === 0 ? leftX : rightX
    roundedRect(ctx, pageX, pageY, pageWidth, pageHeight, 18)
    ctx.fillStyle = 'rgba(226,232,240,0.20)'
    ctx.fill()
    ctx.strokeStyle = 'rgba(255,255,255,0.42)'
    ctx.lineWidth = 2
    ctx.stroke()

    const slots = binder.pages[pageIndexes[side]]?.slots || []
    const padding = 28
    const gap = binder.columns_count >= 4 ? 11 : 16
    const slotWidth = (pageWidth - padding * 2 - gap * (binder.columns_count - 1)) / binder.columns_count
    const slotHeight = (pageHeight - padding * 2 - gap * (binder.rows_count - 1)) / binder.rows_count

    for (let row = 0; row < binder.rows_count; row += 1) {
      for (let column = 0; column < binder.columns_count; column += 1) {
        const index = row * binder.columns_count + column
        const x = pageX + padding + column * (slotWidth + gap)
        const y = pageY + padding + row * (slotHeight + gap)
        roundedRect(ctx, x, y, slotWidth, slotHeight, 9)
        ctx.fillStyle = 'rgba(15,23,42,0.40)'
        ctx.fill()
        ctx.strokeStyle = 'rgba(255,255,255,0.30)'
        ctx.stroke()

        const cardImage = await getCardImage(slots[index] || null)
        if (cardImage) drawContainedImage(ctx, cardImage, x + 5, y + 5, slotWidth - 10, slotHeight - 10)

        const shine = ctx.createLinearGradient(x, y, x + slotWidth, y + slotHeight)
        shine.addColorStop(0.05, 'rgba(255,255,255,0.20)')
        shine.addColorStop(0.32, 'rgba(255,255,255,0)')
        shine.addColorStop(1, 'rgba(255,255,255,0.07)')
        roundedRect(ctx, x, y, slotWidth, slotHeight, 9)
        ctx.fillStyle = shine
        ctx.fill()
      }
    }
  }

  ctx.fillStyle = 'rgba(0,0,0,0.34)'
  roundedRect(ctx, shell.x + shell.width / 2 - 20, shell.y + 25, 40, shell.height - 50, 18)
  ctx.fill()

  ctx.fillStyle = '#ffffff'
  ctx.font = '900 56px system-ui, sans-serif'
  ctx.fillText(binder.title, 96, 105)
  ctx.fillStyle = '#a5f3fc'
  ctx.font = '700 25px system-ui, sans-serif'
  ctx.fillText(`Raccoglitore di ${username || 'Giocatore OPV'}`, 98, 150)

  try {
    const [hat, textLogo] = await Promise.all([loadImage('/opv-hat-cutout.png'), loadImage('/opv-text-cutout.png')])
    drawContainedImage(ctx, hat, 1310, 34, 150, 74)
    drawContainedImage(ctx, textLogo, 1306, 104, 160, 54)
  } catch {
    ctx.fillStyle = '#fde68a'
    ctx.font = '900 42px system-ui, sans-serif'
    ctx.fillText('OPV', 1360, 110)
  }

  ctx.fillStyle = 'rgba(255,255,255,0.75)'
  ctx.font = '700 22px system-ui, sans-serif'
  ctx.fillText(window.location.host, 96, 1040)

  const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/png', 0.96))
  if (!blob) throw new Error('Immagine non generata')
  const safeTitle = binder.title.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase() || 'raccoglitore'
  return new File([blob], `opv-${safeTitle}.png`, { type: 'image/png' })
}

export const shareBinder = async (binder: BinderRecord, spreadIndex: number, username: string) => {
  const file = await createBinderShareImage(binder, spreadIndex, username)
  const url = `${window.location.origin}/binders/${binder.id}`
  const text = binderShareText(binder)

  if (navigator.share) {
    const payload: ShareData = { title: binder.title, text, url }
    const canShareImage = Boolean(navigator.canShare?.({ files: [file] }))
    if (canShareImage) payload.files = [file]
    else downloadFile(file)
    await navigator.share(payload)
    return canShareImage ? 'Condivisione aperta.' : 'Immagine salvata e condivisione aperta.'
  }

  downloadFile(file)
  await navigator.clipboard?.writeText(`${text} ${url}`)
  return 'Immagine salvata e testo copiato.'
}

const downloadFile = (file: File) => {
  const downloadUrl = URL.createObjectURL(file)
  const anchor = document.createElement('a')
  anchor.href = downloadUrl
  anchor.download = file.name
  anchor.click()
  window.setTimeout(() => URL.revokeObjectURL(downloadUrl), 1500)
}
