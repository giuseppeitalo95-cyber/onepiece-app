'use client'

import { useState } from 'react'
import { CheckCircle2, Flag, LoaderCircle, X } from 'lucide-react'
import { supabase } from '@/lib/supabase'

const ISSUE_OPTIONS = ['Prezzo', 'Nome', 'Tipo', 'Colore', 'Rarita', 'Immagine', 'Costo/Power', 'Effetto'] as const

export default function CardErrorReport({
  cardId,
  cardName,
  pagePath,
}: {
  cardId: string
  cardName: string
  pagePath: string
}) {
  const [open, setOpen] = useState(false)
  const [issues, setIssues] = useState<string[]>([])
  const [description, setDescription] = useState('')
  const [sending, setSending] = useState(false)
  const [status, setStatus] = useState('')

  const toggleIssue = (issue: string) => {
    setIssues(current => current.includes(issue)
      ? current.filter(item => item !== issue)
      : [...current, issue])
  }

  const submit = async () => {
    if (issues.length === 0) {
      setStatus('Seleziona almeno un campo errato.')
      return
    }

    setSending(true)
    setStatus('')
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const response = await fetch('/api/bug-reports', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
        },
        body: JSON.stringify({
          title: `Errore carta ${cardId}`,
          pagePath,
          message: [
            `Carta: ${cardName}`,
            `Codice: ${cardId}`,
            `Campi segnalati: ${issues.join(', ')}`,
            description.trim() ? `Descrizione: ${description.trim()}` : 'Descrizione: non inserita',
          ].join('\n'),
        }),
      })
      const data = await response.json().catch(() => null)
      if (!response.ok || !data?.ok) throw new Error(data?.error || 'Segnalazione non inviata.')
      setStatus('Segnalazione inviata.')
      setIssues([])
      setDescription('')
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Segnalazione non inviata.')
    }
    setSending(false)
  }

  return (
    <>
      <button type="button" onClick={() => { setOpen(true); setStatus('') }} className="inline-flex items-center justify-center gap-2 rounded-2xl border border-amber-200/25 bg-amber-300/[0.08] px-3 py-2.5 text-xs font-black text-amber-100 transition hover:bg-amber-300/[0.14] active:scale-[0.98]">
        <Flag size={15} /> Segnala errore nella carta
      </button>

      {open ? (
        <div className="fixed inset-0 z-[180] flex items-end justify-center bg-black/80 p-2 backdrop-blur-md sm:items-center sm:p-4" onClick={event => { event.stopPropagation(); if (event.target === event.currentTarget) setOpen(false) }}>
          <div className="relative max-h-[92dvh] w-full max-w-lg overflow-y-auto rounded-[1.5rem] border border-slate-700 bg-slate-950 p-5 shadow-2xl" onClick={event => event.stopPropagation()}>
            <button type="button" onClick={() => setOpen(false)} className="absolute right-3 top-3 grid h-9 w-9 place-items-center rounded-xl border border-white/10 bg-white/[0.05] text-white" aria-label="Chiudi segnalazione"><X size={17} /></button>
            <h3 className="pr-12 text-lg font-black text-white">Segnala errore nella carta</h3>
            <p className="mt-1 text-sm text-cyan-100">{cardName} · {cardId}</p>

            <p className="mt-5 text-xs font-black uppercase text-slate-400">Cosa non e corretto?</p>
            <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
              {ISSUE_OPTIONS.map(issue => {
                const selected = issues.includes(issue)
                return <button key={issue} type="button" onClick={() => toggleIssue(issue)} className={`min-h-10 rounded-xl border px-2 text-xs font-black transition active:scale-95 ${selected ? 'border-amber-200 bg-amber-300 text-slate-950' : 'border-slate-700 bg-slate-900 text-slate-300'}`}>{issue}</button>
              })}
            </div>

            <textarea value={description} onChange={event => setDescription(event.target.value)} rows={4} maxLength={900} placeholder="Descrivi l'errore o indica il valore corretto" className="mt-4 w-full resize-y rounded-2xl border border-slate-700 bg-slate-900 px-3.5 py-3 text-sm text-white outline-none focus:border-amber-200" />

            {status ? <p className={`mt-3 text-sm ${status === 'Segnalazione inviata.' ? 'text-emerald-200' : 'text-amber-100'}`}>{status}</p> : null}
            <button type="button" onClick={() => void submit()} disabled={sending || status === 'Segnalazione inviata.'} className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-amber-300 px-4 py-3 text-sm font-black text-slate-950 transition active:scale-[0.98] disabled:opacity-60">
              {sending ? <LoaderCircle size={17} className="animate-spin" /> : status === 'Segnalazione inviata.' ? <CheckCircle2 size={17} /> : <Flag size={17} />}
              {sending ? 'Invio...' : status === 'Segnalazione inviata.' ? 'Inviata' : 'Invia segnalazione'}
            </button>
          </div>
        </div>
      ) : null}
    </>
  )
}
