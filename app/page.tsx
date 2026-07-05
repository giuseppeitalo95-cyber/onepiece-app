'use client'

import { supabase } from '@/lib/supabase'

export default function Home() {
  const login = async () => {
    await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: 'https://onepiece-app-one.vercel.app/auth/callback'
      }
    })
  }

  return (
    <div className="min-h-screen flex items-center justify-center onepiece-wave-bg onepiece-clouds px-4 py-8">
      <div className="w-full max-w-5xl rounded-[32px] border border-amber-400/20 bg-slate-950/75 shadow-[0_30px_80px_rgba(0,0,0,0.45)] backdrop-blur-xl overflow-hidden">
        <div className="grid lg:grid-cols-[1.05fr_0.95fr] gap-0">
          <div className="p-8 sm:p-10 lg:p-12 flex flex-col justify-center bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950">
            <div className="inline-flex w-fit items-center gap-3 rounded-full border border-amber-400/30 bg-amber-400/10 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.35em] text-amber-300">
              <span className="h-2.5 w-2.5 rounded-full bg-amber-400" />
              OnePiece Vault
            </div>

            <div className="mt-6 flex items-center gap-4">
              <div className="flex h-16 w-16 items-center justify-center rounded-2xl border border-amber-400/30 bg-gradient-to-br from-amber-300 via-yellow-400 to-amber-500 text-lg font-black tracking-[0.3em] text-slate-950 shadow-lg shadow-amber-500/20">
                OPV
              </div>
              <div>
                <p className="text-xs uppercase tracking-[0.45em] text-slate-400">Scanner + collezione</p>
                <h1 className="text-3xl sm:text-4xl font-black tracking-[0.25em] text-amber-300">
                  ONEPIECE VAULT
                </h1>
              </div>
            </div>

            <p className="mt-6 max-w-xl text-base sm:text-lg text-slate-300 leading-7">
              Scansiona le tue carte, organizza il tuo mazzo e tieni tutto sotto controllo con un’esperienza da vera app da collezionista.
            </p>

            <div className="mt-8 grid gap-3 sm:grid-cols-3 text-sm text-slate-300">
              <div className="rounded-2xl border border-white/10 bg-white/5 p-3">
                <p className="font-semibold text-amber-300">Scan live</p>
                <p className="mt-1 text-slate-400">Anteprima camera immediata e pulita.</p>
              </div>
              <div className="rounded-2xl border border-white/10 bg-white/5 p-3">
                <p className="font-semibold text-amber-300">Catalogo</p>
                <p className="mt-1 text-slate-400">Trova e aggiungi carte in un attimo.</p>
              </div>
              <div className="rounded-2xl border border-white/10 bg-white/5 p-3">
                <p className="font-semibold text-amber-300">Valore</p>
                <p className="mt-1 text-slate-400">Tieni sotto controllo prezzi e collezione.</p>
              </div>
            </div>

            <button
              onClick={login}
              className="mt-8 flex w-full items-center justify-center gap-3 rounded-2xl bg-white px-4 py-3.5 font-semibold text-slate-900 shadow-lg shadow-white/10 transition hover:scale-[1.01] hover:bg-slate-100"
            >
              <img src="https://www.google.com/favicon.ico" alt="Google" className="h-5 w-5" />
              Continua con Google
            </button>
          </div>

          <div className="relative flex items-center justify-center bg-gradient-to-br from-amber-400/10 via-slate-900 to-slate-950 p-6 sm:p-8 lg:p-10">
            <div className="relative w-full max-w-[420px]">
              <div className="absolute inset-0 rounded-[30px] bg-gradient-to-br from-amber-400/30 to-transparent blur-3xl" />
              <div className="relative overflow-hidden rounded-[30px] border border-amber-400/20 bg-slate-900/90 p-4 shadow-[0_25px_60px_rgba(0,0,0,0.35)]">
                <div className="rounded-[24px] border border-white/10 bg-gradient-to-b from-slate-800 to-slate-950 p-4">
                  <div className="rounded-[20px] border border-amber-400/20 bg-slate-950/80 p-3">
                    <div className="flex items-center justify-between text-[10px] uppercase tracking-[0.35em] text-slate-400">
                      <span>Preview scanner</span>
                      <span className="text-amber-300">LIVE</span>
                    </div>
                    <div className="mt-3 aspect-[3/4] rounded-[18px] border border-amber-400/20 bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 p-4">
                      <div className="flex h-full flex-col justify-between rounded-[14px] border border-white/10 bg-[radial-gradient(circle_at_top,_rgba(251,191,36,0.2),_transparent_55%)] p-4">
                        <div className="flex items-center justify-between text-[10px] uppercase tracking-[0.3em] text-slate-400">
                          <span>OnePiece</span>
                          <span className="text-amber-300">Scanner</span>
                        </div>
                        <div className="rounded-[16px] border border-amber-400/20 bg-slate-900/80 p-4 text-center">
                          <p className="text-lg font-bold text-amber-300">Cerca, scansiona, aggiungi</p>
                          <p className="mt-2 text-sm text-slate-400">Tutto in una app elegante e veloce.</p>
                        </div>
                        <div className="flex items-center justify-between text-[10px] uppercase tracking-[0.3em] text-slate-400">
                          <span>OPV</span>
                          <span className="text-emerald-400">Ready</span>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}