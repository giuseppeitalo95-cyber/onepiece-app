'use client'

import type { BinderRecord } from '@/lib/binders'
import { binderClosedImage } from '@/lib/binderKits'

type Props = {
  binder: BinderRecord
  className?: string
  compact?: boolean
}

export default function BinderCover({ binder, className = '', compact = false }: Props) {
  const cards = binder.pages.flatMap(page => page.slots).filter(Boolean).length
  const coverImage = binderClosedImage(binder.cover_image_url)
  return (
    <div
      className={`relative isolate aspect-[3/4] overflow-hidden rounded-md border border-white/20 shadow-[0_18px_30px_rgba(0,0,0,0.32)] ${className}`}
      style={{ backgroundColor: binder.cover_color }}
    >
      {coverImage ? (
        <img src={coverImage} alt="" className="absolute inset-0 h-full w-full object-cover" />
      ) : null}
      <div className="absolute inset-y-0 left-0 w-[10%] border-r border-black/30 bg-black/20 shadow-[6px_0_12px_rgba(0,0,0,0.22)]" />
      <div className="absolute inset-[8%] border border-white/18 bg-black/12" />
      {!coverImage ? <div className="absolute left-1/2 top-[23%] flex h-[27%] w-[48%] -translate-x-1/2 flex-col items-center justify-center drop-shadow-[0_8px_14px_rgba(0,0,0,0.42)]">
        <img src="/opv-hat-cutout.png" alt="" className="relative z-10 h-[46%] w-auto object-contain" />
        <img src="/opv-text-cutout.png" alt="OPV" className="-mt-[1%] h-[35%] w-auto object-contain" />
      </div> : null}
      <div className="absolute inset-x-[14%] bottom-[7%] text-center">
        <p className={`line-clamp-2 font-black text-white drop-shadow-lg ${compact ? 'text-[9px]' : 'text-sm'}`}>{`"${binder.title}"`}</p>
        <p className={`mt-1 font-bold uppercase text-white/70 ${compact ? 'text-[6px]' : 'text-[9px]'}`}>{binder.columns_count}x{binder.rows_count} &middot; {cards} {cards === 1 ? 'carta' : 'carte'}</p>
      </div>
      <div className="absolute inset-x-[14%] bottom-[5%] h-px bg-white/25" />
    </div>
  )
}
