import Link from 'next/link'
import {
  ArrowLeft,
  CheckCircle2,
  Download,
  Globe2,
  Monitor,
  Plus,
  Share2,
  Smartphone
} from 'lucide-react'
import AppLogo from '@/app/components/AppLogo'

const platforms = [
  {
    name: 'iPhone e iPad',
    subtitle: 'Usa Safari',
    icon: Smartphone,
    accent: 'border-cyan-200/25 bg-cyan-200/[0.07] text-cyan-100',
    steps: [
      { icon: Globe2, text: 'Apri One Piece Vault in Safari.' },
      { icon: Share2, text: 'Premi Condividi nella barra di Safari.' },
      { icon: Plus, text: 'Scegli Aggiungi alla schermata Home.' },
      { icon: CheckCircle2, text: 'Attiva Apri come app, poi premi Aggiungi.' }
    ]
  },
  {
    name: 'Android',
    subtitle: 'Usa Google Chrome',
    icon: Smartphone,
    accent: 'border-emerald-200/25 bg-emerald-200/[0.07] text-emerald-100',
    steps: [
      { icon: Globe2, text: 'Apri One Piece Vault in Chrome.' },
      { icon: Plus, text: 'Apri il menu con i tre puntini.' },
      { icon: Download, text: 'Premi Aggiungi a schermata Home o Installa app.' },
      { icon: CheckCircle2, text: 'Conferma con Installa.' }
    ]
  },
  {
    name: 'Windows',
    subtitle: 'Usa Microsoft Edge',
    icon: Monitor,
    accent: 'border-amber-200/25 bg-amber-200/[0.07] text-amber-100',
    steps: [
      { icon: Globe2, text: 'Apri One Piece Vault in Microsoft Edge.' },
      { icon: Plus, text: 'Apri il menu con i tre puntini.' },
      { icon: Download, text: 'Vai su App e scegli Installa il sito come app.' },
      { icon: CheckCircle2, text: "Conferma l'installazione." }
    ]
  }
]

export default function InstallPage() {
  return (
    <div className="min-h-dvh onepiece-wave-bg onepiece-clouds px-3 py-4 text-white sm:px-6 sm:py-7 lg:px-8">
      <main className="relative z-10 mx-auto w-full max-w-6xl">
        <header className="grid grid-cols-[44px_1fr_44px] items-center">
          <Link
            href="/"
            aria-label="Torna all accesso"
            className="grid h-11 w-11 place-items-center rounded-2xl border border-white/10 bg-slate-950/40 text-cyan-100 transition hover:bg-slate-900/70 active:scale-95"
          >
            <ArrowLeft size={20} />
          </Link>
          <div className="flex justify-center">
            <AppLogo compact />
          </div>
          <div />
        </header>

        <section className="mx-auto mt-7 max-w-2xl text-center sm:mt-10">
          <div className="mx-auto grid h-12 w-12 place-items-center rounded-2xl border border-cyan-200/25 bg-cyan-200/10 text-cyan-100">
            <Download size={23} />
          </div>
          <h1 className="mt-4 text-3xl font-black text-white sm:text-4xl">Installa One Piece Vault</h1>
          <p className="mx-auto mt-3 max-w-xl text-sm leading-6 text-slate-300 sm:text-base">
            Aggiungi OPV al dispositivo per aprirla a schermo intero, come una normale app, senza passare ogni volta dal browser.
          </p>
        </section>

        <section className="mt-7 grid gap-3 lg:grid-cols-3 lg:gap-4">
          {platforms.map(platform => {
            const PlatformIcon = platform.icon
            return (
              <article key={platform.name} className="overflow-hidden rounded-2xl border border-white/10 bg-slate-900/78 shadow-xl shadow-black/15 backdrop-blur-xl">
                <div className={`flex items-center gap-3 border-b px-4 py-4 ${platform.accent}`}>
                  <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl border border-current/20 bg-slate-950/25">
                    <PlatformIcon size={21} />
                  </div>
                  <div className="min-w-0">
                    <h2 className="text-base font-black text-white">{platform.name}</h2>
                    <p className="text-xs font-bold opacity-80">{platform.subtitle}</p>
                  </div>
                </div>

                <ol className="space-y-1 p-3">
                  {platform.steps.map((step, index) => {
                    const StepIcon = step.icon
                    return (
                      <li key={step.text} className="grid grid-cols-[36px_1fr] items-center gap-2 rounded-xl px-2 py-2.5">
                        <div className="relative grid h-9 w-9 place-items-center rounded-xl bg-white/[0.06] text-cyan-100">
                          <StepIcon size={16} />
                          <span className="absolute -right-1 -top-1 grid h-4 min-w-4 place-items-center rounded-full bg-cyan-300 px-1 text-[9px] font-black text-slate-950">
                            {index + 1}
                          </span>
                        </div>
                        <p className="text-sm font-semibold leading-5 text-slate-200">{step.text}</p>
                      </li>
                    )
                  })}
                </ol>
              </article>
            )
          })}
        </section>

        <div className="mt-6 flex justify-center pb-4">
          <Link
            href="/"
            className="flex w-full max-w-sm items-center justify-center gap-2 rounded-2xl bg-cyan-300 px-5 py-3 text-sm font-black text-slate-950 shadow-lg shadow-cyan-950/20 transition hover:bg-cyan-200 active:scale-[0.98]"
          >
            <ArrowLeft size={17} />
            Torna ad accesso e registrazione
          </Link>
        </div>
      </main>
    </div>
  )
}
