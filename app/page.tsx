'use client'

import { supabase } from '@/lib/supabase'
import { useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { Eye, EyeOff, LockKeyhole, Mail, ShieldCheck, Sparkles, UserRound } from 'lucide-react'

type AuthMode = 'login' | 'register'

const getAuthErrorMessage = (message: string, mode: AuthMode) => {
  const lower = message.toLowerCase()

  if (lower.includes('already') || lower.includes('registered') || lower.includes('exists')) {
    return 'Email gia in uso. Se avevi usato Google, accedi con Google. Se avevi una password, passa ad Accesso.'
  }

  if (lower.includes('invalid login') || lower.includes('invalid credentials')) {
    return 'Email o password non corretti.'
  }

  if (lower.includes('email not confirmed') || lower.includes('not confirmed')) {
    return 'Prima devi confermare la mail che ti abbiamo inviato.'
  }

  if (lower.includes('password')) {
    return mode === 'register'
      ? 'Password troppo debole: usa almeno 6 caratteri.'
      : 'Password non valida.'
  }

  return 'Qualcosa non ha funzionato. Riprova tra poco.'
}

export default function Home() {
  const router = useRouter()
  const [checkingSession, setCheckingSession] = useState(true)
  const [mode, setMode] = useState<AuthMode>('login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [username, setUsername] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [authBusy, setAuthBusy] = useState(false)
  const [authMessage, setAuthMessage] = useState('')
  const [authError, setAuthError] = useState('')

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

  const loginGoogle = async () => {
    setAuthBusy(true)
    setAuthError('')
    setAuthMessage('')

    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: `${window.location.origin}/auth/callback`,
        queryParams: {
          prompt: 'select_account'
        }
      }
    })

    if (error) {
      setAuthBusy(false)
      setAuthError(getAuthErrorMessage(error.message, mode))
    }
  }

  const handleEmailAuth = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (authBusy) return

    const cleanEmail = email.trim().toLowerCase()
    const cleanUsername = username.trim()

    setAuthError('')
    setAuthMessage('')

    if (!cleanEmail || !password.trim()) {
      setAuthError('Inserisci email e password.')
      return
    }

    if (mode === 'register' && cleanUsername.length < 3) {
      setAuthError('Scegli un nickname di almeno 3 caratteri.')
      return
    }

    setAuthBusy(true)

    if (mode === 'register') {
      const { data, error } = await supabase.auth.signUp({
        email: cleanEmail,
        password,
        options: {
          emailRedirectTo: `${window.location.origin}/auth/callback`,
          data: {
            username: cleanUsername
          }
        }
      })

      setAuthBusy(false)

      const identities = data.user?.identities
      if (error || (Array.isArray(identities) && identities.length === 0)) {
        setAuthError(getAuthErrorMessage(error?.message || 'User already registered', 'register'))
        return
      }

      if (data.session) {
        router.replace('/auth/callback')
        return
      }

      setAuthMessage('Ti abbiamo inviato la mail di conferma. Aprila, conferma e poi accedi.')
      return
    }

    const { error } = await supabase.auth.signInWithPassword({
      email: cleanEmail,
      password
    })

    setAuthBusy(false)

    if (error) {
      setAuthError(getAuthErrorMessage(error.message, 'login'))
      return
    }

    router.replace('/auth/callback')
  }

  if (checkingSession) {
    return (
      <div className="min-h-screen flex items-center justify-center onepiece-wave-bg onepiece-clouds px-4 py-8">
        <div className="rounded-2xl border border-cyan-300/20 bg-slate-900/80 px-5 py-3 text-sm font-semibold text-cyan-200">
          Caricamento...
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen overflow-hidden onepiece-wave-bg onepiece-clouds px-4 py-6 text-white sm:px-6 lg:px-8">
      <div className="mx-auto grid min-h-[calc(100vh-3rem)] w-full max-w-6xl items-center gap-5 lg:grid-cols-[1.05fr_0.95fr]">
        <section className="relative hidden min-h-[620px] overflow-hidden rounded-[2rem] border border-white/10 bg-slate-900/72 p-8 shadow-2xl shadow-black/25 lg:block">
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_25%_18%,rgba(110,231,249,0.18),transparent_32%),radial-gradient(circle_at_78%_75%,rgba(251,113,133,0.16),transparent_30%)]" />
          <div className="relative flex h-full flex-col justify-between">
            <div>
              <div className="inline-flex items-center gap-2 rounded-full border border-cyan-300/20 bg-cyan-300/10 px-3 py-2 text-xs font-black uppercase tracking-[0.2em] text-cyan-100">
                <Sparkles size={14} />
                One Piece Vault
              </div>
              <h1 className="mt-7 max-w-lg text-5xl font-black leading-[0.96] tracking-normal text-white">
                Il vault per scan, prezzi e collezione.
              </h1>
              <p className="mt-5 max-w-md text-sm leading-6 text-slate-300">
                Entri, scannerizzi le carte, controlli il valore e tieni tutto ordinato in un posto solo.
              </p>
            </div>

            <div className="grid grid-cols-3 gap-3">
              {[
                ['Scan', 'Camera live'],
                ['Valore', 'EUR live'],
                ['Vault', 'Collezione'],
              ].map(([label, value]) => (
                <div key={label} className="rounded-3xl border border-white/10 bg-white/[0.06] p-4">
                  <p className="text-[10px] font-black uppercase tracking-[0.22em] text-slate-400">{label}</p>
                  <p className="mt-2 text-sm font-black text-cyan-100">{value}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        <main className="mx-auto w-full max-w-[440px] rounded-[2rem] border border-white/10 bg-slate-900/86 p-4 shadow-2xl shadow-black/30 backdrop-blur-2xl sm:p-6">
          <div className="flex items-center justify-center">
            <img
              src="/luffyhatlogo.webp"
              alt="Logo OnePiece Vault"
              className="h-28 w-28 object-contain drop-shadow-lg onepiece-float sm:h-32 sm:w-32"
            />
          </div>

          <div className="mt-2 text-center">
            <p className="text-xs font-black uppercase tracking-[0.35em] text-cyan-200">One Piece</p>
            <h2 className="mt-1 text-3xl font-black text-white">Vault</h2>
          </div>

          <div className="mt-5 grid grid-cols-2 rounded-2xl border border-slate-700 bg-slate-950/70 p-1">
            {[
              ['login', 'Accesso'],
              ['register', 'Registrati'],
            ].map(([key, label]) => (
              <button
                key={key}
                type="button"
                onClick={() => {
                  setMode(key as AuthMode)
                  setAuthError('')
                  setAuthMessage('')
                }}
                className={`rounded-xl px-3 py-2 text-sm font-black transition ${
                  mode === key
                    ? 'bg-cyan-300 text-slate-950 shadow-lg shadow-cyan-950/20'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          <button
            onClick={loginGoogle}
            disabled={authBusy}
            className="mt-4 flex w-full items-center justify-center gap-3 rounded-2xl border border-white/14 bg-white px-4 py-3 text-sm font-black text-slate-950 shadow-lg shadow-black/10 transition disabled:opacity-60"
          >
            <img src="https://www.google.com/favicon.ico" alt="Google" className="h-5 w-5" />
            Continua con Google
          </button>

          <div className="my-5 flex items-center gap-3 text-[10px] font-black uppercase tracking-[0.22em] text-slate-500">
            <span className="h-px flex-1 bg-slate-700" />
            oppure
            <span className="h-px flex-1 bg-slate-700" />
          </div>

          <form onSubmit={handleEmailAuth} className="space-y-3">
            {mode === 'register' && (
              <label className="block">
                <span className="mb-1.5 flex items-center gap-2 text-xs font-bold text-slate-300">
                  <UserRound size={14} />
                  Nickname
                </span>
                <input
                  value={username}
                  onChange={(event) => setUsername(event.target.value)}
                  placeholder="peppitalo"
                  className="w-full rounded-2xl border border-slate-700 bg-slate-950/80 px-4 py-3 text-sm text-white outline-none transition placeholder:text-slate-600 focus:border-cyan-300 focus:ring-2 focus:ring-cyan-300/15"
                  autoComplete="nickname"
                />
              </label>
            )}

            <label className="block">
              <span className="mb-1.5 flex items-center gap-2 text-xs font-bold text-slate-300">
                <Mail size={14} />
                Email
              </span>
              <input
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="nome@email.it"
                className="w-full rounded-2xl border border-slate-700 bg-slate-950/80 px-4 py-3 text-sm text-white outline-none transition placeholder:text-slate-600 focus:border-cyan-300 focus:ring-2 focus:ring-cyan-300/15"
                autoComplete="email"
                inputMode="email"
              />
            </label>

            <label className="block">
              <span className="mb-1.5 flex items-center gap-2 text-xs font-bold text-slate-300">
                <LockKeyhole size={14} />
                Password
              </span>
              <div className="relative">
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  placeholder="Almeno 6 caratteri"
                  className="w-full rounded-2xl border border-slate-700 bg-slate-950/80 px-4 py-3 pr-12 text-sm text-white outline-none transition placeholder:text-slate-600 focus:border-cyan-300 focus:ring-2 focus:ring-cyan-300/15"
                  autoComplete={mode === 'register' ? 'new-password' : 'current-password'}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(prev => !prev)}
                  className="absolute right-2 top-1/2 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-xl text-slate-400 hover:text-white"
                  aria-label={showPassword ? 'Nascondi password' : 'Mostra password'}
                >
                  {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              </div>
            </label>

            {authError ? (
              <div className="rounded-2xl border border-rose-400/25 bg-rose-400/10 px-4 py-3 text-sm font-semibold text-rose-100">
                {authError}
              </div>
            ) : null}

            {authMessage ? (
              <div className="rounded-2xl border border-emerald-400/25 bg-emerald-400/10 px-4 py-3 text-sm font-semibold text-emerald-100">
                {authMessage}
              </div>
            ) : null}

            <button
              type="submit"
              disabled={authBusy}
              className="flex w-full items-center justify-center gap-2 rounded-2xl border border-cyan-300/40 bg-cyan-300 px-4 py-3 text-sm font-black text-slate-950 shadow-lg shadow-cyan-950/20 transition disabled:opacity-60"
            >
              <ShieldCheck size={17} />
              {authBusy ? 'Attendi...' : mode === 'register' ? 'Crea account' : 'Accedi'}
            </button>
          </form>
        </main>
      </div>
    </div>
  )
}
