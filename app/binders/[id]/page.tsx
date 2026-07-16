'use client'

import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { ArrowLeft, BookOpen, Share2, Square } from 'lucide-react'
import Topbar from '@/app/components/Topbar'
import Sidebar from '@/app/components/Sidebar'
import BinderBook from '@/app/components/BinderBook'
import BinderCardDetail from '@/app/components/BinderCardDetail'
import BinderSocial from '@/app/components/BinderSocial'
import { supabase } from '@/lib/supabase'
import { binderSpreadIndexes, normalizeBinder, type BinderCard, type BinderRecord } from '@/lib/binders'
import { shareBinder } from '@/lib/binderShare'

export default function SharedBinderPage() {
  const params = useParams<{ id: string }>()
  const router = useRouter()
  const [binder, setBinder] = useState<BinderRecord | null>(null)
  const [ownerName, setOwnerName] = useState('Giocatore OPV')
  const [ownerAvatar, setOwnerAvatar] = useState('')
  const [spreadIndex, setSpreadIndex] = useState(0)
  const [singlePageIndex, setSinglePageIndex] = useState(0)
  const [viewMode, setViewMode] = useState<'spread' | 'single'>('spread')
  const [selectedBinderCard, setSelectedBinderCard] = useState<BinderCard | null>(null)
  const [loading, setLoading] = useState(true)
  const [sharing, setSharing] = useState(false)
  const [status, setStatus] = useState('')

  useEffect(() => {
    const load = async () => {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session?.user) {
        router.replace('/')
        return
      }

      const { data, error } = await supabase.from('binders').select('*').eq('id', params.id).maybeSingle()
      if (error || !data) {
        setLoading(false)
        return
      }

      const normalized = normalizeBinder(data)
      setBinder(normalized)
      const { data: profile } = await supabase.from('profiles').select('username, avatar_url').eq('id', normalized.user_id).maybeSingle()
      setOwnerName(profile?.username || 'Giocatore OPV')
      setOwnerAvatar(profile?.avatar_url || '')
      setLoading(false)
    }
    void load()
  }, [params.id, router])

  const share = async () => {
    if (!binder || sharing) return
    setSharing(true)
    setStatus("Preparo l'immagine...")
    try {
      const message = await shareBinder(binder, spreadIndex, ownerName)
      setStatus(message)
      window.setTimeout(() => setStatus(current => current === message ? '' : current), 2500)
    } catch (error: unknown) {
      if (error instanceof DOMException && error.name === 'AbortError') setStatus('')
      else setStatus('Condivisione non riuscita.')
    }
    setSharing(false)
  }

  if (loading) return <div className="grid min-h-screen place-items-center onepiece-wave-bg text-sm font-black text-cyan-50">Apro il raccoglitore...</div>

  return (
    <div className="min-h-screen pb-32 pt-14 text-white onepiece-wave-bg onepiece-clouds sm:pb-36">
      <Topbar />
      <Sidebar />
      <main className="mx-auto max-w-7xl px-3 py-4 sm:px-6 sm:py-7">
        {!binder ? (
          <div className="mx-auto mt-12 max-w-lg rounded-3xl border border-white/10 bg-slate-950/60 p-6 text-center">
            <h1 className="text-xl font-black">Raccoglitore non disponibile</h1>
            <p className="mt-2 text-sm text-slate-400">Potrebbe essere privato o essere stato eliminato.</p>
            <button type="button" onClick={() => router.back()} className="mt-5 rounded-2xl bg-cyan-300 px-4 py-3 font-black text-slate-950">Torna indietro</button>
          </div>
        ) : (
          <>
            <div className="flex items-center gap-3">
              <button type="button" onClick={() => router.back()} className="grid h-10 w-10 place-items-center rounded-2xl border border-white/10 bg-slate-950/60 active:scale-90" aria-label="Torna indietro"><ArrowLeft size={18} /></button>
              <button type="button" onClick={() => router.push(`/friends?profile=${binder.user_id}`)} className="flex min-w-0 flex-1 items-center gap-2 text-left active:scale-[0.99]">
                <span className="grid h-10 w-10 shrink-0 place-items-center overflow-hidden rounded-full border border-cyan-200/25 bg-slate-800 text-xs font-black text-cyan-100">{ownerAvatar ? <img src={ownerAvatar} alt="" className="h-full w-full object-cover" /> : ownerName.charAt(0).toUpperCase()}</span>
                <span className="min-w-0"><span className="block truncate text-lg font-black">{binder.title}</span><span className="block truncate text-[10px] font-bold uppercase tracking-[0.14em] text-slate-400">di {ownerName}</span></span>
              </button>
            </div>
            <div className="mt-2 overflow-x-hidden">
              <BinderBook
                binder={binder}
                spreadIndex={spreadIndex}
                onSpreadChange={setSpreadIndex}
                viewMode={viewMode}
                singlePageIndex={singlePageIndex}
                onSinglePageChange={index => {
                  setSinglePageIndex(index)
                  setSpreadIndex(Math.ceil(index / 2))
                }}
                onOpenCard={card => setSelectedBinderCard(card)}
              />
            </div>
            <div className="mx-auto mt-3 flex w-fit rounded-2xl border border-white/10 bg-slate-950/55 p-1">
              <button type="button" onClick={() => setViewMode('spread')} className={`inline-flex items-center gap-2 rounded-xl px-3 py-2 text-xs font-black transition ${viewMode === 'spread' ? 'bg-cyan-300 text-slate-950' : 'text-slate-300'}`}><BookOpen size={16} /> Due pagine</button>
              <button type="button" onClick={() => {
                const indexes = binderSpreadIndexes(spreadIndex)
                setSinglePageIndex(indexes.right != null && binder.pages[indexes.right] ? indexes.right : indexes.left || 0)
                setViewMode('single')
              }} className={`inline-flex items-center gap-2 rounded-xl px-3 py-2 text-xs font-black transition ${viewMode === 'single' ? 'bg-cyan-300 text-slate-950' : 'text-slate-300'}`}><Square size={15} /> Una pagina</button>
            </div>
            <button type="button" onClick={share} disabled={sharing} className="mx-auto mt-3 flex items-center justify-center gap-2 rounded-2xl bg-cyan-300 px-5 py-3 text-sm font-black text-slate-950 transition active:scale-95 disabled:opacity-45"><Share2 size={17} /> Condividi</button>
            {status ? <p className="mx-auto mt-3 max-w-xl rounded-2xl border border-white/10 bg-slate-950/55 px-3 py-2 text-center text-xs font-bold text-slate-200">{status}</p> : null}
            <div className="mt-4"><BinderSocial binder={binder} /></div>
          </>
        )}
      </main>
      <BinderCardDetail card={selectedBinderCard} onClose={() => setSelectedBinderCard(null)} />
    </div>
  )
}
