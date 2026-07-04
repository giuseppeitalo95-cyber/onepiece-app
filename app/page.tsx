'use client'

import { supabase } from '@/lib/supabase'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Eye, EyeOff } from 'lucide-react'

export default function Home() {
  const router = useRouter()
  const [loginMode, setLoginMode] = useState<'google' | 'username'>('google')
  const [isSignUp, setIsSignUp] = useState(false)
  const [username, setUsername] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [showConfirmPassword, setShowConfirmPassword] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')

  const loginGoogle = async () => {
    await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: 'https://onepiece-app-one.vercel.app/auth/callback'
      }
    })
  }

  const handleSignUp = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setSuccess('')

    if (!username || !email || !password || !confirmPassword) {
      setError('Compila tutti i campi')
      return
    }

    if (password !== confirmPassword) {
      setError('Le password non corrispondono')
      return
    }

    setLoading(true)

    try {
      const res = await fetch('/api/auth/signup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, email, password })
      })

      const data = await res.json()

      if (!res.ok) {
        setError(data.error || 'Errore registrazione')
        setLoading(false)
        return
      }

      setSuccess('Registrazione completata! Accedi con le tue credenziali.')
      setUsername('')
      setEmail('')
      setPassword('')
      setConfirmPassword('')
      setIsSignUp(false)
    } catch (err) {
      setError('Errore durante la registrazione')
    }

    setLoading(false)
  }

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setSuccess('')

    if (!username || !password) {
      setError('Compila username e password')
      return
    }

    setLoading(true)

    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password })
      })

      const data = await res.json()

      if (!res.ok) {
        setError(data.error || 'Errore login')
        setLoading(false)
        return
      }

      // Login riuscito, reindirizza alla dashboard
      await supabase.auth.setSession({
        access_token: data.session.access_token,
        refresh_token: data.session.refresh_token
      })

      router.push('/dashboard')
    } catch (err) {
      setError('Errore durante il login')
    }

    setLoading(false)
  }

  return (
    <div className="min-h-screen flex items-center justify-center onepiece-wave-bg onepiece-clouds px-4">
      <div className="w-full max-w-md rounded-3xl bg-gradient-to-b from-slate-900/95 to-slate-900/90 border border-teal-500/30 shadow-2xl shadow-black/60 backdrop-blur-xl p-8">

        {/* LOGO SECTION */}
        <div className="flex justify-center mb-8">
          <div className="relative">
            <img
              src="/luffyhatlogo.webp"
              alt="Luffy Hat Logo"
              className="w-32 h-32 object-contain drop-shadow-2xl animate-bounce"
            />
            <div className="absolute inset-0 blur-2xl bg-amber-400/20 rounded-full" />
          </div>
        </div>

        {/* TITLE */}
        <div className="text-center mb-8">
          <h1 className="text-5xl font-extrabold tracking-wider text-transparent bg-clip-text bg-gradient-to-r from-yellow-400 via-amber-300 to-yellow-600 drop-shadow-lg mb-2">
            ONE PIECE
          </h1>
          <h2 className="text-2xl font-bold text-amber-300 tracking-[0.2em]">VAULT</h2>
          <p className="text-gray-400 text-sm mt-3">La tua collezione. I tuoi mazzi. I tuoi sogni.</p>
        </div>

        {/* TAB SELECTION */}
        <div className="flex gap-2 mb-6 bg-slate-800/50 p-1 rounded-xl border border-slate-700/50">
          <button
            onClick={() => { setLoginMode('google'); setError(''); setSuccess(''); }}
            className={`flex-1 py-2 px-3 rounded-lg font-semibold text-sm transition ${
              loginMode === 'google'
                ? 'bg-amber-400 text-slate-900'
                : 'text-gray-400 hover:text-white'
            }`}
          >
            Google
          </button>
          <button
            onClick={() => { setLoginMode('username'); setError(''); setSuccess(''); }}
            className={`flex-1 py-2 px-3 rounded-lg font-semibold text-sm transition ${
              loginMode === 'username'
                ? 'bg-amber-400 text-slate-900'
                : 'text-gray-400 hover:text-white'
            }`}
          >
            Username
          </button>
        </div>

        {/* GOOGLE LOGIN */}
        {loginMode === 'google' && (
          <div className="space-y-4">
            <button
              onClick={loginGoogle}
              className="w-full flex items-center justify-center gap-3 bg-white text-black py-3 px-4 rounded-2xl font-semibold hover:bg-gray-100 transition shadow-lg"
            >
              <img
                src="https://www.google.com/favicon.ico"
                className="w-5 h-5"
              />
              Accedi con Google
            </button>
            <p className="text-xs text-gray-500 text-center">
              Accedi rapidamente con il tuo account Google
            </p>
          </div>
        )}

        {/* USERNAME LOGIN/SIGNUP */}
        {loginMode === 'username' && (
          <form onSubmit={isSignUp ? handleSignUp : handleLogin} className="space-y-4">
            {error && (
              <div className="bg-red-500/15 border border-red-500/30 text-red-300 text-sm p-3 rounded-xl">
                {error}
              </div>
            )}

            {success && (
              <div className="bg-emerald-500/15 border border-emerald-500/30 text-emerald-300 text-sm p-3 rounded-xl">
                {success}
              </div>
            )}

            {isSignUp && (
              <div>
                <label className="block text-xs font-semibold text-gray-300 mb-2">Username</label>
                <input
                  type="text"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder="Scegli uno username"
                  className="w-full px-4 py-2.5 rounded-xl bg-slate-800/80 border border-slate-700 text-white placeholder:text-gray-500 focus:border-amber-400 focus:outline-none focus:ring-2 focus:ring-amber-400/20"
                />
              </div>
            )}

            <div>
              {isSignUp ? (
                <>
                  <label className="block text-xs font-semibold text-gray-300 mb-2">Email</label>
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="tua@email.com"
                    className="w-full px-4 py-2.5 rounded-xl bg-slate-800/80 border border-slate-700 text-white placeholder:text-gray-500 focus:border-amber-400 focus:outline-none focus:ring-2 focus:ring-amber-400/20"
                  />
                </>
              ) : (
                <>
                  <label className="block text-xs font-semibold text-gray-300 mb-2">Username</label>
                  <input
                    type="text"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    placeholder="Il tuo username"
                    className="w-full px-4 py-2.5 rounded-xl bg-slate-800/80 border border-slate-700 text-white placeholder:text-gray-500 focus:border-amber-400 focus:outline-none focus:ring-2 focus:ring-amber-400/20"
                  />
                </>
              )}
            </div>

            <div>
              <label className="block text-xs font-semibold text-gray-300 mb-2">Password</label>
              <div className="relative">
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Password"
                  className="w-full px-4 py-2.5 rounded-xl bg-slate-800/80 border border-slate-700 text-white placeholder:text-gray-500 focus:border-amber-400 focus:outline-none focus:ring-2 focus:ring-amber-400/20"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-200"
                >
                  {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              </div>
            </div>

            {isSignUp && (
              <div>
                <label className="block text-xs font-semibold text-gray-300 mb-2">Conferma Password</label>
                <div className="relative">
                  <input
                    type={showConfirmPassword ? 'text' : 'password'}
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    placeholder="Ripeti password"
                    className="w-full px-4 py-2.5 rounded-xl bg-slate-800/80 border border-slate-700 text-white placeholder:text-gray-500 focus:border-amber-400 focus:outline-none focus:ring-2 focus:ring-amber-400/20"
                  />
                  <button
                    type="button"
                    onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-200"
                  >
                    {showConfirmPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                  </button>
                </div>
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full bg-gradient-to-r from-amber-400 to-amber-500 text-slate-900 py-3 px-4 rounded-2xl font-bold hover:shadow-lg hover:shadow-amber-400/50 transition disabled:opacity-60 disabled:cursor-not-allowed"
            >
              {loading ? 'Caricamento...' : isSignUp ? 'Crea Account' : 'Accedi'}
            </button>

            <button
              type="button"
              onClick={() => {
                setIsSignUp(!isSignUp)
                setError('')
                setSuccess('')
              }}
              className="w-full text-amber-300 hover:text-amber-200 font-semibold text-sm transition py-2"
            >
              {isSignUp ? 'Hai già un account? Accedi' : 'Non hai un account? Registrati'}
            </button>
          </form>
        )}

      </div>
    </div>
  )
}