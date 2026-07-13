'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { ShieldCheck, ArrowLeft, Bug, CheckCircle2, Trash2, RotateCcw } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { ADMIN_ACCOUNT, isAdminAccount } from '@/lib/admin'

type ProfileItem = {
  id: string
  username: string | null
  username_locked?: boolean
  is_blocked?: boolean
  is_premium?: boolean
  is_vip?: boolean
  vip_since?: string | null
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

type ScanUsage = {
  month?: string
  scansUsed: number
  scansLimit: number
  error?: string
}

type PriceSyncResult = {
  ok?: boolean
  updated?: number
  matched?: number
  skipped?: number
  syncedAt?: string
  error?: string
}

type BugReport = {
  id: string
  reporter_id?: string | null
  reporter_email?: string | null
  reporter_username?: string | null
  page_path?: string | null
  title?: string | null
  message: string
  user_agent?: string | null
  status: string
  resolved_at?: string | null
  created_at: string
  updated_at?: string | null
}

export default function AdminPage() {
  const router = useRouter()
  const [loading, setLoading] = useState(true)
  const [profiles, setProfiles] = useState<ProfileItem[]>([])
  const [requests, setRequests] = useState<MissingCardRequest[]>([])
  const [actionMessage, setActionMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const [scanUsage, setScanUsage] = useState<ScanUsage | null>(null)
  const [priceSyncing, setPriceSyncing] = useState(false)
  const [priceSyncResult, setPriceSyncResult] = useState<PriceSyncResult | null>(null)
  const [bugReports, setBugReports] = useState<BugReport[]>([])


  const refreshData = async () => {
    await Promise.all([fetchProfiles(), fetchRequests(), fetchScanUsage(), fetchBugReports()])
  }

  const syncPricesNow = async () => {
    if (priceSyncing) return

    setPriceSyncing(true)
    setPriceSyncResult(null)
    setActionMessage('Aggiornamento prezzi in corso...')

    try {
      const res = await fetch('/api/cardmarket/sync', { method: 'POST' })
      const data = await res.json()
      setPriceSyncResult(data)

      if (!res.ok || !data?.ok) {
        setActionMessage(`Aggiornamento prezzi fallito: ${data?.error || 'errore sconosciuto'}`)
      } else {
        setActionMessage('Prezzi aggiornati correttamente.')
      }
    } catch {
      setPriceSyncResult({ ok: false, error: 'Impossibile avviare il sync prezzi.' })
      setActionMessage('Impossibile avviare il sync prezzi.')
    }

    setPriceSyncing(false)
  }

  const fetchScanUsage = async () => {
    try {
      const res = await fetch('/api/cards/ocr')
      const data = await res.json()
      setScanUsage({
        month: data?.month,
        scansUsed: Number(data?.scansUsed || 0),
        scansLimit: Number(data?.scansLimit || 1000),
        error: data?.error
      })
    } catch {
      setScanUsage({
        scansUsed: 0,
        scansLimit: 1000,
        error: 'Impossibile leggere il contatore Google Vision.'
      })
    }
  }

  const getAccessToken = async () => {
    const { data: { session } } = await supabase.auth.getSession()
    return session?.access_token || ''
  }

  const fetchBugReports = async () => {
    const token = await getAccessToken()
    if (!token) return

    const res = await fetch('/api/bug-reports', {
      headers: { Authorization: `Bearer ${token}` }
    }).catch(() => null)
    const data = await res?.json().catch(() => null)
    if (data?.ok && Array.isArray(data.reports)) {
      setBugReports(data.reports)
    }
  }

  const fetchProfiles = async () => {
    console.log('🔍 [ADMIN] Fetching profiles...')
    // Prima prova con tutte le colonne, se fallisce usa solo le colonne base
    let query = supabase.from('profiles').select('id, username, username_locked, is_blocked, is_premium, is_vip, vip_since')

    const { data, error } = await query

    if (error) {
      console.warn('❌ [ADMIN] fetchProfiles error with all columns:', error)
      // Riprova con solo le colonne base
      console.log('🔄 [ADMIN] Retrying with basic columns...')
      const { data: basicData, error: basicError } = await supabase
        .from('profiles')
        .select('id, username')

      if (basicError) {
        console.error('❌ [ADMIN] fetchProfiles error with basic columns:', basicError)
        setActionMessage(`Errore caricamento profili: ${basicError.message}`)
        setProfiles([])
        return
      }

      // Aggiungi le colonne mancanti con valori di default
      const enrichedData = (basicData || []).map(profile => ({
        ...profile,
        username_locked: false,
        is_blocked: false,
        is_premium: false,
        is_vip: false
      }))

      setProfiles(enrichedData)
      console.log('✅ [ADMIN] Profiles loaded (basic):', enrichedData.length, 'profiles')
      return
    }

    setProfiles(data || [])
    console.log('✅ [ADMIN] Profiles loaded (full):', data?.length || 0, 'profiles')
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
      // Riprova con solo le colonne base
      console.log('🔄 [ADMIN] Retrying with basic columns...')
      const { data: basicData, error: basicError } = await supabase
        .from('missing_card_reports')
        .select('id, card_name, card_op, card_number, reported_by, created_at')
        .order('created_at', { ascending: false })

      if (basicError) {
        console.error('❌ [ADMIN] fetchRequests error with basic columns:', basicError)
        setRequests([])
        return
      }

      // Aggiungi le colonne mancanti con valori di default
      const enrichedData = (basicData || []).map((request: any) => ({
        ...request,
        status: 'new', // default status
        reporter_username: 'sconosciuto' // default username
      }))

      console.log('✅ [ADMIN] Requests loaded (basic):', enrichedData.length, 'requests')
      setRequests(enrichedData)
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

      console.log('🔐 [ADMIN] Current user:', user?.id, 'Expected admin:', ADMIN_ACCOUNT.id)

      if (!user) {
        console.log('❌ [ADMIN] No user session, redirecting to /')
        router.replace('/')
        return
      }

      const { data: adminProfile } = await supabase
        .from('profiles')
        .select('username')
        .eq('id', user.id)
        .maybeSingle()

      if (!isAdminAccount(user, adminProfile)) {
        console.log('❌ [ADMIN] User is not admin, redirecting to /dashboard')
        router.replace('/dashboard')
        return
      }

      console.log('✅ [ADMIN] User is admin, loading data...')
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

  const toggleVipUser = async (profile: ProfileItem) => {
    if (!profile.id || profile.id === ADMIN_ACCOUNT.id) return

    const nextVip = !profile.is_vip
    setBusy(true)
    const { error } = await supabase
      .from('profiles')
      .update({
        is_vip: nextVip,
        vip_since: nextVip ? new Date().toISOString() : null,
        vip_granted_by: nextVip ? ADMIN_ACCOUNT.id : null,
        vip_note: nextVip ? 'VIP assegnato da admin' : null
      })
      .eq('id', profile.id)

    if (error) {
      setActionMessage(`Errore VIP: ${error.message}. Se manca la colonna, esegui premium.sql su Supabase.`)
    } else {
      setActionMessage(nextVip ? `VIP attivato per ${profile.username || profile.id}.` : `VIP rimosso da ${profile.username || profile.id}.`)
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
    console.log('✅ [ADMIN] Marking request as resolved:', requestId)
    setBusy(true)

    try {
      // Prima prova ad aggiornare lo status
      const { error: updateError } = await supabase
        .from('missing_card_reports')
        .update({ status: 'resolved' })
        .eq('id', requestId)

      if (updateError) {
        console.warn('⚠️ [ADMIN] Could not update status (column might not exist):', updateError)
        // Anche se non riusciamo ad aggiornare lo status, consideriamo l'operazione riuscita
        // perché l'utente può comunque cancellare la richiesta
      }

      setActionMessage('Richiesta marcata come risolta.')
      await fetchRequests()
    } catch (err) {
      console.error('❌ [ADMIN] Mark resolved exception:', err)
      setActionMessage('Errore nell\'aggiornamento della richiesta.')
    } finally {
      setBusy(false)
    }
  }

  const deleteResolvedRequest = async (requestId: number) => {
    if (!confirm('Sei sicuro di voler eliminare questa richiesta risolta?')) {
      return
    }

    console.log('🗑️ [ADMIN] Deleting request:', requestId)
    setBusy(true)

    try {
      const { error } = await supabase
        .from('missing_card_reports')
        .delete()
        .eq('id', requestId)

      if (error) {
        console.error('❌ [ADMIN] Delete request error:', error)
        setActionMessage(`Errore nell'eliminazione: ${error.message}`)
      } else {
        console.log('✅ [ADMIN] Request deleted successfully')
        setActionMessage('Richiesta eliminata con successo.')
        await fetchRequests()
      }
    } catch (err) {
      console.error('❌ [ADMIN] Delete request exception:', err)
      setActionMessage('Errore imprevisto nell\'eliminazione.')
    } finally {
      setBusy(false)
    }
  }

  const updateBugStatus = async (id: string, status: 'new' | 'resolved') => {
    const token = await getAccessToken()
    if (!token) return

    setBusy(true)
    const res = await fetch('/api/bug-reports', {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`
      },
      body: JSON.stringify({ id, status })
    })
    const data = await res.json().catch(() => null)
    setActionMessage(res.ok && data?.ok
      ? status === 'resolved' ? 'Bug marcato come risolto.' : 'Bug riaperto.'
      : data?.error || 'Errore aggiornamento bug.')
    await fetchBugReports()
    setBusy(false)
  }

  const deleteBugReport = async (id: string) => {
    if (!confirm('Eliminare definitivamente questa segnalazione bug dal database?')) return

    const token = await getAccessToken()
    if (!token) return

    setBusy(true)
    const res = await fetch(`/api/bug-reports?id=${encodeURIComponent(id)}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` }
    })
    const data = await res.json().catch(() => null)
    setActionMessage(res.ok && data?.ok ? 'Bug eliminato dal database.' : data?.error || 'Errore eliminazione bug.')
    await fetchBugReports()
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

        {actionMessage && (
          <div className="mt-5 rounded-3xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-200">
            {actionMessage}
          </div>
        )}

        <div className="mt-6">
        <section className="rounded-[1.75rem] border border-cyan-300/20 bg-slate-900/90 p-5">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-xs uppercase tracking-[0.25em] text-cyan-200/80">Bug report</p>
              <h2 className="mt-2 text-xl font-semibold text-white">Segnalazioni bug</h2>
            </div>
            <div className="relative">
              <Bug className="text-cyan-200" />
              {bugReports.filter(report => report.status !== 'resolved').length > 0 ? (
                <span className="absolute -right-2 -top-2 grid h-5 min-w-5 place-items-center rounded-full bg-rose-400 px-1 text-[10px] font-black text-white">
                  {bugReports.filter(report => report.status !== 'resolved').length}
                </span>
              ) : null}
            </div>
          </div>

          <div className="mt-5 space-y-3">
            {bugReports.length === 0 ? (
              <div className="rounded-3xl border border-slate-800/70 bg-slate-950/80 p-4 text-sm text-slate-400">
                Nessuna segnalazione bug.
              </div>
            ) : bugReports.map(report => (
              <div key={report.id} className="rounded-3xl border border-slate-800/70 bg-slate-950/80 p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-white">{report.title || 'Bug senza titolo'}</p>
                    <p className="mt-1 text-xs text-slate-500">
                      {new Date(report.created_at).toLocaleString('it-IT')} · {report.page_path || 'pagina non indicata'}
                    </p>
                  </div>
                  <span className={`rounded-full px-2 py-1 text-[10px] font-black uppercase tracking-[0.16em] ${
                    report.status === 'resolved'
                      ? 'bg-emerald-300/12 text-emerald-100'
                      : 'bg-rose-400/12 text-rose-100'
                  }`}>
                    {report.status === 'resolved' ? 'Risolto' : 'Nuovo'}
                  </span>
                </div>
                <p className="mt-3 whitespace-pre-wrap text-sm leading-6 text-slate-300">{report.message}</p>
                <div className="mt-3 rounded-2xl border border-white/10 bg-white/[0.04] px-3 py-2 text-xs text-slate-400">
                  <p>Segnalato da: <span className="text-slate-200">{report.reporter_username || report.reporter_email || 'sconosciuto'}</span></p>
                  {report.resolved_at ? <p>Risolto il: {new Date(report.resolved_at).toLocaleString('it-IT')}</p> : null}
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  {report.status === 'resolved' ? (
                    <button
                      onClick={() => updateBugStatus(report.id, 'new')}
                      disabled={busy}
                      className="inline-flex items-center gap-2 rounded-2xl border border-amber-300/25 bg-amber-300/10 px-3 py-2 text-xs font-semibold text-amber-100"
                    >
                      <RotateCcw size={14} />
                      Riapri
                    </button>
                  ) : (
                    <button
                      onClick={() => updateBugStatus(report.id, 'resolved')}
                      disabled={busy}
                      className="inline-flex items-center gap-2 rounded-2xl border border-emerald-300/25 bg-emerald-300/10 px-3 py-2 text-xs font-semibold text-emerald-100"
                    >
                      <CheckCircle2 size={14} />
                      Risolto
                    </button>
                  )}
                  <button
                    onClick={() => deleteBugReport(report.id)}
                    disabled={busy}
                    className="inline-flex items-center gap-2 rounded-2xl border border-red-500/20 bg-red-500/10 px-3 py-2 text-xs font-semibold text-red-200"
                  >
                    <Trash2 size={14} />
                    Elimina DB
                  </button>
                </div>
              </div>
            ))}
          </div>
        </section>

        </div>

        <div className="mt-6">
        <section className="rounded-[1.75rem] border border-slate-800/70 bg-slate-900/90 p-5">
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
                      {(request.status === 'resolved' || !request.status) && (
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
        </section>

        </div>

        <div className="mt-6 rounded-[1.75rem] border border-amber-400/25 bg-slate-900/90 p-5">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-xs uppercase tracking-[0.25em] text-amber-300/80">Google Vision</p>
              <h2 className="mt-2 text-xl font-semibold text-white">Scansioni mensili</h2>
              <p className="mt-1 text-sm text-slate-400">
                {scanUsage?.month ? `Mese ${scanUsage.month}` : 'Mese corrente'} · limite globale prima del blocco automatico.
              </p>
              {scanUsage?.error ? (
                <p className="mt-2 text-sm text-red-300">{scanUsage.error}</p>
              ) : null}
            </div>
            <div className="min-w-[220px] rounded-3xl border border-slate-800 bg-slate-950/80 p-4">
              <div className="flex items-end justify-between gap-4">
                <div>
                  <p className="text-3xl font-extrabold text-amber-300">{scanUsage?.scansUsed ?? 0}</p>
                  <p className="text-xs uppercase tracking-[0.2em] text-slate-500">usate</p>
                </div>
                <div className="text-right">
                  <p className="text-lg font-bold text-slate-200">{scanUsage?.scansLimit ?? 1000}</p>
                  <p className="text-xs uppercase tracking-[0.2em] text-slate-500">limite</p>
                </div>
              </div>
              <div className="mt-4 h-2 overflow-hidden rounded-full bg-slate-800">
                <div
                  className="h-full rounded-full bg-amber-400"
                  style={{
                    width: `${Math.min(100, ((scanUsage?.scansUsed ?? 0) / Math.max(scanUsage?.scansLimit ?? 1000, 1)) * 100)}%`
                  }}
                />
              </div>
              <p className="mt-2 text-xs text-slate-400">
                Rimaste {Math.max((scanUsage?.scansLimit ?? 1000) - (scanUsage?.scansUsed ?? 0), 0)}
              </p>
            </div>
          </div>
        </div>

        <div className="mt-6 rounded-[1.75rem] border border-cyan-300/25 bg-slate-900/90 p-5">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-xs uppercase tracking-[0.25em] text-cyan-200/80">Prezzi</p>
              <h2 className="mt-2 text-xl font-semibold text-white">Aggiornamento manuale</h2>
              <p className="mt-1 text-sm text-slate-400">
                Il cron automatico gira 1 volta al giorno. Da qui puoi aggiornare manualmente quando vuoi.
              </p>
              {priceSyncResult ? (
                <p className={`mt-2 text-sm ${priceSyncResult.ok ? 'text-emerald-200' : 'text-red-300'}`}>
                  {priceSyncResult.ok
                    ? `Ultimo sync: ${priceSyncResult.updated ?? 0} prezzi aggiornati${priceSyncResult.syncedAt ? ` · ${new Date(priceSyncResult.syncedAt).toLocaleString('it-IT')}` : ''}`
                    : priceSyncResult.error || 'Sync fallito'}
                </p>
              ) : null}
            </div>
            <button
              onClick={syncPricesNow}
              disabled={priceSyncing}
              className="rounded-2xl border border-cyan-200/40 bg-cyan-300 px-4 py-3 text-sm font-black text-slate-950 shadow-lg shadow-cyan-950/20 transition hover:bg-cyan-200 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {priceSyncing ? 'Aggiorno...' : 'Aggiorna prezzi ora'}
            </button>
          </div>
        </div>

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
                  </div>
                </div>
              ) : (
                profiles.map((profile) => (
                <div key={profile.id} className="rounded-3xl border border-slate-800/80 bg-slate-950/80 p-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0">
                    <p className="font-semibold text-white truncate">{profile.username || 'Utente anonimo'}</p>
                    <p className="text-xs text-slate-500">ID: {profile.id}</p>
                    <div className="mt-1 flex flex-wrap gap-2 text-xs">
                      <span className="text-slate-400">{profile.username_locked ? 'Nickname bloccato' : 'Nickname modificabile'}</span>
                      {profile.id === ADMIN_ACCOUNT.id ? (
                        <span className="rounded-full bg-rose-300/15 px-2 py-0.5 font-black text-rose-100">Admin</span>
                      ) : profile.is_vip ? (
                        <span className="rounded-full bg-amber-300/15 px-2 py-0.5 font-black text-amber-100">VIP</span>
                      ) : profile.is_premium ? (
                        <span className="rounded-full bg-cyan-300/15 px-2 py-0.5 font-black text-cyan-100">Premium</span>
                      ) : null}
                    </div>
                  </div>

                  <div className="flex flex-wrap gap-2">
                    <button
                      onClick={() => toggleVipUser(profile)}
                      disabled={busy || profile.id === ADMIN_ACCOUNT.id}
                      className={`rounded-2xl px-3 py-2 text-xs font-semibold transition ${profile.is_vip ? 'bg-slate-700 text-slate-200 border border-slate-600 hover:bg-slate-600' : 'bg-amber-300/15 text-amber-100 border border-amber-200/25 hover:bg-amber-300/25'} disabled:opacity-50`}
                    >
                      {profile.is_vip ? 'Togli VIP' : 'Dai VIP'}
                    </button>
                    <button
                      onClick={() => toggleBlockUser(profile)}
                      disabled={busy}
                      className={`rounded-2xl px-3 py-2 text-xs font-semibold transition ${profile.is_blocked ? 'bg-green-500/15 text-emerald-200 border border-emerald-500/20 hover:bg-green-500/20' : 'bg-amber-400/10 text-amber-200 border border-amber-300/20 hover:bg-amber-400/20'}`}
                    >
                      {profile.is_blocked ? 'Sblocca' : 'Blocca'}
                    </button>
                    <button
                      onClick={() => deleteUser(profile)}
                      disabled={busy || profile.id === ADMIN_ACCOUNT.id}
                      className="rounded-2xl bg-red-500/10 px-3 py-2 text-xs font-semibold text-red-200 border border-red-500/20 hover:bg-red-500/20 disabled:opacity-50"
                    >
                      Elimina
                    </button>
                  </div>
                </div>
              )))}
            </div>
          </section>

        </div>
      </div>
    </div>
  )
}
