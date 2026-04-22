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
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-b from-black via-slate-950 to-black">

      {/* CARD */}
      <div className="w-[420px] rounded-2xl bg-slate-900/70 border border-blue-800 shadow-2xl p-8 text-center backdrop-blur-md">

       {/* LOGO */}
<div className="flex justify-center mb-6">
  <img
    src="/luffyhatlogo.webp"
    alt="Luffy Hat Logo"
    className="w-55 h-55 object-contain drop-shadow-lg"
  />
</div>

     {/* TITLE */}
<div className="mb-2 leading-none">
  <h1 className="text-4xl font-extrabold tracking-widest text-transparent bg-clip-text bg-gradient-to-r from-yellow-400 via-amber-300 to-yellow-600 drop-shadow-lg">
    ONE PIECE
  </h1>

  <h2 className="text-2xl font-bold tracking-[0.4em] text-black relative inline-block mt-1">
    <span className="absolute inset-0 blur-sm text-yellow-500 opacity-60">
      VAULT
    </span>
    <span className="relative text-yellow-400">
      VAULT
    </span>
  </h2>
</div>

{/* TAGLINE */}
<p className="text-gray-400 mb-8 text-sm mt-4">
  La tua collezione. I tuoi mazzi. I tuoi sogni.
</p>

        {/* GOOGLE BUTTON */}
        <button
          onClick={login}
          className="w-full flex items-center justify-center gap-3 bg-white text-black py-3 rounded-xl font-medium hover:scale-[1.02] transition"
        >
          <img
            src="https://www.google.com/favicon.ico"
            className="w-5 h-5"
          />
          Continua con Google
        </button>

        

      </div>
    </div>
  )
}