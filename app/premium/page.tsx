'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Crown, Infinity, ScanLine, Sparkles, Layers3, MessageSquareHeart } from 'lucide-react'
import Sidebar from '@/app/components/Sidebar'
import Topbar from '@/app/components/Topbar'
import { supabase } from '@/lib/supabase'
import { FREE_DAILY_SCAN_LIMIT, FREE_DECK_LIMIT, PREMIUM_BOARD_POST_DAYS, FREE_BOARD_POST_DAYS, getPremiumTier, premiumLabel, type PremiumProfile } from '@/lib/premium'

const perks = [
  {
    Icon: Layers3,
    title: 'Deck illimitati',
    free: `${FREE_DECK_LIMIT} deck salvati`,
    premium: 'Deck salvati illimitati'
  },
  {
    Icon: ScanLine,
    title: 'Scanner più libero',
    free: `${FREE_DAILY_SCAN_LIMIT} scan al giorno`,
    premium: 'Scan giornaliere illimitate'
  },
  {
    Icon: MessageSquareHeart,
    title: 'Bacheca in evidenza',
    free: `Annunci per ${FREE_BOARD_POST_DAYS} giorni`,
    premium: `Annunci per ${PREMIUM_BOARD_POST_DAYS} giorni`
  },
  {
    Icon: Sparkles,
    title: 'Identità luminosa',
    free: 'Nickname standard',
    premium: 'Nickname e icona Premium illuminati'
  }
]

export default function PremiumPage() {
  const router = useRouter()
  const [loading, setLoading] = useState(true)
  const [profile, setProfile] = useState<PremiumProfile | null>(null)
  const [checkoutLoading, setCheckoutLoading] = useState(false)
  const [message, setMessage] = useState('')

  useEffect(() => {
    const load = async () => {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session?.user) {
        router.replace('/')
        return
      }

      const { data, error } = await supabase
        .from('profiles')
        .select('id, username, is_premium, premium_until, premium_since, premium_source, is_vip, vip_since')
        .eq('id', session.user.id)
        .maybeSingle()

      if (error) {
        const { data: fallback } = await supabase
          .from('profiles')
          .select('id, username')
          .eq('id', session.user.id)
          .maybeSingle()
        setProfile({ ...fallback, email: session.user.email })
      } else {
        setProfile({ ...data, email: session.user.email })
      }

      setLoading(false)
    }

    load()
  }, [router])

  const tier = getPremiumTier(profile, { id: profile?.id, email: profile?.email })
  const activeLabel = premiumLabel(tier)

  const startCheckout = async () => {
    if (checkoutLoading) return
    setCheckoutLoading(true)
    setMessage('')

    try {
      const { data: { session } } = await supabase.auth.getSession()
      const res = await fetch('/api/premium/checkout', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: session?.access_token ? `Bearer ${session.access_token}` : ''
        }
      })
      const data = await res.json()

      if (!res.ok || !data?.url) {
        setMessage(data?.error || 'Pagamento non ancora configurato.')
        return
      }

      window.location.href = data.url
    } catch {
      setMessage('Non sono riuscito ad aprire il pagamento.')
    } finally {
      setCheckoutLoading(false)
    }
  }

  return (
    <div className="min-h-dvh text-white onepiece-wave-bg onepiece-clouds">
      <Topbar />
      <Sidebar activePage="profilo" />

      <main className="mx-auto max-w-5xl px-4 pb-28 pt-20 sm:px-6">
        <section className="overflow-hidden rounded-[2rem] border border-cyan-200/20 bg-slate-950/80 shadow-2xl shadow-slate-950/30">
          <div className="bg-gradient-to-br from-cyan-300/18 via-white/[0.04] to-rose-300/14 p-5 sm:p-8">
            <div className="flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <div className="inline-flex items-center gap-2 rounded-full border border-cyan-200/30 bg-cyan-300/12 px-3 py-1 text-[10px] font-black uppercase tracking-[0.24em] text-cyan-100">
                  <Crown size={14} /> Premium
                </div>
                <h1 className="mt-4 text-3xl font-black text-white sm:text-5xl">Supporta OPV</h1>
                <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-300 sm:text-base">
                  Premium serve a sostenere il sito, mantenere scanner, database, prezzi e nuove funzioni senza riempire l'app di pubblicità.
                </p>
              </div>

              <div className="rounded-[1.5rem] border border-white/12 bg-slate-950/72 p-4 text-center">
                <p className="text-4xl font-black text-cyan-200">1€</p>
                <p className="text-xs font-bold uppercase tracking-[0.22em] text-slate-400">al mese</p>
                {activeLabel ? (
                  <div className="mt-3 rounded-2xl border border-emerald-300/30 bg-emerald-300/12 px-3 py-2 text-sm font-black text-emerald-100">
                    Attivo: {activeLabel}
                  </div>
                ) : null}
              </div>
            </div>
          </div>

          <div className="grid gap-3 p-4 sm:grid-cols-2 sm:p-6">
            {perks.map(({ Icon, title, free, premium }) => (
              <article key={title} className="rounded-[1.5rem] border border-slate-700 bg-slate-900/72 p-4">
                <div className="flex items-center gap-3">
                  <div className="grid h-11 w-11 place-items-center rounded-2xl bg-cyan-300/15 text-cyan-100">
                    <Icon size={20} />
                  </div>
                  <h2 className="text-base font-black text-white">{title}</h2>
                </div>
                <div className="mt-4 grid gap-2 text-sm">
                  <div className="rounded-2xl border border-slate-700 bg-slate-950/70 px-3 py-2 text-slate-400">
                    Free: {free}
                  </div>
                  <div className="rounded-2xl border border-cyan-200/30 bg-cyan-300/12 px-3 py-2 font-bold text-cyan-100">
                    Premium: {premium}
                  </div>
                </div>
              </article>
            ))}
          </div>

          <div className="border-t border-slate-800 p-4 sm:p-6">
            <button
              onClick={startCheckout}
              disabled={checkoutLoading || loading || tier !== 'free'}
              className="flex w-full items-center justify-center gap-2 rounded-2xl bg-cyan-300 px-5 py-4 text-sm font-black text-slate-950 shadow-lg shadow-cyan-950/20 transition hover:bg-cyan-200 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {tier === 'free' ? (
                <>
                  <Crown size={18} />
                  {checkoutLoading ? 'Apro pagamento...' : 'Attiva Premium'}
                </>
              ) : (
                <>
                  <Infinity size={18} />
                  Premium già attivo
                </>
              )}
            </button>
            {message ? <p className="mt-3 rounded-2xl border border-amber-300/25 bg-amber-300/10 px-3 py-2 text-sm text-amber-100">{message}</p> : null}
          </div>
        </section>
      </main>
    </div>
  )
}
