'use client'

import { useEffect, useRef, useState } from 'react'
import { ChevronLeft, ChevronRight, Plus, Trash2 } from 'lucide-react'
import CardImage from './CardImage'
import { binderMaxSpread, binderSpreadIndexes, type BinderCard, type BinderPage, type BinderRecord } from '@/lib/binders'

type Props = {
  binder: BinderRecord
  spreadIndex: number
  onSpreadChange: (index: number) => void
  editable?: boolean
  onSelectSlot?: (pageIndex: number, slotIndex: number) => void
  onRemoveCard?: (pageIndex: number, slotIndex: number) => void
  onOpenCard?: (card: BinderCard) => void
  viewMode?: 'spread' | 'single'
  singlePageIndex?: number
  onSinglePageChange?: (index: number) => void
}

const PAGE_TURN_MS = 520

const EmptySlot = ({ editable, hasCardBehind = false }: { editable: boolean; hasCardBehind?: boolean }) => (
  <div className="grid h-full w-full place-items-center rounded-[5px] border border-dashed border-slate-400/28 bg-white/[0.035] text-slate-500">
    {hasCardBehind ? <img src="/rewards/opv-card-back.jpeg" alt="" className="absolute inset-[3%] h-[94%] w-[94%] rounded-[4px] object-cover opacity-20 grayscale-[25%]" /> : null}
    {editable ? <Plus className="relative z-10 h-[35%] w-[35%]" /> : null}
  </div>
)

function BinderPagePanel({ binder, page, pageIndex, editable, onSelectSlot, onRemoveCard, onOpenCard }: {
  binder: BinderRecord
  page: BinderPage
  pageIndex: number
  editable: boolean
  onSelectSlot?: (pageIndex: number, slotIndex: number) => void
  onRemoveCard?: (pageIndex: number, slotIndex: number) => void
  onOpenCard?: (card: BinderCard) => void
}) {
  const oppositePageIndex = pageIndex % 2 === 0 ? pageIndex + 1 : pageIndex - 1
  const oppositePage = binder.pages[oppositePageIndex]

  return (
    <div className="binder-page relative h-full min-w-0 overflow-hidden rounded-[6px] border border-white/30 bg-slate-300/14 p-[3.5%] shadow-inner shadow-white/20">
      <div className="grid h-full w-full" style={{
        gridTemplateColumns: `repeat(${binder.columns_count}, minmax(0, 1fr))`,
        gridTemplateRows: `repeat(${binder.rows_count}, minmax(0, 1fr))`,
        gap: binder.columns_count >= 4 ? '2.4%' : '3.2%',
      }}>
        {page.slots.map((card, slotIndex) => {
          const row = Math.floor(slotIndex / binder.columns_count)
          const column = slotIndex % binder.columns_count
          const mirroredSlotIndex = row * binder.columns_count + (binder.columns_count - 1 - column)
          const hasCardBehind = !card && Boolean(oppositePage?.slots[mirroredSlotIndex])
          return (
            <div key={`${pageIndex}-${slotIndex}`} className="binder-pocket group relative min-h-0 min-w-0 overflow-hidden rounded-[5px] border border-white/28 bg-slate-950/24 p-[3%] shadow-[inset_0_0_8px_rgba(255,255,255,0.12)]">
              <button
                type="button"
                onClick={() => {
                  if (editable) onSelectSlot?.(pageIndex, slotIndex)
                  else if (card) onOpenCard?.(card)
                }}
                disabled={!editable && !card}
                className="block h-full w-full disabled:cursor-default"
                aria-label={card ? editable ? `Sostituisci ${card.name}` : `Apri ${card.name}` : 'Aggiungi carta'}
              >
                {card ? <CardImage src={card.image_url} cardId={card.card_id} alt={card.name} className="h-full w-full overflow-hidden rounded-[4px] bg-slate-900" imgClassName="h-full w-full object-contain" loading="eager" fetchPriority="high" preferProxy /> : <EmptySlot editable={editable} hasCardBehind={hasCardBehind} />}
              </button>
              {editable && card ? (
                <button type="button" onClick={event => { event.stopPropagation(); onRemoveCard?.(pageIndex, slotIndex) }} className="absolute right-[4%] top-[4%] grid h-6 w-6 place-items-center rounded-full bg-rose-500/92 text-white shadow-lg opacity-100 sm:opacity-0 sm:transition sm:group-hover:opacity-100" aria-label={`Rimuovi ${card.name}`}>
                  <Trash2 size={12} />
                </button>
              ) : null}
              <div className="pointer-events-none absolute inset-x-[5%] top-[3%] h-[7%] rounded-full bg-white/12 blur-[1px]" />
            </div>
          )
        })}
      </div>
      <span className="absolute bottom-1 right-2 text-[7px] font-black text-slate-400/70">{pageIndex + 1}</span>
      <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(115deg,transparent_20%,rgba(255,255,255,0.10)_43%,transparent_62%)]" />
    </div>
  )
}

function BinderInsideCover({ binder }: { binder: BinderRecord }) {
  return (
    <div className="relative h-full overflow-hidden rounded-[6px] border border-black/20 shadow-inner shadow-black/30" style={{ backgroundColor: binder.cover_color }}>
      {binder.cover_image_url ? <img src={binder.cover_image_url} alt="" className="absolute inset-0 h-full w-full object-cover opacity-20" /> : null}
      <div className="absolute inset-[5%] rounded-[5px] border border-white/10" />
      <div className="absolute inset-0 bg-[linear-gradient(115deg,rgba(255,255,255,0.08),transparent_38%,rgba(0,0,0,0.12))]" />
    </div>
  )
}

function BinderPageBack({ binder, pageIndex }: { binder: BinderRecord; pageIndex: number }) {
  const page = binder.pages[pageIndex]
  return <BinderPagePanel binder={binder} page={page} pageIndex={pageIndex} editable={false} />
}

export default function BinderBook({ binder, spreadIndex, onSpreadChange, editable = false, onSelectSlot, onRemoveCard, onOpenCard, viewMode = 'spread', singlePageIndex = 0, onSinglePageChange }: Props) {
  const [turning, setTurning] = useState<'next' | 'prev' | null>(null)
  const pointerStart = useRef<number | null>(null)
  const maxSpread = binderMaxSpread(binder.pages.length)
  const current = binderSpreadIndexes(spreadIndex)
  const target = binderSpreadIndexes(turning === 'next' ? spreadIndex + 1 : turning === 'prev' ? spreadIndex - 1 : spreadIndex)
  const baseLeft = turning === 'prev' ? target.left : current.left
  const baseRight = turning === 'next' ? target.right : current.right
  const safeSinglePage = Math.min(Math.max(0, singlePageIndex), Math.max(0, binder.pages.length - 1))

  useEffect(() => {
    if (spreadIndex > maxSpread) onSpreadChange(maxSpread)
  }, [maxSpread, onSpreadChange, spreadIndex])

  useEffect(() => {
    if (singlePageIndex > safeSinglePage) onSinglePageChange?.(safeSinglePage)
  }, [onSinglePageChange, safeSinglePage, singlePageIndex])

  useEffect(() => {
    const pageIndexes = new Set<number>()
    if (viewMode === 'single') {
      for (const index of [safeSinglePage - 1, safeSinglePage, safeSinglePage + 1]) {
        if (index >= 0 && index < binder.pages.length) pageIndexes.add(index)
      }
    } else {
      for (const index of [spreadIndex - 1, spreadIndex, spreadIndex + 1]) {
        const spread = binderSpreadIndexes(index)
        if (spread.left != null) pageIndexes.add(spread.left)
        if (spread.right != null) pageIndexes.add(spread.right)
      }
    }

    const urls = new Set<string>(['/rewards/opv-card-back.jpeg'])
    pageIndexes.forEach(index => binder.pages[index]?.slots.forEach(card => {
      if (!card?.image_url) return
      urls.add(card.image_url.startsWith('/') ? card.image_url : `/api/cards/recognition-image?url=${encodeURIComponent(card.image_url)}`)
    }))
    urls.forEach(url => {
      const image = new Image()
      image.decoding = 'async'
      image.src = url
    })
  }, [binder.pages, safeSinglePage, spreadIndex, viewMode])

  const turn = (direction: 'next' | 'prev') => {
    if (turning) return
    const nextSpread = direction === 'next' ? spreadIndex + 1 : spreadIndex - 1
    if (nextSpread < 0 || nextSpread > maxSpread) return
    setTurning(direction)
    window.setTimeout(() => {
      onSpreadChange(nextSpread)
      setTurning(null)
    }, PAGE_TURN_MS)
  }

  const surface = (pageIndex: number | null, canEdit: boolean) => {
    const page = pageIndex == null ? null : binder.pages[pageIndex]
    return page ? <BinderPagePanel binder={binder} page={page} pageIndex={pageIndex as number} editable={canEdit} onSelectSlot={onSelectSlot} onRemoveCard={onRemoveCard} onOpenCard={onOpenCard} /> : <BinderInsideCover binder={binder} />
  }

  const pageLabelIndexes = [current.left, current.right].filter((index): index is number => index != null && Boolean(binder.pages[index]))
  const pageLabel = pageLabelIndexes.length === 1
    ? `Pagina ${pageLabelIndexes[0] + 1} di ${binder.pages.length}`
    : `Pagine ${pageLabelIndexes.map(index => index + 1).join('-')} di ${binder.pages.length}`

  if (viewMode === 'single') {
    const changeSinglePage = (direction: -1 | 1) => {
      const nextPage = safeSinglePage + direction
      if (nextPage < 0 || nextPage >= binder.pages.length) return
      onSinglePageChange?.(nextPage)
    }

    return (
      <div className="mx-auto w-full max-w-4xl">
        <div className="binder-stage relative touch-pan-y px-1 py-4 sm:px-14 sm:py-7" onPointerDown={event => { pointerStart.current = event.clientX }} onPointerUp={event => {
          if (pointerStart.current == null) return
          const distance = event.clientX - pointerStart.current
          pointerStart.current = null
          if (Math.abs(distance) >= 45) changeSinglePage(distance < 0 ? 1 : -1)
        }} onPointerCancel={() => { pointerStart.current = null }}>
          <div className="binder-open-shell relative mx-auto aspect-[0.72/1] w-[min(94vw,42rem)] overflow-visible rounded-[5%] border border-black/35 p-[5%] shadow-[0_34px_70px_rgba(0,0,0,0.48)]" style={{ backgroundColor: binder.cover_color }}>
            {binder.cover_image_url ? <img src={binder.cover_image_url} alt="" className="absolute inset-0 h-full w-full rounded-[5%] object-cover opacity-28" /> : null}
            <div className="pointer-events-none absolute inset-[2%] rounded-[4%] border border-white/12 shadow-inner shadow-black/45" />
            <div className="relative z-10 h-full">{surface(safeSinglePage, editable)}</div>
          </div>
          <button type="button" onClick={() => changeSinglePage(-1)} disabled={safeSinglePage <= 0} className="absolute left-1 top-1/2 z-40 grid h-11 w-11 -translate-y-1/2 place-items-center rounded-full border border-white/15 bg-slate-950/78 text-white shadow-xl backdrop-blur disabled:opacity-25 sm:left-3" aria-label="Pagina precedente"><ChevronLeft /></button>
          <button type="button" onClick={() => changeSinglePage(1)} disabled={safeSinglePage >= binder.pages.length - 1} className="absolute right-1 top-1/2 z-40 grid h-11 w-11 -translate-y-1/2 place-items-center rounded-full border border-white/15 bg-slate-950/78 text-white shadow-xl backdrop-blur disabled:opacity-25 sm:right-3" aria-label="Pagina successiva"><ChevronRight /></button>
        </div>
        <p className="text-center text-xs font-bold text-slate-400">Pagina {safeSinglePage + 1} di {binder.pages.length}</p>
      </div>
    )
  }

  return (
    <div className="mx-auto w-full max-w-6xl">
      <div className="binder-stage relative touch-pan-y px-2 py-4 sm:px-8 sm:py-7" onPointerDown={event => { pointerStart.current = event.clientX }} onPointerUp={event => {
        if (pointerStart.current == null) return
        const distance = event.clientX - pointerStart.current
        pointerStart.current = null
        if (Math.abs(distance) >= 45) turn(distance < 0 ? 'next' : 'prev')
      }} onPointerCancel={() => { pointerStart.current = null }}>
        <div className="binder-open-shell relative mx-auto aspect-[1.48/1] w-full overflow-visible rounded-[4%] border border-black/35 p-[4.2%] shadow-[0_34px_70px_rgba(0,0,0,0.48)]" style={{ backgroundColor: binder.cover_color }}>
          {binder.cover_image_url ? <img src={binder.cover_image_url} alt="" className="absolute inset-0 h-full w-full rounded-[4%] object-cover opacity-30" /> : null}
          <div className="pointer-events-none absolute inset-[2%] rounded-[3%] border border-white/12 shadow-inner shadow-black/45" />
          <div className="absolute inset-y-[4%] left-1/2 z-20 w-[3.2%] -translate-x-1/2 rounded-full border-x border-black/28 bg-black/26 shadow-[0_0_20px_rgba(0,0,0,0.48)]" />
          <div className="relative z-10 grid h-full grid-cols-2 gap-[3.3%] [perspective:1600px]">
            {surface(baseLeft, editable && !turning)}
            {surface(baseRight, editable && !turning)}
            {turning === 'next' && current.right != null ? (
              <div className="binder-turn-page binder-turn-next absolute inset-y-0 right-0 z-30 w-[48.4%] origin-left">
                <div className="binder-page-face binder-page-front absolute inset-0">{surface(current.right, false)}</div>
                <div className="binder-page-face binder-page-back absolute inset-0">{target.left != null && binder.pages[target.left] ? <BinderPageBack binder={binder} pageIndex={target.left} /> : <BinderInsideCover binder={binder} />}</div>
              </div>
            ) : null}
            {turning === 'prev' && current.left != null ? (
              <div className="binder-turn-page binder-turn-prev absolute inset-y-0 left-0 z-30 w-[48.4%] origin-right">
                <div className="binder-page-face binder-page-front absolute inset-0">{surface(current.left, false)}</div>
                <div className="binder-page-face binder-page-back absolute inset-0">{target.right != null && binder.pages[target.right] ? <BinderPageBack binder={binder} pageIndex={target.right} /> : <BinderInsideCover binder={binder} />}</div>
              </div>
            ) : null}
          </div>
        </div>
        <button type="button" onClick={() => turn('prev')} disabled={spreadIndex <= 0 || Boolean(turning)} className="absolute left-0 top-1/2 z-40 grid h-10 w-10 -translate-y-1/2 place-items-center rounded-full border border-white/15 bg-slate-950/78 text-white shadow-xl backdrop-blur disabled:opacity-25 sm:left-2 sm:h-12 sm:w-12" aria-label="Pagine precedenti"><ChevronLeft /></button>
        <button type="button" onClick={() => turn('next')} disabled={spreadIndex >= maxSpread || Boolean(turning)} className="absolute right-0 top-1/2 z-40 grid h-10 w-10 -translate-y-1/2 place-items-center rounded-full border border-white/15 bg-slate-950/78 text-white shadow-xl backdrop-blur disabled:opacity-25 sm:right-2 sm:h-12 sm:w-12" aria-label="Pagine successive"><ChevronRight /></button>
      </div>
      <p className="text-center text-xs font-bold text-slate-400">{pageLabel}</p>
    </div>
  )
}
