'use client'

import { useEffect, useState } from 'react'
import { ImagePlus, Pencil, Save, Trash2, X } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import type { BinderKit } from '@/lib/binderKits'

const imageFields = [
  { key: 'closed', label: 'Copertina chiusa', hint: 'Immagine verticale' },
  { key: 'open', label: 'Raccoglitore aperto', hint: 'Immagine orizzontale' },
] as const

const CLIENT_IMAGE_TARGETS = {
  closed: { width: 1536, height: 2048 },
  open: { width: 2400, height: 1600 },
} as const
const CLIENT_MAX_BYTES = 1_500_000

const canvasBlob = (canvas: HTMLCanvasElement, quality: number) => new Promise<Blob>((resolve, reject) => {
  canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('Impossibile ottimizzare questa immagine.')), 'image/webp', quality)
})

const optimizeForUpload = async (file: File, slot: keyof typeof CLIENT_IMAGE_TARGETS) => {
  if (!file.type.startsWith('image/')) throw new Error('Seleziona un file immagine.')
  const image = await createImageBitmap(file)
  const { width, height } = CLIENT_IMAGE_TARGETS[slot]
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const context = canvas.getContext('2d', { alpha: false })
  if (!context) {
    image.close()
    throw new Error('Il browser non riesce a elaborare questa immagine.')
  }

  const scale = Math.max(width / image.width, height / image.height)
  const sourceWidth = width / scale
  const sourceHeight = height / scale
  const sourceX = (image.width - sourceWidth) / 2
  const sourceY = (image.height - sourceHeight) / 2
  context.drawImage(image, sourceX, sourceY, sourceWidth, sourceHeight, 0, 0, width, height)
  image.close()

  let quality = 0.92
  let blob = await canvasBlob(canvas, quality)
  while (blob.size > CLIENT_MAX_BYTES && quality > 0.72) {
    quality -= 0.04
    blob = await canvasBlob(canvas, quality)
  }
  return new File([blob], `${slot}.webp`, { type: 'image/webp' })
}

export default function BinderKitManager() {
  const [kits, setKits] = useState<BinderKit[]>([])
  const [editing, setEditing] = useState<BinderKit | null>(null)
  const [title, setTitle] = useState('')
  const [files, setFiles] = useState<Record<string, File | null>>({})
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')

  const load = async () => {
    const response = await fetch('/api/binder-kits', { cache: 'no-store' })
    const data = await response.json().catch(() => null)
    setKits(Array.isArray(data?.kits) ? data.kits : [])
  }

  useEffect(() => {
    let active = true
    void fetch('/api/binder-kits', { cache: 'no-store' })
      .then(response => response.json())
      .then(data => { if (active) setKits(Array.isArray(data?.kits) ? data.kits : []) })
      .catch(() => { if (active) setKits([]) })
    return () => { active = false }
  }, [])

  const reset = () => {
    setEditing(null)
    setTitle('')
    setFiles({})
    setMessage('')
  }

  const edit = (kit: BinderKit) => {
    setEditing(kit)
    setTitle(kit.title)
    setFiles({})
    setMessage('Puoi sostituire soltanto le immagini che vuoi modificare.')
  }

  const save = async () => {
    if (!title.trim() || busy) return
    setBusy(true)
    setMessage('Carico e ottimizzo le immagini...')
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const form = new FormData()
      form.set('title', title.trim())
      if (editing) form.set('id', editing.id)
      for (const { key, label } of imageFields) {
        if (!files[key]) continue
        setMessage(`Ottimizzo ${label.toLocaleLowerCase('it-IT')}...`)
        form.set(key, await optimizeForUpload(files[key]!, key))
      }
      setMessage('Creo il kit e le due metà del raccoglitore...')
      const response = await fetch('/api/binder-kits', {
        method: 'POST',
        headers: session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {},
        body: form,
      })
      const data = await response.json().catch(() => null)
      if (!response.ok || !data?.ok) throw new Error(data?.error || 'Salvataggio non riuscito.')
      await load()
      reset()
      setMessage('Kit salvato e disponibile nei raccoglitori.')
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Salvataggio non riuscito.')
    }
    setBusy(false)
  }

  const remove = async (kit: BinderKit) => {
    if (busy || !window.confirm(`Eliminare il kit "${kit.title}" dalla selezione?`)) return
    setBusy(true)
    const { data: { session } } = await supabase.auth.getSession()
    const response = await fetch('/api/binder-kits', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json', ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}) },
      body: JSON.stringify({ id: kit.id }),
    })
    const data = await response.json().catch(() => null)
    setMessage(response.ok && data?.ok ? 'Kit eliminato dalla selezione.' : data?.error || 'Eliminazione non riuscita.')
    if (response.ok) { if (editing?.id === kit.id) reset(); await load() }
    setBusy(false)
  }

  return (
    <div className="mt-6 grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(340px,0.72fr)]">
      <section className="rounded-[1.75rem] border border-cyan-300/20 bg-slate-900/90 p-4 sm:p-5">
        <div className="flex items-center justify-between gap-3">
          <div><h2 className="text-xl font-black text-white">{editing ? 'Modifica kit' : 'Crea nuovo kit'}</h2><p className="mt-1 text-xs text-slate-400">Carica copertina e raccoglitore aperto: proporzioni, compressione e due metà vengono preparate automaticamente.</p></div>
          {editing ? <button type="button" onClick={reset} className="grid h-10 w-10 place-items-center rounded-xl border border-white/10 bg-white/[0.05]" aria-label="Annulla modifica"><X size={17} /></button> : null}
        </div>
        <input value={title} onChange={event => setTitle(event.target.value)} maxLength={80} placeholder="Titolo del kit" className="mt-4 w-full rounded-2xl border border-slate-700 bg-slate-950 px-4 py-3 text-base font-bold text-white outline-none focus:border-cyan-300" />
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          {imageFields.map(field => {
            const currentUrl = editing ? editing[`${field.key}_url` as keyof BinderKit] as string : null
            const preview = files[field.key] ? URL.createObjectURL(files[field.key]!) : currentUrl
            return (
              <label key={field.key} className="group cursor-pointer rounded-2xl border border-dashed border-slate-600 bg-slate-950/60 p-3 transition hover:border-cyan-300/50">
                <div className="flex items-center justify-between gap-2"><span className="text-sm font-black text-white">{field.label}</span><ImagePlus size={17} className="text-cyan-200" /></div>
                <p className="mt-1 text-[10px] font-bold uppercase tracking-[0.14em] text-slate-500">{field.hint} · qualsiasi dimensione</p>
                {preview ? <img src={preview} alt="" className={`mt-3 w-full rounded-xl border border-white/10 object-cover ${field.key === 'open' ? 'aspect-[1.48/1]' : 'aspect-[3/4]'}`} /> : <div className={`mt-3 grid place-items-center rounded-xl bg-white/[0.04] text-xs text-slate-500 ${field.key === 'open' ? 'aspect-[1.48/1]' : 'aspect-[3/4]'}`}>Seleziona immagine</div>}
                <input type="file" accept="image/*" className="hidden" onChange={event => setFiles(current => ({ ...current, [field.key]: event.target.files?.[0] || null }))} />
              </label>
            )
          })}
        </div>
        <button type="button" onClick={save} disabled={busy || !title.trim()} className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-cyan-300 px-4 py-3 font-black text-slate-950 transition active:scale-[0.98] disabled:opacity-50"><Save size={18} /> {busy ? 'Salvataggio...' : editing ? 'Salva modifiche' : 'Crea kit'}</button>
        {message ? <p className="mt-3 text-center text-sm font-bold text-cyan-100">{message}</p> : null}
      </section>

      <section className="rounded-[1.75rem] border border-white/10 bg-slate-900/90 p-4 sm:p-5">
        <h2 className="text-xl font-black text-white">Kit disponibili</h2>
        <p className="mt-1 text-xs text-slate-400">{kits.length} {kits.length === 1 ? 'kit pubblicato' : 'kit pubblicati'}</p>
        <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-2">
          {kits.map(kit => <div key={kit.id} className="overflow-hidden rounded-2xl border border-white/10 bg-slate-950/65 p-2"><img src={kit.closed_url} alt={kit.title} className="aspect-[3/4] w-full rounded-xl object-cover" /><p className="mt-2 truncate text-sm font-black text-white">{kit.title}</p><div className="mt-2 grid grid-cols-2 gap-2"><button type="button" onClick={() => edit(kit)} className="grid h-9 place-items-center rounded-xl bg-cyan-300/10 text-cyan-100" aria-label={`Modifica ${kit.title}`}><Pencil size={15} /></button><button type="button" onClick={() => remove(kit)} className="grid h-9 place-items-center rounded-xl bg-rose-300/10 text-rose-100" aria-label={`Elimina ${kit.title}`}><Trash2 size={15} /></button></div></div>)}
          {kits.length === 0 ? <p className="col-span-full rounded-2xl border border-dashed border-slate-700 p-4 text-sm text-slate-400">Nessun kit creato.</p> : null}
        </div>
      </section>
    </div>
  )
}
