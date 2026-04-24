'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { ShieldCheck, ArrowLeft } from 'lucide-react'
import { supabase } from '@/lib/supabase'

const ADMIN_USER_ID = 'fcade84e-6413-4009-91df-a8c839a170cc'

type ProfileItem = {
  id: string
  username: string | null
  username_locked?: boolean
  is_blocked?: boolean
}

type MissingCardRequest = {
  id: number
  card_name: string
  card_op: string
  card_number: string
  status?: string
  reported_by?: string
  reporter_username?: string | null
  created_at?: string
}

export default function AdminPage() {
  const router = useRouter()
  const [loading, setLoading] = useState(true)
  const [profiles, setProfiles] = useState<ProfileItem[]>([])
  const [requests, setRequests] = useState<MissingCardRequest[]>([])
  const [actionMessage, setActionMessage] = useState('')
  const [busy, setBusy] = useState(false)

  const testDatabaseConnection = async () => {
    console.log('🧪 [ADMIN] Testing database connection...')

    // Test 1: Check if we can access profiles table at all
    try {
      const { data: profilesData, error: profilesError } = await supabase
        .from('profiles')
        .select('count', { count: 'exact', head: true })

      console.log('🧪 [ADMIN] Profiles count query:', { count: profilesData, error: profilesError })
    } catch (err) {
      console.error('🧪 [ADMIN] Profiles count error:', err)
    }

    // Test 2: Check if we can access auth.users (should fail due to RLS)
    try {
      const { data: authData, error: authError } = await supabase.auth.admin.listUsers()
      console.log('🧪 [ADMIN] Auth users query:', { count: authData?.users?.length, error: authError })
    } catch (err) {
      console.error('🧪 [ADMIN] Auth users error (expected):', err instanceof Error ? err.message : String(err))
    }

    // Test 3: Check missing_card_reports
    try {
      const { data: reportsData, error: reportsError } = await supabase
        .from('missing_card_reports')
        .select('count', { count: 'exact', head: true })

      console.log('🧪 [ADMIN] Reports count query:', { count: reportsData, error: reportsError })
    } catch (err) {
      console.error('🧪 [ADMIN] Reports count error:', err instanceof Error ? err.message : String(err))
    }
  }

  const createMissingProfiles = async () => {
    console.log('🔧 [ADMIN] Creating missing profiles...')

    try {
      // This is a workaround - we'll try to create profiles for any users that might exist
      // Note: This won't work if we can't access auth.users, but let's try
      setActionMessage('Tentativo di creazione profili mancanti...')

      // For now, just show a message that this needs to be done manually
      setActionMessage('I profili devono essere creati automaticamente dal callback di auth. Verifica che gli utenti abbiano completato la registrazione.')

    } catch (err) {
      console.error('❌ [ADMIN] Create profiles error:', err)
      setActionMessage('Errore nella creazione profili.')
    }
  }

  const fetchProfiles = async () => {
    console.log('🔍 [ADMIN] Fetching profiles...')
    const { data, error } = await supabase
      .from('profiles')
      .select('id, username, username_locked, is_blocked')

    console.log('🔍 [ADMIN] Profiles result:', { data, error, count: data?.length || 0 })

    if (error) {
      console.warn('❌ [ADMIN] fetchProfiles error', error)
      setActionMessage(`Errore caricamento profili: ${error.message}`)
      setProfiles([])
      return
    }

    setProfiles(data || [])
    console.log('✅ [ADMIN] Profiles loaded:', data?.length || 0, 'profiles')
  }

  const fetchRequests = async () => {
    console.log('🔍 [ADMIN] Fetching requests...')
    const { data, error } = await supabase
      .from('missing_card_reports')
      .select(`
        id,
        card_name,
        card_op,
        card_number,
        status,
        reported_by,
        created_at,
        profiles!missing_card_reports_reported_by_fkey (
          username
        )
      `)
      .order('created_at', { ascending: false })

    if (error) {
      console.warn('❌ [ADMIN] fetchRequests error', error)
      setRequests([])
      return
    }

    // Transform the data to include reporter_username
    const transformedData = (data || []).map((request: any) => ({
      ...request,
      reporter_username: request.profiles?.username || null
    }))

    console.log('✅ [ADMIN] Requests loaded:', transformedData.length, 'requests')
    setRequests(transformedData)
  }

  useEffect(() => {
    const init = async () => {
      console.log('🔐 [ADMIN] Initializing admin page...')
      const { data } = await supabase.auth.getSession()
      const user = data?.session?.user

      console.log('🔐 [ADMIN] Current user:', user?.id, 'Expected admin:', ADMIN_USER_ID)

      if (!user) {
        console.log('❌ [ADMIN] No user session, redirecting to /')
        router.replace('/')
        return
      }

      if (user.id !== ADMIN_USER_ID) {
        console.log('❌ [ADMIN] User is not admin, redirecting to /dashboard')
        router.replace('/dashboard')
        return
      }

      console.log('✅ [ADMIN] User is admin, loading data...')
      await testDatabaseConnection()
      await refreshData()
      setLoading(false)
    }

    init()
  }, [router])

  const toggleBlockUser = async (profile: ProfileItem) => {
    if (!profile.id) return
    const nextBlocked = !profile.is_blocked
    setBusy(true)
    const { error } = await supabase
      .from('profiles')
      .update({ is_blocked: nextBlocked })
      .eq('id', profile.id)

    if (error) {
      setActionMessage('Errore durante il blocco/sblocco utente.')
      console.error(error)
    } else {
      setActionMessage(`Utente ${profile.username || profile.id} aggiornato.`)
      await fetchProfiles()
    }
    setBusy(false)
  }

  const deleteUser = async (profile: ProfileItem) => {
    if (!profile.id) return
    if (!confirm(`Sei sicuro di eliminare ${profile.username || profile.id}? Questa azione rimuove il profilo e la collezione.`)) {
      return
    }

    setBusy(true)
    const { error: cardsError } = await supabase
      .from('user_cards')
      .delete()
      .eq('user_id', profile.id)

    const { error: profileError } = await supabase
      .from('profiles')
      .delete()
      .eq('id', profile.id)

    if (cardsError || profileError) {
      setActionMessage('Errore durante l\'eliminazione utente.')
      console.error(cardsError || profileError)
    } else {
      setActionMessage(`Utente ${profile.username || profile.id} eliminato.`)
      await refreshData()
    }
    setBusy(false)
  }

  const markRequestResolved = async (requestId: number) => {
    setBusy(true)
    const { error } = await supabase
      .from('missing_card_reports')
      .update({ status: 'resolved' })
      .eq('id', requestId)

    if (error) {
      setActionMessage('Errore nel marcaggio della notifica.')
      console.error(error)
    } else {
      setActionMessage('Richiesta aggiornata come risolta.')
      await fetchRequests()
    }
    setBusy(false)
  }

  const deleteResolvedRequest = async (requestId: number) => {
    if (!confirm('Sei sicuro di voler eliminare questa richiesta risolta?')) {
      return
    }

    console.log('🗑️ [ADMIN] Deleting request:', requestId)
    setBusy(true)
    const { error } = await supabase
      .from('missing_card_reports')
      .delete()
      .eq('id', requestId)

    if (error) {
      console.error('❌ [ADMIN] Delete request error:', error)
      setActionMessage('Errore nell\'eliminazione della richiesta.')
    } else {
      console.log('✅ [ADMIN] Request deleted successfully')
      setActionMessage('Richiesta eliminata con successo.')
      await fetchRequests()
    }
    setBusy(false)
  }

  if (loading) {
    return (
      <div className="min-h-screen text-white onepiece-wave-bg onepiece-clouds flex items-center justify-center">
        <div className="rounded-3xl border border-teal-800/30 bg-slate-900/80 px-6 py-5 text-slate-100">Caricamento admin...</div>
      </div>
    )
  }

  return (
    <div className="min-h-screen text-white onepiece-wave-bg onepiece-clouds px-4 py-8 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-7xl rounded-[2rem] border border-teal-800/30 bg-slate-950/90 shadow-2xl shadow-slate-950/40 p-6">
        <div className="flex items-center justify-between gap-3 mb-6">
          <button
            onClick={() => router.push('/dashboard')}
            className="p-2 rounded-2xl bg-slate-800/70 border border-teal-800/30 hover:scale-105 transition"
          >
            <ArrowLeft />
          </button>
          <div className="flex-1 text-center">
            <p className="text-xs uppercase tracking-[0.35em] text-amber-300/80">Pannello Founder</p>
            <h1 className="text-3xl font-extrabold text-white">Admin Dashboard</h1>
          </div>
          <div className="w-10"></div>
        </div>

        <div className="mt-6 rounded-[1.75rem] border border-slate-800/70 bg-slate-900/90 p-5">
          <div className="flex items-center justify-between">
            <p className="text-sm text-slate-300">Qui puoi visualizzare gli utenti, bloccarli, eliminarli e gestire le richieste di carte mancanti segnalate dagli utenti. Questa area è visibile solo al founder.</p>
            <div className="flex gap-2">
              <button
                onClick={refreshData}
                disabled={busy}
                className="px-3 py-1 text-xs bg-green-500/20 text-green-200 border border-green-500/30 rounded-lg hover:bg-green-500/30 disabled:opacity-50"
              >
                Ricarica
              </button>
              <button
                onClick={testDatabaseConnection}
                className="px-3 py-1 text-xs bg-blue-500/20 text-blue-200 border border-blue-500/30 rounded-lg hover:bg-blue-500/30"
              >
                Debug DB
              </button>
            </div>
          </div>
        </div>

        {actionMessage && (
          <div className="mt-5 rounded-3xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-200">
            {actionMessage}
          </div>
        )}

        <div className="mt-8 grid gap-6 xl:grid-cols-[1.3fr_0.7fr]">
          <section className="rounded-[1.75rem] border border-slate-800/70 bg-slate-900/90 p-5">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-xs uppercase tracking-[0.25em] text-slate-500">Utenti registrati</p>
                <h2 className="mt-2 text-xl font-semibold text-white">Gestione utenti</h2>
              </div>
              <div className="rounded-full bg-slate-800/80 px-3 py-1 text-xs uppercase tracking-[0.18em] text-slate-300">Totale {profiles.length}</div>
            </div>

            <div className="mt-6 space-y-3">
              {profiles.length === 0 ? (
                <div className="rounded-3xl border border-amber-500/30 bg-amber-500/10 p-6 text-center">
                  <p className="text-amber-200 font-semibold mb-2">Nessun profilo trovato</p>
                  <p className="text-sm text-amber-300/80 mb-4">
                    Gli utenti potrebbero non aver completato la registrazione o le policies RLS non sono configurate correttamente.
                  </p>
                  <div className="flex gap-2 justify-center">
                    <button
                      onClick={refreshData}
                      className="px-4 py-2 bg-amber-500/20 text-amber-200 border border-amber-500/30 rounded-lg hover:bg-amber-500/30"
                    >
                      Riprova
                    </button>
                    <button
                      onClick={testDatabaseConnection}
                      className="px-4 py-2 bg-blue-500/20 text-blue-200 border border-blue-500/30 rounded-lg hover:bg-blue-500/30"
                    >
                      Debug
                    </button>
                  </div>
                </div>
              ) : (
                profiles.map((profile) => (
                <div key={profile.id} className="rounded-3xl border border-slate-800/80 bg-slate-950/80 p-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0">
                    <p className="font-semibold text-white truncate">{profile.username || 'Utente anonimo'}</p>
                    <p className="text-xs text-slate-500">ID: {profile.id}</p>
                    <p className="text-xs text-slate-400">{profile.username_locked ? 'Nickname bloccato' : 'Nickname modificabile'}</p>
                  </div>

                  <div className="flex flex-wrap gap-2">
                    <button
                      onClick={() => toggleBlockUser(profile)}
                      disabled={busy}
                      className={`rounded-2xl px-3 py-2 text-xs font-semibold transition ${profile.is_blocked ? 'bg-green-500/15 text-emerald-200 border border-emerald-500/20 hover:bg-green-500/20' : 'bg-amber-400/10 text-amber-200 border border-amber-300/20 hover:bg-amber-400/20'}`}
                    >
                      {profile.is_blocked ? 'Sblocca' : 'Blocca'}
                    </button>
                    <button
                      onClick={() => deleteUser(profile)}
                      disabled={busy || profile.id === ADMIN_USER_ID}
                      className="rounded-2xl bg-red-500/10 px-3 py-2 text-xs font-semibold text-red-200 border border-red-500/20 hover:bg-red-500/20 disabled:opacity-50"
                    >
                      Elimina
                    </button>
                  </div>
                </div>
              )))}
            </div>
          </section>

          <aside className="rounded-[1.75rem] border border-slate-800/70 bg-slate-900/90 p-5">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-xs uppercase tracking-[0.25em] text-slate-500">Notifiche</p>
                <h2 className="mt-2 text-xl font-semibold text-white">Richieste carte</h2>
              </div>
              <ShieldCheck className="text-amber-400" />
            </div>

            <div className="mt-6 space-y-3">
              {requests.length === 0 ? (
                <div className="rounded-3xl border border-slate-800/70 bg-slate-950/80 p-4 text-sm text-slate-400">
                  Nessuna richiesta nuova al momento.
                </div>
              ) : (
                requests.map((request) => (
                  <div key={request.id} className="rounded-3xl border border-slate-800/70 bg-slate-950/80 p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="text-sm font-semibold text-white">{request.card_name}</p>
                        <p className="text-xs text-slate-400">OP: {request.card_op} • Numero: {request.card_number}</p>
                      </div>
                      <span className="rounded-full bg-amber-400/10 px-2 py-1 text-[10px] uppercase tracking-[0.18em] text-amber-200">
                        {request.status === 'resolved' ? 'Risolto' : 'Nuova'}
                      </span>
                    </div>
                    <div className="mt-3 flex items-center justify-between gap-2">
                      <p className="text-xs text-slate-500">Segnalata da {request.reporter_username || 'sconosciuto'}</p>
                      <div className="flex gap-2">
                        {request.status !== 'resolved' && (
                          <button
                            onClick={() => markRequestResolved(request.id)}
                            disabled={busy}
                            className="rounded-2xl bg-emerald-500/10 px-3 py-2 text-xs font-semibold text-emerald-200 border border-emerald-500/20 hover:bg-emerald-500/20"
                          >
                            Risolvi
                          </button>
                        )}
                        {request.status === 'resolved' && (
                          <button
                            onClick={() => deleteResolvedRequest(request.id)}
                            disabled={busy}
                            className="rounded-2xl bg-red-500/10 px-3 py-2 text-xs font-semibold text-red-200 border border-red-500/20 hover:bg-red-500/20"
                          >
                            Cancella
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
          </aside>
        </div>
      </div>
    </div>
  )
}