'use client'

import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { ArrowLeft, Share2 } from 'lucide-react'
import Topbar from '@/app/components/Topbar'
import Sidebar from '@/app/components/Sidebar'
import BinderBook from '@/app/components/BinderBook'
import BinderSocial from '@/app/components/BinderSocial'
import { supabase } from '@/lib/supabase'
import { normalizeBinder, type BinderRecord } from '@/lib/binders'
import { shareBinder } from '@/lib/binderShare'

export default function SharedBinderPage() {
  const params = useParams<{ id: string }>()
  const router = useRouter()
  const [binder, setBinder] = useState<BinderRecord | null>(null)
  const [ownerName, setOwnerName] = useState('Giocatore OPV')
  const [ownerAvatar, setOwnerAvatar] = useState('')
  const [spreadIndex, setSpreadIndex] = useState(0)
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
    setStatus('Preparo le pagine...')
    try {
      setStatus(await shareBinder(binder, spreadIndex, ownerName))
    } catch (error: unknown) {
      if (!(error instanceof DOMException && error.name === 'AbortError')) setStatus('Condivisione non riuscita.')
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
              <button type="button" onClick={share} disabled={sharing} className="grid h-10 w-10 place-items-center rounded-2xl bg-cyan-300 text-slate-950 active:scale-90 disabled:opacity-45" aria-label="Condividi"><Share2 size={17} /></button>
            </div>
            {status ? <p className="mt-3 rounded-2xl border border-white/10 bg-slate-950/55 px-3 py-2 text-center text-xs font-bold text-slate-200">{status}</p> : null}
            <div className="mt-2 overflow-x-hidden"><BinderBook binder={binder} spreadIndex={spreadIndex} onSpreadChange={setSpreadIndex} /></div>
            <div className="mt-4"><BinderSocial binder={binder} /></div>
          </>
        )}
      </main>
    </div>
  )
}
