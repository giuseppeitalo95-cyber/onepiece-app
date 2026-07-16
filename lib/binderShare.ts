import { binderSpreadIndexes, type BinderCard, type BinderRecord } from '@/lib/binders'

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
  const candidates = [card.image_url].filter(Boolean) as string[]
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
  `Questo è il mio raccoglitore personalizzato "${binder.title}". Crealo anche tu con OPV, clicca qui:`

export const createBinderShareImage = async (binder: BinderRecord, spreadIndex: number, username: string) => {
  const canvas = document.createElement('canvas')
  canvas.width = 2048
  canvas.height = 2048
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Canvas non disponibile')

  const background = ctx.createLinearGradient(0, 0, canvas.width, canvas.height)
  background.addColorStop(0, '#1d5260')
  background.addColorStop(0.55, '#276b78')
  background.addColorStop(1, '#133943')
  ctx.fillStyle = background
  ctx.fillRect(0, 0, canvas.width, canvas.height)

  ctx.fillStyle = 'rgba(255,255,255,0.045)'
  for (let x = -500; x < 2500; x += 190) {
    ctx.save()
    ctx.translate(x, 0)
    ctx.rotate(-0.2)
    ctx.fillRect(0, -300, 3, 2800)
    ctx.restore()
  }

  const shell = { x: 80, y: 390, width: 1888, height: 1370 }
  ctx.save()
  ctx.shadowColor = 'rgba(0,0,0,0.48)'
  ctx.shadowBlur = 70
  ctx.shadowOffsetY = 35
  roundedRect(ctx, shell.x, shell.y, shell.width, shell.height, 70)
  ctx.fillStyle = binder.cover_color
  ctx.fill()
  ctx.restore()

  if (binder.cover_image_url) {
    try {
      const cover = await loadImage(binder.cover_image_url)
      ctx.save()
      roundedRect(ctx, shell.x, shell.y, shell.width, shell.height, 70)
      ctx.clip()
      ctx.globalAlpha = 0.25
      drawCoverImage(ctx, cover, shell.x, shell.y, shell.width, shell.height)
      ctx.restore()
    } catch {
      // The selected color remains a complete cover if the image fails.
    }
  }

  ctx.save()
  ctx.setLineDash([16, 12])
  ctx.strokeStyle = 'rgba(255,255,255,0.28)'
  ctx.lineWidth = 4
  roundedRect(ctx, shell.x + 28, shell.y + 28, shell.width - 56, shell.height - 56, 50)
  ctx.stroke()
  ctx.restore()

  const pageGap = 82
  const pageMargin = 66
  const pageWidth = (shell.width - pageMargin * 2 - pageGap) / 2
  const pageHeight = shell.height - 122
  const pageY = shell.y + 61
  const leftX = shell.x + pageMargin
  const rightX = leftX + pageWidth + pageGap
  const indexes = binderSpreadIndexes(spreadIndex)
  const pageIndexes: Array<number | null> = [indexes.left, indexes.right]
  const visibleCards = pageIndexes.flatMap(pageIndex => pageIndex == null
    ? []
    : (binder.pages[pageIndex]?.slots || []).map((card, slotIndex) => ({ card, pageIndex, slotIndex })))
  const loadedCards = new Map<string, HTMLImageElement | null>()
  await Promise.all(visibleCards.map(async ({ card, pageIndex, slotIndex }) => {
    loadedCards.set(`${pageIndex}-${slotIndex}`, await getCardImage(card))
  }))

  for (let side = 0; side < 2; side += 1) {
    const pageX = side === 0 ? leftX : rightX
    const pageIndex = pageIndexes[side]
    roundedRect(ctx, pageX, pageY, pageWidth, pageHeight, 18)
    ctx.fillStyle = pageIndex == null ? 'rgba(0,0,0,0.15)' : 'rgba(226,232,240,0.24)'
    ctx.fill()
    ctx.strokeStyle = 'rgba(255,255,255,0.45)'
    ctx.lineWidth = 3
    ctx.stroke()

    ctx.save()
    ctx.setLineDash([10, 8])
    ctx.strokeStyle = pageIndex == null ? 'rgba(255,255,255,0.13)' : 'rgba(255,255,255,0.38)'
    ctx.lineWidth = 2
    roundedRect(ctx, pageX + 18, pageY + 18, pageWidth - 36, pageHeight - 36, 12)
    ctx.stroke()
    ctx.restore()

    if (pageIndex == null || !binder.pages[pageIndex]) {
      ctx.fillStyle = 'rgba(255,255,255,0.18)'
      ctx.font = '800 22px system-ui, sans-serif'
      ctx.textAlign = 'center'
      ctx.fillText('COPERTINA INTERNA', pageX + pageWidth / 2, pageY + pageHeight - 42)
      ctx.textAlign = 'start'
      continue
    }

    const contentPaddingX = 38
    const contentPaddingY = 45
    const gap = binder.columns_count >= 4 ? 11 : 16
    const availableWidth = pageWidth - contentPaddingX * 2
    const availableHeight = pageHeight - contentPaddingY * 2
    const maxSlotWidth = (availableWidth - gap * (binder.columns_count - 1)) / binder.columns_count
    const maxSlotHeight = (availableHeight - gap * (binder.rows_count - 1)) / binder.rows_count
    const cardRatio = 0.716
    const slotWidth = Math.min(maxSlotWidth, maxSlotHeight * cardRatio)
    const slotHeight = slotWidth / cardRatio
    const gridWidth = slotWidth * binder.columns_count + gap * (binder.columns_count - 1)
    const gridHeight = slotHeight * binder.rows_count + gap * (binder.rows_count - 1)
    const gridX = pageX + (pageWidth - gridWidth) / 2
    const gridY = pageY + (pageHeight - gridHeight) / 2

    for (let row = 0; row < binder.rows_count; row += 1) {
      for (let column = 0; column < binder.columns_count; column += 1) {
        const index = row * binder.columns_count + column
        const x = gridX + column * (slotWidth + gap)
        const y = gridY + row * (slotHeight + gap)
        roundedRect(ctx, x, y, slotWidth, slotHeight, 8)
        ctx.fillStyle = 'rgba(15,23,42,0.42)'
        ctx.fill()
        ctx.strokeStyle = 'rgba(255,255,255,0.36)'
        ctx.lineWidth = 2
        ctx.stroke()

        const cardImage = loadedCards.get(`${pageIndex}-${index}`)
        if (cardImage) drawContainedImage(ctx, cardImage, x + 5, y + 5, slotWidth - 10, slotHeight - 10)

        const shine = ctx.createLinearGradient(x, y, x + slotWidth, y + slotHeight)
        shine.addColorStop(0.05, 'rgba(255,255,255,0.24)')
        shine.addColorStop(0.32, 'rgba(255,255,255,0)')
        shine.addColorStop(1, 'rgba(255,255,255,0.07)')
        roundedRect(ctx, x, y, slotWidth, slotHeight, 8)
        ctx.fillStyle = shine
        ctx.fill()

        ctx.save()
        ctx.setLineDash([6, 5])
        ctx.strokeStyle = 'rgba(255,255,255,0.24)'
        ctx.lineWidth = 1.5
        roundedRect(ctx, x + 3, y + 3, slotWidth - 6, slotHeight - 6, 6)
        ctx.stroke()
        ctx.restore()
      }
    }

    ctx.fillStyle = 'rgba(255,255,255,0.65)'
    ctx.font = '800 18px system-ui, sans-serif'
    ctx.textAlign = 'center'
    ctx.fillText(`PAGINA ${pageIndex + 1}`, pageX + pageWidth / 2, pageY + pageHeight - 21)
    ctx.textAlign = 'start'
  }

  const spineX = shell.x + shell.width / 2
  const spineGradient = ctx.createLinearGradient(spineX - 34, 0, spineX + 34, 0)
  spineGradient.addColorStop(0, 'rgba(0,0,0,0.12)')
  spineGradient.addColorStop(0.5, 'rgba(0,0,0,0.55)')
  spineGradient.addColorStop(1, 'rgba(255,255,255,0.10)')
  ctx.fillStyle = spineGradient
  roundedRect(ctx, spineX - 31, shell.y + 34, 62, shell.height - 68, 25)
  ctx.fill()

  ctx.fillStyle = '#ffffff'
  ctx.font = '900 70px system-ui, sans-serif'
  ctx.fillText(`"${binder.title}"`, 92, 128)
  ctx.fillStyle = '#a5f3fc'
  ctx.font = '700 31px system-ui, sans-serif'
  ctx.fillText(`Raccoglitore di ${username || 'Giocatore OPV'}`, 95, 184)

  try {
    const [hat, textLogo] = await Promise.all([loadImage('/opv-hat-cutout.png'), loadImage('/opv-text-cutout.png')])
    drawContainedImage(ctx, hat, 1670, 44, 230, 110)
    drawContainedImage(ctx, textLogo, 1660, 150, 250, 82)
  } catch {
    ctx.fillStyle = '#fde68a'
    ctx.font = '900 58px system-ui, sans-serif'
    ctx.fillText('OPV', 1770, 150)
  }

  ctx.fillStyle = 'rgba(255,255,255,0.75)'
  ctx.font = '700 27px system-ui, sans-serif'
  ctx.fillText(window.location.host, 92, 1954)

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
