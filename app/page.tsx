'use client'

import { supabase } from '@/lib/supabase'
import { useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'

export default function Home() {
  const router = useRouter()
  const [checkingSession, setCheckingSession] = useState(true)

  useEffect(() => {
    const checkSession = async () => {
      const { data: { session } } = await supabase.auth.getSession()
      if (session?.user) {
        router.replace('/scan')
        return
      }
      setCheckingSession(false)
    }

    checkSession()
  }, [router])

  const login = async () => {
    await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: `${window.location.origin}/auth/callback`,
        queryParams: {
          prompt: 'select_account'
        }
      }
    })
  }

  if (checkingSession) {
    return (
      <div className="min-h-screen flex items-center justify-center onepiece-wave-bg onepiece-clouds px-4 py-8">
        <div className="text-sm font-semibold text-amber-300">Caricamento...</div>
      </div>
    )
  }

  return (
    <div className="min-h-screen flex items-center justify-center onepiece-wave-bg onepiece-clouds px-4 py-8">
      <div className="w-full max-w-[420px] rounded-2xl border border-blue-800/70 bg-slate-900/80 p-8 text-center shadow-2xl shadow-black/30 backdrop-blur-md">
        <div className="mb-6 flex justify-center">
          <img
            src="/luffyhatlogo.webp"
            alt="Logo OnePiece Vault"
            className="h-48 w-48 object-contain drop-shadow-lg onepiece-float"
          />
        </div>

        <div className="mb-2 leading-none">
          <h1 className="text-4xl font-extrabold tracking-widest text-transparent bg-clip-text bg-gradient-to-r from-yellow-400 via-amber-300 to-yellow-600 drop-shadow-lg">
            ONE PIECE
          </h1>
          <h2 className="mt-1 inline-block text-2xl font-bold tracking-[0.4em] text-black relative">
            <span className="absolute inset-0 blur-sm text-yellow-500 opacity-60">VAULT</span>
            <span className="relative text-yellow-400">VAULT</span>
          </h2>
        </div>

        <p className="mt-4 mb-8 text-sm text-gray-400">
          La tua collezione. I tuoi mazzi. I tuoi sogni.
        </p>

        <button
          onClick={login}
          className="flex w-full items-center justify-center gap-3 rounded-xl bg-white px-4 py-3 font-medium text-black transition hover:scale-[1.02]"
        >
          <img src="https://www.google.com/favicon.ico" alt="Google" className="h-5 w-5" />
          Continua con Google
        </button>
      </div>
    </div>
  )
}
