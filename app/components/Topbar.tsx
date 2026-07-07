'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { isAdminAccount } from '@/lib/admin'

export default function Topbar() {
  const router = useRouter()
  const [username, setUsername] = useState('')
  const [avatarUrl, setAvatarUrl] = useState('')
  const [isAdmin, setIsAdmin] = useState(false)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const loadProfile = async () => {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session?.user) {
        setLoading(false)
        return
      }

      const { data } = await supabase
        .from('profiles')
        .select('username, avatar_url')
        .eq('id', session.user.id)
        .maybeSingle()

      setUsername(data?.username || 'Utente')
      setAvatarUrl(data?.avatar_url || '')
      setIsAdmin(isAdminAccount(session.user, data))
      setLoading(false)
    }

    loadProfile()
  }, [])

  return (
    <div className="fixed left-0 right-0 top-0 z-40 flex h-14 items-center gap-2 border-b border-teal-800/30 bg-slate-900/85 px-3 shadow-lg shadow-black/20 backdrop-blur-md sm:px-4">
      <div className="w-14 shrink-0" />

      <div className="flex min-w-0 flex-1 items-center justify-center">
        <div className="relative flex flex-col items-center justify-center px-2">
          <img
            src="/luffyhatlogo.webp"
            className="absolute -top-6 h-20 w-20 object-contain drop-shadow-lg onepiece-float sm:-top-8 sm:h-28 sm:w-28"
            alt="Logo Cap"
          />
          <span className="whitespace-nowrap bg-gradient-to-r from-cyan-100 via-amber-200 to-cyan-300 bg-clip-text pt-8 text-base font-extrabold tracking-[0.25em] text-transparent sm:pt-10 sm:text-2xl">
            OPV
          </span>
        </div>
      </div>

      <div className="flex min-w-0 shrink-0 items-center justify-end gap-2">
        {isAdmin && (
          <button
            onClick={() => router.push('/admin')}
            className="rounded-full border border-cyan-300/30 bg-cyan-300/10 px-2 py-1 text-[10px] font-bold uppercase tracking-[0.18em] text-cyan-100 transition hover:bg-cyan-300/20"
          >
            Admin
          </button>
        )}
        <button
          onClick={() => router.push('/profile')}
          className="flex min-w-0 items-center gap-2 rounded-full border border-slate-700 bg-slate-800/60 px-2 py-1 transition hover:border-cyan-300 hover:bg-slate-700/80"
        >
          <div className="h-7 w-7 shrink-0 overflow-hidden rounded-full border border-cyan-300/30 bg-gradient-to-br from-cyan-200 to-amber-200 sm:h-8 sm:w-8">
            {avatarUrl ? (
              <img src={avatarUrl} alt="Avatar" className="h-full w-full object-cover" />
            ) : (
              <div className="flex h-full w-full items-center justify-center text-sm font-bold text-slate-900">
                {(username || 'U').charAt(0).toUpperCase()}
              </div>
            )}
          </div>
          <span className="max-w-[82px] truncate text-[10px] font-semibold text-cyan-100 sm:max-w-[110px] sm:text-xs">
            {loading ? '...' : username}
          </span>
        </button>
      </div>
    </div>
  )
}
