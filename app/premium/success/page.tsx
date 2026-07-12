'use client'

import Link from 'next/link'
import { Crown } from 'lucide-react'

export default function PremiumSuccessPage() {
  return (
    <div className="grid min-h-dvh place-items-center px-4 text-white onepiece-wave-bg onepiece-clouds">
      <div className="max-w-md rounded-[2rem] border border-cyan-200/25 bg-slate-950/88 p-6 text-center shadow-2xl">
        <div className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-cyan-300 text-slate-950">
          <Crown size={26} />
        </div>
        <h1 className="mt-4 text-2xl font-black">Premium attivato</h1>
        <p className="mt-2 text-sm text-slate-300">Grazie per supportare OPV. Se non vedi subito il badge, riapri l'app tra qualche secondo.</p>
        <Link href="/bacheca" className="mt-5 inline-flex rounded-2xl bg-cyan-300 px-5 py-3 text-sm font-black text-slate-950">
          Torna all'app
        </Link>
      </div>
    </div>
  )
}
