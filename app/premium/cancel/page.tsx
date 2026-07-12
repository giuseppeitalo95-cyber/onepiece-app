'use client'

import Link from 'next/link'

export default function PremiumCancelPage() {
  return (
    <div className="grid min-h-dvh place-items-center px-4 text-white onepiece-wave-bg onepiece-clouds">
      <div className="max-w-md rounded-[2rem] border border-slate-700 bg-slate-950/88 p-6 text-center shadow-2xl">
        <h1 className="text-2xl font-black">Pagamento annullato</h1>
        <p className="mt-2 text-sm text-slate-300">Nessun problema, puoi attivare Premium quando vuoi.</p>
        <Link href="/premium" className="mt-5 inline-flex rounded-2xl bg-cyan-300 px-5 py-3 text-sm font-black text-slate-950">
          Rivedi Premium
        </Link>
      </div>
    </div>
  )
}
