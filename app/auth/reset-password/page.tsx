'use client'

import { supabase } from '@/lib/supabase'
import { Eye, EyeOff, LockKeyhole, ShieldCheck } from 'lucide-react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { FormEvent, useEffect, useState } from 'react'
import AppLogo from '@/app/components/AppLogo'

export default function ResetPasswordPage() {
  const router = useRouter()
  const [checkingSession, setCheckingSession] = useState(true)
  const [hasSession, setHasSession] = useState(false)
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    const checkRecoverySession = async () => {
      const { data: { session } } = await supabase.auth.getSession()
      setHasSession(Boolean(session?.user))
      setCheckingSession(false)
    }

    const { data: listener } = supabase.auth.onAuthStateChange(event => {
      if (event === 'PASSWORD_RECOVERY' || event === 'SIGNED_IN') {
        setHasSession(true)
        setCheckingSession(false)
      }
    })

    checkRecoverySession()

    return () => listener.subscription.unsubscribe()
  }, [])

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (busy) return

    setError('')
    setMessage('')

    if (password.trim().length < 6) {
      setError('Usa almeno 6 caratteri per la nuova password.')
      return
    }

    if (password !== confirmPassword) {
      setError('Le due password non coincidono.')
      return
    }

    setBusy(true)
    const { error: updateError } = await supabase.auth.updateUser({ password })
    setBusy(false)

    if (updateError) {
      setError('Link non valido o scaduto. Richiedi una nuova mail di recupero.')
      return
    }

    setMessage('Password aggiornata. Ora puoi entrare con la nuova password.')
    window.setTimeout(() => router.replace('/auth/callback'), 900)
  }

  return (
    <div className="min-h-screen overflow-hidden onepiece-wave-bg onepiece-clouds px-4 py-6 text-white sm:px-6 lg:px-8">
      <main className="mx-auto flex min-h-[calc(100vh-3rem)] w-full max-w-[440px] items-center">
        <section className="w-full rounded-[2rem] border border-white/10 bg-slate-900/86 p-4 shadow-2xl shadow-black/30 backdrop-blur-2xl sm:p-6">
          <div className="flex items-center justify-center">
            <AppLogo className="scale-125" />
          </div>

          <div className="mt-4 text-center">
            <p className="text-xs font-black uppercase tracking-[0.35em] text-cyan-200">One Piece Vault</p>
            <h1 className="mt-1 text-3xl font-black text-white">Nuova password</h1>
            <p className="mt-2 text-sm leading-6 text-slate-300">
              Scegli una nuova password per rientrare nel tuo vault.
            </p>
          </div>

          {checkingSession ? (
            <div className="mt-6 rounded-2xl border border-cyan-300/20 bg-cyan-300/10 px-4 py-3 text-sm font-semibold text-cyan-100">
              Controllo link di recupero...
            </div>
          ) : hasSession ? (
            <form onSubmit={handleSubmit} className="mt-6 space-y-3">
              <label className="block">
                <span className="mb-1.5 flex items-center gap-2 text-xs font-bold text-slate-300">
                  <LockKeyhole size={14} />
                  Nuova password
                </span>
                <div className="relative">
                  <input
                    type={showPassword ? 'text' : 'password'}
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    placeholder="Almeno 6 caratteri"
                    className="w-full rounded-2xl border border-slate-700 bg-slate-950/80 px-4 py-3 pr-12 text-sm text-white outline-none transition placeholder:text-slate-600 focus:border-cyan-300 focus:ring-2 focus:ring-cyan-300/15"
                    autoComplete="new-password"
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

              <label className="block">
                <span className="mb-1.5 flex items-center gap-2 text-xs font-bold text-slate-300">
                  <LockKeyhole size={14} />
                  Conferma password
                </span>
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={confirmPassword}
                  onChange={(event) => setConfirmPassword(event.target.value)}
                  placeholder="Ripeti la password"
                  className="w-full rounded-2xl border border-slate-700 bg-slate-950/80 px-4 py-3 text-sm text-white outline-none transition placeholder:text-slate-600 focus:border-cyan-300 focus:ring-2 focus:ring-cyan-300/15"
                  autoComplete="new-password"
                />
              </label>

              {error ? (
                <div className="rounded-2xl border border-rose-400/25 bg-rose-400/10 px-4 py-3 text-sm font-semibold text-rose-100">
                  {error}
                </div>
              ) : null}

              {message ? (
                <div className="rounded-2xl border border-emerald-400/25 bg-emerald-400/10 px-4 py-3 text-sm font-semibold text-emerald-100">
                  {message}
                </div>
              ) : null}

              <button
                type="submit"
                disabled={busy}
                className="flex w-full items-center justify-center gap-2 rounded-2xl border border-cyan-300/40 bg-cyan-300 px-4 py-3 text-sm font-black text-slate-950 shadow-lg shadow-cyan-950/20 transition disabled:opacity-60"
              >
                <ShieldCheck size={17} />
                {busy ? 'Aggiorno...' : 'Aggiorna password'}
              </button>
            </form>
          ) : (
            <div className="mt-6 space-y-3">
              <div className="rounded-2xl border border-rose-400/25 bg-rose-400/10 px-4 py-3 text-sm font-semibold text-rose-100">
                Link non valido o scaduto. Torna all'accesso e richiedi una nuova mail.
              </div>
              <Link
                href="/"
                className="flex w-full items-center justify-center rounded-2xl border border-cyan-300/40 bg-cyan-300 px-4 py-3 text-sm font-black text-slate-950 shadow-lg shadow-cyan-950/20 transition"
              >
                Torna all'accesso
              </Link>
            </div>
          )}
        </section>
      </main>
    </div>
  )
}
