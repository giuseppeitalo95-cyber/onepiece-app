'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Check, Crown, Infinity, Settings, X } from 'lucide-react'
import Sidebar from '@/app/components/Sidebar'
import Topbar from '@/app/components/Topbar'
import { supabase } from '@/lib/supabase'
import { FREE_DAILY_SCAN_LIMIT, FREE_DECK_LIMIT, FREE_BOARD_POST_DAYS, PREMIUM_BOARD_POST_DAYS, getPremiumTier, premiumLabel, type PremiumProfile } from '@/lib/premium'

const freeFeatures = [
  `${FREE_DECK_LIMIT} deck salvati`,
  `${FREE_DAILY_SCAN_LIMIT} scan al giorno`,
  `Annunci visibili solo agli amici per ${FREE_BOARD_POST_DAYS} giorni`,
  'Nickname standard',
  'Funzioni base OPV'
]

const premiumFeatures = [
  'Deck salvati illimitati',
  'Scan giornaliere illimitate',
  `Annunci visibili globalmente per ${PREMIUM_BOARD_POST_DAYS} giorni`,
  'Nickname e icona Premium illuminati',
  'Supporto diretto al mantenimento del sito'
]

export default function PremiumPage() {
  const router = useRouter()
  const [loading, setLoading] = useState(true)
  const [profile, setProfile] = useState<PremiumProfile | null>(null)
  const [checkoutLoading, setCheckoutLoading] = useState(false)
  const [portalLoading, setPortalLoading] = useState(false)
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
        .select('id, username, is_premium, premium_until, premium_since, premium_source, stripe_customer_id, stripe_subscription_id, is_vip, vip_since')
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
  const hasStripeSubscription = tier === 'premium' && Boolean(profile?.stripe_customer_id)

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

  const openBillingPortal = async () => {
    if (portalLoading) return
    setPortalLoading(true)
    setMessage('')

    try {
      const { data: { session } } = await supabase.auth.getSession()
      const res = await fetch('/api/premium/portal', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: session?.access_token ? `Bearer ${session.access_token}` : ''
        }
      })
      const data = await res.json()

      if (!res.ok || !data?.url) {
        setMessage(data?.error || 'Non sono riuscito ad aprire la gestione abbonamento.')
        return
      }

      window.location.href = data.url
    } catch {
      setMessage('Non sono riuscito ad aprire la gestione abbonamento.')
    } finally {
      setPortalLoading(false)
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
                  Premium serve a sostenere il sito, mantenere scanner, database, prezzi e nuove funzioni senza riempire l'app di pubblicita.
                </p>
              </div>

              <div className="rounded-[1.5rem] border border-white/12 bg-slate-950/72 p-4 text-center">
                <p className="text-4xl font-black text-cyan-200">1 euro</p>
                <p className="text-xs font-bold uppercase tracking-[0.22em] text-slate-400">al mese</p>
                {activeLabel ? (
                  <div className="mt-3 rounded-2xl border border-emerald-300/30 bg-emerald-300/12 px-3 py-2 text-sm font-black text-emerald-100">
                    Attivo: {activeLabel}
                  </div>
                ) : null}
              </div>
            </div>
          </div>

          <div className="grid gap-4 p-4 md:grid-cols-2 sm:p-6">
            <article className="flex flex-col rounded-[1.5rem] border border-slate-700 bg-slate-900/72 p-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-[10px] font-black uppercase tracking-[0.22em] text-slate-400">Piano</p>
                  <h2 className="mt-1 text-2xl font-black text-white">Free</h2>
                </div>
                <div className="rounded-2xl border border-slate-700 bg-slate-950/75 px-3 py-2 text-sm font-black text-slate-300">
                  0 euro
                </div>
              </div>
              <div className="mt-4 flex-1 space-y-2">
                {freeFeatures.map(feature => (
                  <div key={feature} className="flex items-start gap-2 rounded-2xl border border-slate-700 bg-slate-950/62 px-3 py-2 text-sm text-slate-300">
                    <X size={16} className="mt-0.5 shrink-0 text-slate-500" />
                    <span>{feature}</span>
                  </div>
                ))}
              </div>
            </article>

            <article className="relative flex flex-col overflow-hidden rounded-[1.5rem] border border-cyan-200/35 bg-cyan-300/12 p-4 shadow-xl shadow-cyan-950/20">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-[10px] font-black uppercase tracking-[0.22em] text-cyan-100">Piano</p>
                  <h2 className="mt-1 text-2xl font-black text-white">Premium</h2>
                </div>
                <div className="rounded-2xl border border-cyan-100/35 bg-cyan-100/18 px-3 py-2 text-sm font-black text-cyan-50">
                  1 euro/mese
                </div>
              </div>
              <div className="mt-4 flex-1 space-y-2">
                {premiumFeatures.map(feature => (
                  <div key={feature} className="flex items-start gap-2 rounded-2xl border border-cyan-100/25 bg-slate-950/50 px-3 py-2 text-sm font-bold text-cyan-50">
                    <Check size={16} className="mt-0.5 shrink-0 text-cyan-200" />
                    <span>{feature}</span>
                  </div>
                ))}
              </div>
            </article>
          </div>

          <div className="border-t border-slate-800 p-4 sm:p-6">
            {tier === 'free' ? (
              <button
                onClick={startCheckout}
                disabled={checkoutLoading || loading}
                className="flex w-full items-center justify-center gap-2 rounded-2xl bg-cyan-300 px-5 py-4 text-sm font-black text-slate-950 shadow-lg shadow-cyan-950/20 transition hover:bg-cyan-200 disabled:cursor-not-allowed disabled:opacity-60"
              >
                <Crown size={18} />
                {checkoutLoading ? 'Apro pagamento...' : 'Attiva Premium'}
              </button>
            ) : hasStripeSubscription ? (
              <button
                onClick={openBillingPortal}
                disabled={portalLoading || loading}
                className="flex w-full items-center justify-center gap-2 rounded-2xl bg-cyan-300 px-5 py-4 text-sm font-black text-slate-950 shadow-lg shadow-cyan-950/20 transition hover:bg-cyan-200 disabled:cursor-not-allowed disabled:opacity-60"
              >
                <Settings size={18} />
                {portalLoading ? 'Apro gestione...' : 'Gestisci o annulla abbonamento'}
              </button>
            ) : (
              <button
                disabled
                className="flex w-full cursor-not-allowed items-center justify-center gap-2 rounded-2xl bg-cyan-300 px-5 py-4 text-sm font-black text-slate-950 opacity-70 shadow-lg shadow-cyan-950/20"
              >
                <Infinity size={18} />
                Premium gia attivo
              </button>
            )}
            {hasStripeSubscription ? (
              <p className="mt-2 text-center text-xs leading-5 text-slate-400">
                Da qui puoi annullare il rinnovo. Il mese gia pagato resta attivo fino alla scadenza Stripe.
              </p>
            ) : null}
            {message ? <p className="mt-3 rounded-2xl border border-amber-300/25 bg-amber-300/10 px-3 py-2 text-sm text-amber-100">{message}</p> : null}
          </div>
        </section>
      </main>
    </div>
  )
}
