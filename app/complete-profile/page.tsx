'use client'

import { supabase } from '@/lib/supabase'
import { useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { ShieldCheck, Sparkles, UserRound } from 'lucide-react'
import AppLogo from '@/app/components/AppLogo'

export default function CompleteProfilePage() {
  const router = useRouter()
  const [userId, setUserId] = useState<string | null>(null)
  const [nickname, setNickname] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    const load = async () => {
      const { data: { session } } = await supabase.auth.getSession()

      if (!session?.user) {
        router.replace('/')
        return
      }

      const { data: profile } = await supabase
        .from('profiles')
        .select('username')
        .eq('id', session.user.id)
        .maybeSingle()

      if (profile?.username) {
        router.replace('/bacheca')
        return
      }

      setUserId(session.user.id)
      setLoading(false)
    }

    load()
  }, [router])

  const saveNickname = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!userId || saving) return

    const cleanNickname = nickname.trim()
    setError('')

    if (cleanNickname.length < 3) {
      setError('Scegli un nickname di almeno 3 caratteri.')
      return
    }

    setSaving(true)

    const { data: existingProfile } = await supabase
      .from('profiles')
      .select('id')
      .eq('id', userId)
      .maybeSingle()

    const { error: saveError } = existingProfile
      ? await supabase
          .from('profiles')
          .update({
            username: cleanNickname,
            username_locked: true
          })
          .eq('id', userId)
      : await supabase
          .from('profiles')
          .insert({
            id: userId,
            username: cleanNickname,
            username_locked: true
          })

    setSaving(false)

    if (saveError) {
      setError('Non sono riuscito a salvare il nickname. Riprova.')
      return
    }

    router.replace('/bacheca')
  }

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center onepiece-wave-bg onepiece-clouds px-4 text-white">
        <div className="rounded-2xl border border-cyan-300/20 bg-slate-900/80 px-5 py-3 text-sm font-semibold text-cyan-200">
          Controllo profilo...
        </div>
      </div>
    )
  }

  return (
    <div className="flex min-h-screen items-center justify-center onepiece-wave-bg onepiece-clouds px-4 py-8 text-white">
      <main className="w-full max-w-[440px] overflow-hidden rounded-[2rem] border border-white/10 bg-slate-900/88 p-5 shadow-2xl shadow-black/30 backdrop-blur-2xl sm:p-7">
        <div className="flex justify-center">
          <AppLogo />
        </div>

        <div className="mt-5 text-center">
          <div className="mx-auto inline-flex items-center gap-2 rounded-full border border-cyan-300/20 bg-cyan-300/10 px-3 py-2 text-[10px] font-black uppercase tracking-[0.22em] text-cyan-100">
            <Sparkles size={13} />
            Ultimo passo
          </div>
          <h1 className="mt-4 text-3xl font-black text-white">Scegli il nickname</h1>
          <p className="mx-auto mt-2 max-w-xs text-sm leading-6 text-slate-300">
            Lo userai nel profilo e nella pagina amici. Puoi modificarlo una sola volta: dopo il salvataggio resta bloccato.
          </p>
        </div>

        <form onSubmit={saveNickname} className="mt-6 space-y-4">
          <label className="block">
            <span className="mb-1.5 flex items-center gap-2 text-xs font-bold text-slate-300">
              <UserRound size={14} />
              Nickname
            </span>
            <input
              value={nickname}
              onChange={(event) => setNickname(event.target.value)}
              placeholder="peppitalo"
              className="w-full rounded-2xl border border-slate-700 bg-slate-950/80 px-4 py-3 text-sm text-white outline-none transition placeholder:text-slate-600 focus:border-cyan-300 focus:ring-2 focus:ring-cyan-300/15"
              autoFocus
              autoComplete="nickname"
            />
          </label>

          {error ? (
            <div className="rounded-2xl border border-rose-400/25 bg-rose-400/10 px-4 py-3 text-sm font-semibold text-rose-100">
              {error}
            </div>
          ) : null}

          <button
            type="submit"
            disabled={saving}
            className="flex w-full items-center justify-center gap-2 rounded-2xl border border-cyan-300/40 bg-cyan-300 px-4 py-3 text-sm font-black text-slate-950 shadow-lg shadow-cyan-950/20 transition disabled:opacity-60"
          >
            <ShieldCheck size={17} />
            {saving ? 'Salvataggio...' : 'Entra nello scanner'}
          </button>
        </form>
      </main>
    </div>
  )
}
