'use client'

import { useEffect, useRef, useState } from 'react'
import { ChevronLeft, ChevronRight, Plus, Trash2 } from 'lucide-react'
import CardImage from './CardImage'
import type { BinderCard, BinderPage, BinderRecord } from '@/lib/binders'

type Props = {
  binder: BinderRecord
  spreadIndex: number
  onSpreadChange: (index: number) => void
  editable?: boolean
  onSelectSlot?: (pageIndex: number, slotIndex: number) => void
  onRemoveCard?: (pageIndex: number, slotIndex: number) => void
}

const EmptySlot = ({ editable }: { editable: boolean }) => (
  <div className="grid h-full w-full place-items-center rounded-[5px] border border-dashed border-slate-400/28 bg-white/[0.035] text-slate-500">
    {editable ? <Plus className="h-[35%] w-[35%]" /> : null}
  </div>
)

function BinderPagePanel({
  binder,
  page,
  pageIndex,
  editable,
  onSelectSlot,
  onRemoveCard,
}: {
  binder: BinderRecord
  page: BinderPage
  pageIndex: number
  editable: boolean
  onSelectSlot?: (pageIndex: number, slotIndex: number) => void
  onRemoveCard?: (pageIndex: number, slotIndex: number) => void
}) {
  return (
    <div className="binder-page relative h-full min-w-0 overflow-hidden rounded-[6px] border border-white/30 bg-slate-300/14 p-[3.5%] shadow-inner shadow-white/20">
      <div
        className="grid h-full w-full"
        style={{
          gridTemplateColumns: `repeat(${binder.columns_count}, minmax(0, 1fr))`,
          gridTemplateRows: `repeat(${binder.rows_count}, minmax(0, 1fr))`,
          gap: binder.columns_count >= 4 ? '2.4%' : '3.2%',
        }}
      >
        {page.slots.map((card: BinderCard | null, slotIndex) => (
          <div key={`${pageIndex}-${slotIndex}`} className="binder-pocket group relative min-h-0 min-w-0 overflow-hidden rounded-[5px] border border-white/28 bg-slate-950/24 p-[3%] shadow-[inset_0_0_8px_rgba(255,255,255,0.12)]">
            <button
              type="button"
              onClick={() => editable && onSelectSlot?.(pageIndex, slotIndex)}
              className="block h-full w-full"
              aria-label={card ? `Sostituisci ${card.name}` : 'Aggiungi carta'}
            >
              {card ? (
                <CardImage
                  src={card.image_url}
                  cardId={card.card_id}
                  alt={card.name}
                  className="h-full w-full overflow-hidden rounded-[4px] bg-slate-900"
                  imgClassName="h-full w-full object-contain"
                  loading="eager"
                />
              ) : <EmptySlot editable={editable} />}
            </button>
            {editable && card ? (
              <button
                type="button"
                onClick={(event) => {
                  event.stopPropagation()
                  onRemoveCard?.(pageIndex, slotIndex)
                }}
                className="absolute right-[4%] top-[4%] grid h-6 w-6 place-items-center rounded-full bg-rose-500/92 text-white shadow-lg opacity-100 sm:opacity-0 sm:transition sm:group-hover:opacity-100"
                aria-label={`Rimuovi ${card.name}`}
              >
                <Trash2 size={12} />
              </button>
            ) : null}
            <div className="pointer-events-none absolute inset-x-[5%] top-[3%] h-[7%] rounded-full bg-white/12 blur-[1px]" />
          </div>
        ))}
      </div>
      <span className="absolute bottom-1 right-2 text-[7px] font-black text-slate-400/70">{pageIndex + 1}</span>
      <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(115deg,transparent_20%,rgba(255,255,255,0.10)_43%,transparent_62%)]" />
    </div>
  )
}

export default function BinderBook({ binder, spreadIndex, onSpreadChange, editable = false, onSelectSlot, onRemoveCard }: Props) {
  const [turning, setTurning] = useState<'next' | 'prev' | null>(null)
  const pointerStart = useRef<number | null>(null)
  const maxSpread = Math.max(0, Math.ceil(binder.pages.length / 2) - 1)
  const leftIndex = Math.min(spreadIndex * 2, Math.max(0, binder.pages.length - 2))
  const rightIndex = leftIndex + 1
  const targetLeftIndex = turning === 'next' ? leftIndex + 2 : turning === 'prev' ? leftIndex - 2 : leftIndex
  const targetRightIndex = targetLeftIndex + 1

  useEffect(() => {
    if (spreadIndex > maxSpread) onSpreadChange(maxSpread)
  }, [maxSpread, onSpreadChange, spreadIndex])

  const turn = (direction: 'next' | 'prev') => {
    if (turning) return
    const target = direction === 'next' ? spreadIndex + 1 : spreadIndex - 1
    if (target < 0 || target > maxSpread) return
    setTurning(direction)
    window.setTimeout(() => {
      onSpreadChange(target)
      setTurning(null)
    }, 430)
  }

  return (
    <div className="mx-auto w-full max-w-6xl">
      <div
        className="binder-stage relative touch-pan-y px-2 py-4 sm:px-8 sm:py-7"
        onPointerDown={event => { pointerStart.current = event.clientX }}
        onPointerUp={event => {
          if (pointerStart.current == null) return
          const distance = event.clientX - pointerStart.current
          pointerStart.current = null
          if (Math.abs(distance) < 45) return
          turn(distance < 0 ? 'next' : 'prev')
        }}
        onPointerCancel={() => { pointerStart.current = null }}
      >
        <div
          className="binder-open-shell relative mx-auto aspect-[1.48/1] w-full overflow-visible rounded-[4%] border border-black/35 p-[4.2%] shadow-[0_34px_70px_rgba(0,0,0,0.48)]"
          style={{ backgroundColor: binder.cover_color }}
        >
          {binder.cover_image_url ? <img src={binder.cover_image_url} alt="" className="absolute inset-0 h-full w-full rounded-[4%] object-cover opacity-30" /> : null}
          <div className="pointer-events-none absolute inset-[2%] rounded-[3%] border border-white/12 shadow-inner shadow-black/45" />
          <div className="absolute inset-y-[4%] left-1/2 z-20 w-[3.2%] -translate-x-1/2 rounded-full border-x border-black/28 bg-black/26 shadow-[0_0_20px_rgba(0,0,0,0.48)]" />
          <div className="relative z-10 grid h-full grid-cols-2 gap-[3.3%] [perspective:1600px]">
            <BinderPagePanel binder={binder} page={binder.pages[turning === 'prev' ? targetLeftIndex : leftIndex]} pageIndex={turning === 'prev' ? targetLeftIndex : leftIndex} editable={editable && !turning} onSelectSlot={onSelectSlot} onRemoveCard={onRemoveCard} />
            <BinderPagePanel binder={binder} page={binder.pages[turning === 'next' ? targetRightIndex : rightIndex]} pageIndex={turning === 'next' ? targetRightIndex : rightIndex} editable={editable && !turning} onSelectSlot={onSelectSlot} onRemoveCard={onRemoveCard} />
            {turning === 'next' ? (
              <div className="binder-turn-page binder-turn-next absolute inset-y-0 right-0 z-30 w-[48.4%] origin-left">
                <div className="binder-page-face binder-page-front absolute inset-0"><BinderPagePanel binder={binder} page={binder.pages[rightIndex]} pageIndex={rightIndex} editable={false} /></div>
                <div className="binder-page-face binder-page-back absolute inset-0"><BinderPagePanel binder={binder} page={binder.pages[targetLeftIndex]} pageIndex={targetLeftIndex} editable={false} /></div>
              </div>
            ) : null}
            {turning === 'prev' ? (
              <div className="binder-turn-page binder-turn-prev absolute inset-y-0 left-0 z-30 w-[48.4%] origin-right">
                <div className="binder-page-face binder-page-front absolute inset-0"><BinderPagePanel binder={binder} page={binder.pages[leftIndex]} pageIndex={leftIndex} editable={false} /></div>
                <div className="binder-page-face binder-page-back absolute inset-0"><BinderPagePanel binder={binder} page={binder.pages[targetRightIndex]} pageIndex={targetRightIndex} editable={false} /></div>
              </div>
            ) : null}
          </div>
        </div>
        <button type="button" onClick={() => turn('prev')} disabled={spreadIndex <= 0 || Boolean(turning)} className="absolute left-0 top-1/2 z-40 grid h-10 w-10 -translate-y-1/2 place-items-center rounded-full border border-white/15 bg-slate-950/78 text-white shadow-xl backdrop-blur disabled:opacity-25 sm:left-2 sm:h-12 sm:w-12" aria-label="Pagine precedenti">
          <ChevronLeft />
        </button>
        <button type="button" onClick={() => turn('next')} disabled={spreadIndex >= maxSpread || Boolean(turning)} className="absolute right-0 top-1/2 z-40 grid h-10 w-10 -translate-y-1/2 place-items-center rounded-full border border-white/15 bg-slate-950/78 text-white shadow-xl backdrop-blur disabled:opacity-25 sm:right-2 sm:h-12 sm:w-12" aria-label="Pagine successive">
          <ChevronRight />
        </button>
      </div>
      <p className="text-center text-xs font-bold text-slate-400">Pagine {leftIndex + 1}-{rightIndex + 1} di {binder.pages.length}</p>
    </div>
  )
}
