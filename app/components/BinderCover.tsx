'use client'

import { BookOpen } from 'lucide-react'
import type { BinderRecord } from '@/lib/binders'

type Props = {
  binder: BinderRecord
  className?: string
  compact?: boolean
}

export default function BinderCover({ binder, className = '', compact = false }: Props) {
  const cards = binder.pages.flatMap(page => page.slots).filter(Boolean).length
  return (
    <div
      className={`relative isolate aspect-[3/4] overflow-hidden rounded-md border border-white/20 shadow-[0_18px_30px_rgba(0,0,0,0.32)] ${className}`}
      style={{ backgroundColor: binder.cover_color }}
    >
      {binder.cover_image_url ? (
        <img src={binder.cover_image_url} alt="" className="absolute inset-0 h-full w-full object-cover opacity-70" />
      ) : null}
      <div className="absolute inset-y-0 left-0 w-[10%] border-r border-black/30 bg-black/20 shadow-[6px_0_12px_rgba(0,0,0,0.22)]" />
      <div className="absolute inset-[8%] border border-white/18 bg-black/12" />
      <div className="relative flex h-full flex-col items-center justify-center px-3 text-center">
        <BookOpen size={compact ? 18 : 25} className="text-white/85" />
        <p className={`mt-2 line-clamp-3 font-black text-white drop-shadow-lg ${compact ? 'text-[10px]' : 'text-sm'}`}>{binder.title}</p>
        <p className="mt-2 text-[8px] font-bold uppercase tracking-[0.16em] text-white/65">{binder.columns_count}x{binder.rows_count} / {cards} carte</p>
      </div>
      <div className="absolute inset-x-[14%] bottom-[6%] h-px bg-white/25" />
    </div>
  )
}
