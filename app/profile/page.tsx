'use client'

import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useRouter } from 'next/navigation'
import { ArrowLeft } from 'lucide-react'

export default function Profile() {
  const router = useRouter()

  const [email, setEmail] = useState('')
  const [username, setUsername] = useState('')
  const [canEdit, setCanEdit] = useState(false)
  const [loading, setLoading] = useState(true)
  const [userId, setUserId] = useState<string | null>(null)

  useEffect(() => {
    const load = async () => {
      const { data: { session } } = await supabase.auth.getSession()

      if (!session?.user) {
        router.push('/')
        return
      }

      const user = session.user

      setEmail(user.email ?? '')
      setUserId(user.id)

      // 🔥 IMPORTANTE: prendi anche username_locked
      const { data } = await supabase
        .from('profiles')
        .select('username, username_locked')
        .eq('id', user.id)
        .single()

      setUsername(data?.username ?? '')

      // 🔥 QUESTA È LA REGOLA VERA
      setCanEdit(!data?.username_locked)

      setLoading(false)
    }

    load()
  }, [])

  const saveUsername = async () => {
    if (!userId || !username) return

    await supabase
      .from('profiles')
      .update({
        username,
        username_locked: true
      })
      .eq('id', userId)

    setCanEdit(false)
  }

  const logout = async () => {
    await supabase.auth.signOut()
    router.push('/')
  }

  return (
    <div className="min-h-screen bg-[#070A12] text-white">

      {/* HEADER */}
      <div className="flex items-center gap-3 p-4 border-b border-teal-800/20 bg-slate-900/60 backdrop-blur-md">

        <button
          onClick={() => router.push('/dashboard')}
          className="p-2 rounded-lg bg-slate-800/60 border border-teal-800/30 hover:scale-105 transition"
        >
          <ArrowLeft />
        </button>

        <h1 className="text-lg font-bold text-amber-300">
          Profilo
        </h1>

      </div>

      {/* CONTENT */}
      <div className="flex justify-center mt-10">

        <div className="w-[420px] bg-slate-900/80 border border-teal-800/30 rounded-2xl p-6">

          {loading ? (
            <p className="text-gray-400">Caricamento...</p>
          ) : (
            <div className="flex flex-col gap-5">

              {/* EMAIL */}
              <div>
                <p className="text-xs text-gray-400">Email</p>
                <p>{email}</p>
              </div>

              {/* USERNAME */}
              <div>
                <p className="text-xs text-gray-400">Username</p>

                {canEdit ? (
                  <div className="flex gap-2 mt-1">
                    <input
                      value={username}
                      onChange={(e) => setUsername(e.target.value)}
                      className="flex-1 px-3 py-2 bg-slate-800 border border-teal-700 rounded-lg"
                    />

                    <button
                      onClick={saveUsername}
                      className="px-3 py-2 bg-amber-400 text-black rounded-lg font-bold"
                    >
                      Salva
                    </button>
                  </div>
                ) : (
                  <p>{username}</p>
                )}
              </div>

              {/* AVATAR */}
              <div>
                <p className="text-xs text-gray-400">Avatar</p>
                <div className="w-12 h-12 rounded-full bg-gray-600 border border-gray-500 mt-1" />
              </div>

              {/* LOGOUT */}
              <button
                onClick={logout}
                className="mt-4 bg-red-500/20 border border-red-500 text-red-300 py-2 rounded-lg hover:bg-red-500/30"
              >
                Disconnettiti
              </button>

            </div>
          )}

        </div>

      </div>

    </div>
  )
}