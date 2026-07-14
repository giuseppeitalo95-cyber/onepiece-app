'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import { useRouter } from 'next/navigation'
import Image from 'next/image'
import { ArrowLeft, Crown, LoaderCircle, RotateCcw, Sparkles } from 'lucide-react'
import Sidebar from '@/app/components/Sidebar'
import Topbar from '@/app/components/Topbar'
import CardImage from '@/app/components/CardImage'
import { supabase } from '@/lib/supabase'
import styles from './reward.module.css'

type RewardStatus = {
  available: boolean
  founder?: boolean
  unlimited?: boolean
  playedToday?: boolean
  setupRequired?: boolean
  error?: string | null
}

type RewardResult = {
  won: boolean
  founder?: boolean
  rewardDays: number
  vipUntil?: string | null
  card: {
    cardId: string
    name: string
    imageUrl: string
  }
}

type Phase = 'idle' | 'locking' | 'revealed'

const CARD_COUNT = 9
const confettiColors = ['#fde047', '#f59e0b', '#67e8f9', '#fb7185', '#ffffff']
const delay = (milliseconds: number) => new Promise(resolve => window.setTimeout(resolve, milliseconds))
const preloadImage = (source: string) => new Promise<void>(resolve => {
  const image = new window.Image()
  const timeout = window.setTimeout(resolve, 2600)
  image.onload = () => {
    window.clearTimeout(timeout)
    resolve()
  }
  image.onerror = () => {
    window.clearTimeout(timeout)
    resolve()
  }
  image.src = source
})

export default function DailyRewardPage() {
  const router = useRouter()
  const [status, setStatus] = useState<RewardStatus | null>(null)
  const [phase, setPhase] = useState<Phase>('idle')
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null)
  const [result, setResult] = useState<RewardResult | null>(null)
  const [message, setMessage] = useState('')
  const founderAttemptRef = useRef(0)
  const localPreviewRef = useRef(false)

  const loadStatus = useCallback(async () => {
    if (process.env.NODE_ENV === 'development' && window.location.search.includes('preview=founder')) {
      localPreviewRef.current = true
      setStatus({ available: true, founder: true, unlimited: true })
      return
    }

    const { data: { session } } = await supabase.auth.getSession()
    if (!session?.access_token) {
      router.replace('/')
      return
    }

    try {
      const response = await fetch('/api/daily-reward', {
        headers: { Authorization: `Bearer ${session.access_token}` }
      })
      const data = await response.json()
      setStatus(data)
    } catch {
      setStatus({ available: false, error: 'Reward momentaneamente non disponibile.' })
    }
  }, [router])

  useEffect(() => {
    const timer = window.setTimeout(() => { void loadStatus() }, 0)
    return () => window.clearTimeout(timer)
  }, [loadStatus])

  useEffect(() => {
    void preloadImage('/rewards/opv-card-back.jpeg')
    void preloadImage('/rewards/opv-special-card.jpeg')
  }, [])

  const chooseCard = async (index: number) => {
    if (!status?.available || phase !== 'idle') return

    setSelectedIndex(index)
    setPhase('locking')
    setMessage('La rotta è stata scelta...')
    const specialPreload = preloadImage('/rewards/opv-special-card.jpeg')

    const currentFounderAttempt = founderAttemptRef.current
    founderAttemptRef.current += 1

    try {
      if (localPreviewRef.current) {
        await delay(1050)
        const previewWon = currentFounderAttempt % 2 === 1
        const previewResult: RewardResult = {
          won: previewWon,
          founder: true,
          rewardDays: previewWon ? 7 : 0,
          card: previewWon
            ? {
                cardId: 'OPV-001',
                name: "Pirate King's Ticket",
                imageUrl: '/rewards/opv-special-card.jpeg'
              }
            : {
                cardId: 'OP16-056',
                name: 'Mr.3(Galdino)',
                imageUrl: 'https://en.onepiece-cardgame.com/images/cardlist/card/OP16-056.png'
              }
        }
        await Promise.all([
          preloadImage(previewResult.card.imageUrl),
          previewWon ? specialPreload : Promise.resolve()
        ])
        setResult(previewResult)
        setMessage(previewWon ? 'Il tesoro ha scelto te.' : 'Questa volta il tesoro era altrove.')
        await delay(previewWon ? 220 : 80)
        setPhase('revealed')
        return
      }

      const { data: { session } } = await supabase.auth.getSession()
      if (!session?.access_token) throw new Error('Sessione scaduta')

      const request = fetch('/api/daily-reward', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`
        },
        body: JSON.stringify({
          selectedIndex: index,
          founderAttempt: currentFounderAttempt
        })
      })

      const [response] = await Promise.all([request, delay(1050)])
      const data = await response.json()
      if (!response.ok) throw new Error(data?.error || 'Reward non disponibile')

      if (data?.card?.imageUrl) {
        await Promise.all([
          preloadImage(data.card.imageUrl),
          data.won ? specialPreload : Promise.resolve()
        ])
      }
      setResult(data)
      setMessage(data.won ? 'Il tesoro ha scelto te.' : 'Questa volta il tesoro era altrove.')
      await delay(data.won ? 220 : 80)
      setPhase('revealed')
    } catch (error) {
      setSelectedIndex(null)
      setPhase('idle')
      setMessage(error instanceof Error ? error.message : 'Riprova tra poco.')
      void loadStatus()
    }
  }

  const replayFounder = () => {
    setSelectedIndex(null)
    setResult(null)
    setMessage('')
    setPhase('idle')
  }

  const confetti = result?.won && phase === 'revealed'
    ? Array.from({ length: 34 }, (_, index) => {
        const style = {
          '--x': `${(index * 29 + 7) % 100}%`,
          '--drift': `${((index % 7) - 3) * 24}px`,
          '--rotation': `${(index * 47) % 180}deg`,
          '--duration': `${2.8 + (index % 6) * 0.22}s`,
          '--delay': `${(index % 9) * 0.07}s`,
          '--color': confettiColors[index % confettiColors.length]
        } as CSSProperties
        return <span key={index} className={styles.confetti} style={style} />
      })
    : null

  return (
    <div className={styles.page}>
      <div className={styles.preloadAssets} aria-hidden="true">
        <Image src="/rewards/opv-card-back.jpeg" alt="" width={1054} height={1494} priority />
        <Image src="/rewards/opv-special-card.jpeg" alt="" width={1055} height={1508} priority />
      </div>
      <Topbar />
      <Sidebar activePage="collezione" />
      {confetti}

      <main className={styles.shell}>
        <header className={styles.header}>
          <div className="mx-auto inline-flex items-center gap-2 rounded-full border border-amber-300/30 bg-amber-300/10 px-3 py-1.5 text-[10px] font-black uppercase tracking-[0.24em] text-amber-200 shadow-[0_0_22px_rgba(251,191,36,0.12)]">
            <Crown size={14} />
            Reward giornaliero
          </div>
          <h1 className="mt-2 text-xl font-black text-white sm:mt-3 sm:text-4xl">Scegli una carta tra queste</h1>
          <p className="mt-1 text-xs text-slate-300 sm:mt-2 sm:text-base">
            Se trovi la carta speciale vinci 7 giorni di VIP gratis.
          </p>
          {status?.founder && (
            <p className="mt-2 text-[10px] font-black uppercase tracking-[0.18em] text-cyan-200">
              Modalità founder: tentativi illimitati
            </p>
          )}
        </header>

        {!status ? (
          <div className="flex flex-1 items-center justify-center text-cyan-100">
            <LoaderCircle className="animate-spin" size={28} />
          </div>
        ) : !status.available ? (
          <section className="mx-auto w-full max-w-md rounded-3xl border border-white/12 bg-slate-950/55 p-6 text-center shadow-2xl backdrop-blur-xl">
            <Sparkles className="mx-auto text-amber-300" size={34} />
            <h2 className="mt-4 text-xl font-black text-white">
              {status.setupRequired ? 'Reward in configurazione' : 'Hai già giocato oggi'}
            </h2>
            <p className="mt-2 text-sm leading-6 text-slate-300">
              {status.setupRequired
                ? 'La modalità sarà disponibile appena viene completata la configurazione.'
                : 'La prossima scelta sarà disponibile domani.'}
            </p>
            <button
              type="button"
              onClick={() => router.push('/dashboard')}
              className="mt-5 inline-flex items-center gap-2 rounded-2xl bg-cyan-300 px-4 py-3 text-sm font-black text-slate-950 transition active:scale-95"
            >
              <ArrowLeft size={17} />
              Torna alla collezione
            </button>
          </section>
        ) : (
          <>
            <section className={styles.stage}>
              <div className={styles.grid}>
                {Array.from({ length: CARD_COUNT }, (_, index) => {
                  const selected = selectedIndex === index
                  const dismissed = selectedIndex !== null && !selected
                  const flipped = selected && phase === 'revealed' && result
                  const cardStyle = { '--order': index } as CSSProperties

                  return (
                    <button
                      key={index}
                      type="button"
                      disabled={phase !== 'idle'}
                      onClick={() => chooseCard(index)}
                      aria-label={`Scegli la carta ${index + 1}`}
                      className={`${styles.cardButton} ${selected ? styles.selected : ''} ${dismissed ? styles.dismissed : ''} ${selected && result?.won ? styles.winnerSelected : ''}`}
                      style={cardStyle}
                    >
                      {selected && phase !== 'idle' && <span className={styles.chosenHalo} />}
                      <span className={`${styles.cardInner} ${flipped ? styles.flipped : ''}`}>
                        <span className={`${styles.face} ${styles.back}`} style={cardStyle}>
                          <Image
                            src="/rewards/opv-card-back.jpeg"
                            alt="Dorso carta OPV"
                            className={styles.image}
                            draggable={false}
                            width={1054}
                            height={1494}
                            priority
                            sizes="(max-width: 640px) 29vw, 180px"
                          />
                        </span>
                        <span className={`${styles.face} ${styles.front} ${result?.won ? styles.win : ''}`}>
                          {result?.won ? (
                            <Image
                              src="/rewards/opv-special-card.jpeg"
                              alt="Pirate King's Ticket"
                              className={styles.image}
                              draggable={false}
                              width={1055}
                              height={1508}
                              priority
                              sizes="(max-width: 640px) 86vw, 520px"
                            />
                          ) : result?.card ? (
                            <CardImage
                              src={result.card.imageUrl}
                              cardId={result.card.cardId}
                              alt={result.card.name}
                              className="h-full w-full"
                              imgClassName="h-full w-full object-cover"
                              loading="eager"
                              fetchPriority="high"
                            />
                          ) : null}
                        </span>
                      </span>
                    </button>
                  )
                })}
              </div>
            </section>

            <div className={styles.resultDock}>
              {phase === 'locking' && (
                <div className="flex items-center justify-center gap-2 text-sm font-bold text-amber-100">
                  <LoaderCircle className="animate-spin" size={18} />
                  {message}
                </div>
              )}

              {phase === 'revealed' && result && (
                <div className={`${styles.resultPanel} rounded-3xl border px-4 py-4 backdrop-blur-xl ${result.won ? 'border-amber-300/45 bg-amber-300/12 shadow-[0_0_36px_rgba(251,191,36,0.18)]' : 'border-cyan-300/20 bg-slate-950/45'}`}>
                  <h2 className={`text-xl font-black ${result.won ? 'text-amber-200' : 'text-white'}`}>
                    {result.won ? 'Hai trovato il Pirate King’s Ticket!' : result.card.name}
                  </h2>
                  <p className="mt-1 text-sm text-slate-300">
                    {result.won
                      ? 'Hai vinto 7 giorni VIP. Il premio è già attivo sul tuo account.'
                      : 'Nessun premio questa volta. Torna domani per una nuova scelta.'}
                  </p>

                  <div className="mt-4 flex flex-wrap justify-center gap-2">
                    <button
                      type="button"
                      onClick={() => router.push('/dashboard')}
                      className="inline-flex items-center gap-2 rounded-2xl border border-slate-600 bg-slate-900/80 px-4 py-2.5 text-sm font-bold text-slate-100 transition active:scale-95"
                    >
                      <ArrowLeft size={16} />
                      Collezione
                    </button>
                    {status.founder && (
                      <button
                        type="button"
                        onClick={replayFounder}
                        className="inline-flex items-center gap-2 rounded-2xl bg-amber-300 px-4 py-2.5 text-sm font-black text-slate-950 shadow-[0_0_24px_rgba(251,191,36,0.22)] transition active:scale-95"
                      >
                        <RotateCcw size={16} />
                        Gioca ancora
                      </button>
                    )}
                  </div>
                </div>
              )}

              {phase === 'idle' && message && (
                <p className="rounded-2xl border border-rose-300/20 bg-rose-300/10 px-4 py-3 text-sm text-rose-100">{message}</p>
              )}
            </div>
          </>
        )}
      </main>
    </div>
  )
}
