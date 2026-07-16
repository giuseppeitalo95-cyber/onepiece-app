'use client'

import { useEffect, useMemo, useState } from 'react'

type CardImageProps = {
  src?: string | null
  cardId?: string | null
  alt?: string
  className?: string
  imgClassName?: string
  fallbackClassName?: string
  loading?: 'eager' | 'lazy'
  fetchPriority?: 'high' | 'low' | 'auto'
  preferProxy?: boolean
}

const imageProxy = (url: string, cardId?: string | null) => {
  if (url.startsWith('/')) return url
  const params = new URLSearchParams({ url })
  if (cardId) params.set('id', cardId)
  return `/api/cards/recognition-image?${params.toString()}`
}

const isOwnedImage = (url: string) => url.startsWith('/') || url.includes('.r2.dev/')

const failedImageSources = new Set<string>()

const getCardIds = (cardId?: string | null, src?: string | null) => {
  const values = [cardId || '', src || '']
  const ids = values
    .map(value => value.match(/((?:[A-Z]{1,4}\d{2}|P|DON)-\d{3}(?:_p\d+)?)/i)?.[1])
    .filter(Boolean)
    .map(value => String(value).toUpperCase())

  const unique = new Set<string>()
  ids.forEach(id => {
    const officialId = id.replace(/_P(\d+)$/i, '_p$1')
    unique.add(officialId)
    unique.add(id)
    unique.add(officialId.replace(/_p\d+$/i, ''))
  })

  return [...unique]
}

const buildSources = (src?: string | null, cardId?: string | null, preferProxy = true) => {
  const sources: string[] = []
  const push = (url?: string | null) => {
    if (url && !sources.includes(url)) sources.push(url)
  }

  if (src) push(isOwnedImage(src) ? src : imageProxy(src, cardId))
  if (src && !isOwnedImage(src) && !preferProxy) push(src)

  for (const id of getCardIds(cardId, src)) {
    push(imageProxy(`https://en.onepiece-cardgame.com/images/cardlist/card/${id}.png`, id))
    push(imageProxy(`https://en.onepiece-cardgame.com/images/cardlist/card/${id.toLowerCase()}.png`, id))
    push(imageProxy(`https://www.optcgapi.com/media/static/Card_Images/${id}.jpg`, id))
    push(imageProxy(`https://www.optcgapi.com/media/static/Card_Images/${id}.png`, id))
    push(imageProxy(`https://www.optcgapi.com/media/static/Card_Images/${id.toLowerCase()}.jpg`, id))
  }

  return sources
}

export default function CardImage({
  src,
  cardId,
  alt = 'Carta',
  className = '',
  imgClassName = 'h-full w-full object-contain',
  fallbackClassName = 'flex h-full w-full items-center justify-center text-[10px] text-slate-500',
  loading = 'lazy',
  fetchPriority = 'auto',
  preferProxy = true,
}: CardImageProps) {
  const sources = useMemo(() => buildSources(src, cardId, preferProxy).filter(source => !failedImageSources.has(source)), [src, cardId, preferProxy])
  const [index, setIndex] = useState(0)

  useEffect(() => {
    setIndex(0)
  }, [src, cardId])

  const current = sources[index]

  return (
    <div className={className}>
      {current ? (
        <img
          src={current}
          alt={alt}
          className={imgClassName}
          draggable={false}
          loading={loading}
          decoding="async"
          fetchPriority={fetchPriority}
          referrerPolicy="no-referrer"
          onError={() => {
            failedImageSources.add(current)
            setIndex(prev => prev + 1)
          }}
        />
      ) : (
        <div className={fallbackClassName}>NO IMAGE</div>
      )}
    </div>
  )
}
