'use client'

import { useRouter } from 'next/navigation'
import { BookOpen } from 'lucide-react'
import BinderCover from './BinderCover'
import type { BinderRecord } from '@/lib/binders'

export default function BinderGallery({ binders, title = 'Raccoglitori', emptyText = 'Nessun raccoglitore condiviso.' }: { binders: BinderRecord[]; title?: string; emptyText?: string }) {
  const router = useRouter()
  return (
    <section className="rounded-[1.5rem] border border-amber-200/12 bg-slate-950/62 p-4 sm:p-5">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2"><BookOpen size={17} className="text-amber-100" /><h3 className="text-lg font-black text-white">{title}</h3></div>
        <span className="rounded-full bg-white/[0.07] px-2.5 py-1 text-[10px] font-black text-slate-300">{binders.length}</span>
      </div>
      {binders.length === 0 ? <p className="mt-4 rounded-2xl border border-dashed border-slate-700 p-4 text-sm text-slate-400">{emptyText}</p> : (
        <div className="mt-4 grid grid-cols-3 gap-x-3 gap-y-4 sm:grid-cols-5 lg:grid-cols-6">
          {binders.map(binder => (
            <button key={binder.id} type="button" onClick={() => router.push(`/binders/${binder.id}`)} className="min-w-0 text-left transition hover:-translate-y-1 active:scale-95">
              <BinderCover binder={binder} compact />
              <p className="mt-1.5 truncate text-[10px] font-black text-white sm:text-xs">{binder.title}</p>
            </button>
          ))}
        </div>
      )}
    </section>
  )
}
