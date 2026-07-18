'use client'

import { useState } from 'react'
import { Link2, Pencil } from 'lucide-react'
import CardmarketCardImporter from './CardmarketCardImporter'
import CatalogCardEditor from './CatalogCardEditor'

export default function CatalogCardManager() {
  const [mode, setMode] = useState<'add' | 'edit'>('add')

  return (
    <div>
      <div className="mb-5 grid grid-cols-2 gap-2 rounded-2xl border border-slate-700 bg-slate-950/70 p-1.5">
        <button type="button" onClick={() => setMode('add')} className={`inline-flex min-h-11 items-center justify-center gap-2 rounded-xl px-3 text-sm font-black transition active:scale-[0.98] ${mode === 'add' ? 'bg-cyan-300 text-slate-950' : 'text-slate-400 hover:text-white'}`}>
          <Link2 size={17} /> Aggiungi carta
        </button>
        <button type="button" onClick={() => setMode('edit')} className={`inline-flex min-h-11 items-center justify-center gap-2 rounded-xl px-3 text-sm font-black transition active:scale-[0.98] ${mode === 'edit' ? 'bg-violet-300 text-slate-950' : 'text-slate-400 hover:text-white'}`}>
          <Pencil size={17} /> Modifica carta
        </button>
      </div>
      {mode === 'add' ? <CardmarketCardImporter /> : <CatalogCardEditor />}
    </div>
  )
}
