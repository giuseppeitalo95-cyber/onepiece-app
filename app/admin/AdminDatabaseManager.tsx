'use client'
/* eslint-disable react-hooks/set-state-in-effect, react-hooks/exhaustive-deps, @next/next/no-img-element */

import { FormEvent, useEffect, useMemo, useState } from 'react'
import {
  ChevronLeft,
  ChevronRight,
  Database,
  ExternalLink,
  HardDrive,
  Image as ImageIcon,
  Pencil,
  RotateCcw,
  Save,
  Search,
  ShieldAlert,
  Trash2,
  X,
} from 'lucide-react'
import { supabase } from '@/lib/supabase'

type ColumnMeta = {
  name: string
  type: string
  format: string
  required: boolean
  primaryKey: boolean
  description?: string
  defaultValue?: unknown
}

type TableMeta = {
  name: string
  columns: ColumnMeta[]
  primaryKeys: string[]
  canInsert: boolean
  canUpdate: boolean
  canDelete: boolean
  virtual?: boolean
}

type DataRow = Record<string, unknown>

type R2Object = {
  key: string
  bytes: number
  updatedAt: string | null
  etag: string | null
  publicUrl: string | null
}

type PendingAction =
  | { kind: 'save'; changes: Record<string, unknown> }
  | { kind: 'delete-row' }
  | { kind: 'delete-r2'; object: R2Object }

const formatBytes = (bytes: number) => {
  if (bytes < 1_000) return `${bytes} B`
  if (bytes < 1_000_000) return `${(bytes / 1_000).toFixed(1)} KB`
  if (bytes < 1_000_000_000) return `${(bytes / 1_000_000).toFixed(1)} MB`
  return `${(bytes / 1_000_000_000).toFixed(2)} GB`
}

const displayValue = (value: unknown) => {
  if (value === null) return 'NULL'
  if (value === undefined) return '—'
  if (typeof value === 'object') return JSON.stringify(value)
  return String(value)
}

const editorValue = (value: unknown) => {
  if (value === null || value === undefined) return 'null'
  if (typeof value === 'object') return JSON.stringify(value, null, 2)
  return String(value)
}

const parseEditorValue = (raw: string, column: ColumnMeta) => {
  if (raw.trim() === 'null') return null
  if (column.type === 'boolean') {
    if (raw === 'true') return true
    if (raw === 'false') return false
    throw new Error(`${column.name}: usa true, false oppure null`)
  }
  if (column.type === 'number' || column.type === 'integer') {
    const value = Number(raw)
    if (!Number.isFinite(value)) throw new Error(`${column.name}: numero non valido`)
    return value
  }
  if (column.format === 'jsonb' || column.format === 'json' || column.type === 'object' || column.type === 'array') {
    try {
      return JSON.parse(raw)
    } catch {
      throw new Error(`${column.name}: JSON non valido`)
    }
  }
  return raw
}

const rowTitle = (row: DataRow) => {
  const preferred = ['name', 'username', 'title', 'card_name', 'card_id', 'variant_id', 'email', 'message', 'id']
  for (const key of preferred) {
    if (row[key] !== null && row[key] !== undefined && String(row[key]).trim()) return String(row[key])
  }
  return 'Riga database'
}

export default function AdminDatabaseManager() {
  const [source, setSource] = useState<'supabase' | 'r2'>('supabase')
  const [tables, setTables] = useState<TableMeta[]>([])
  const [selectedTableName, setSelectedTableName] = useState('card_catalog')
  const [rows, setRows] = useState<DataRow[]>([])
  const [count, setCount] = useState(0)
  const [page, setPage] = useState(1)
  const [search, setSearch] = useState('')
  const [appliedSearch, setAppliedSearch] = useState('')
  const [loading, setLoading] = useState(true)
  const [message, setMessage] = useState('')
  const [selectedRow, setSelectedRow] = useState<DataRow | null>(null)
  const [draft, setDraft] = useState<Record<string, string>>({})
  const [pendingAction, setPendingAction] = useState<PendingAction | null>(null)
  const [confirmationText, setConfirmationText] = useState('')
  const [saving, setSaving] = useState(false)
  const [r2Objects, setR2Objects] = useState<R2Object[]>([])
  const [r2Cursor, setR2Cursor] = useState('')
  const [r2NextCursor, setR2NextCursor] = useState<string | null>(null)
  const [r2History, setR2History] = useState<string[]>([])
  const [r2Stats, setR2Stats] = useState({ configured: false, online: false, objects: 0, bytes: 0, bucket: '' })

  const selectedTable = useMemo(
    () => tables.find(table => table.name === selectedTableName) || null,
    [tables, selectedTableName]
  )
  const totalPages = Math.max(1, Math.ceil(count / 50))

  const getToken = async () => {
    const { data: { session } } = await supabase.auth.getSession()
    return session?.access_token || ''
  }

  const adminFetch = async (url: string, init: RequestInit = {}) => {
    const token = await getToken()
    if (!token) throw new Error('Sessione scaduta.')
    const response = await fetch(url, {
      ...init,
      cache: 'no-store',
      headers: {
        ...(init.body ? { 'Content-Type': 'application/json' } : {}),
        ...(init.headers || {}),
        Authorization: `Bearer ${token}`,
      },
    })
    const data = await response.json().catch(() => null)
    if (!response.ok || !data?.ok) throw new Error(data?.error || `Errore HTTP ${response.status}`)
    return data
  }

  const loadMetadata = async () => {
    setLoading(true)
    setMessage('')
    try {
      const data = await adminFetch('/api/admin/database?source=metadata')
      const nextTables = Array.isArray(data.tables) ? data.tables as TableMeta[] : []
      setTables(nextTables)
      if (!nextTables.some(table => table.name === selectedTableName)) {
        setSelectedTableName(nextTables.find(table => table.name === 'card_catalog')?.name || nextTables[0]?.name || '')
      }
      setR2Stats({
        configured: Boolean(data.r2?.configured),
        online: Boolean(data.r2?.online),
        objects: Number(data.r2?.objects || 0),
        bytes: Number(data.r2?.bytes || 0),
        bucket: String(data.r2?.bucket || ''),
      })
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Metadati non disponibili.')
    } finally {
      setLoading(false)
    }
  }

  const loadRows = async () => {
    if (!selectedTableName) return
    setLoading(true)
    setMessage('')
    try {
      const params = new URLSearchParams({ source: 'supabase', table: selectedTableName, page: String(page), limit: '50' })
      if (appliedSearch) params.set('q', appliedSearch)
      const data = await adminFetch(`/api/admin/database?${params}`)
      setRows(Array.isArray(data.rows) ? data.rows : [])
      setCount(Number(data.count || 0))
    } catch (error) {
      setRows([])
      setMessage(error instanceof Error ? error.message : 'Dati non disponibili.')
    } finally {
      setLoading(false)
    }
  }

  const loadR2 = async () => {
    setLoading(true)
    setMessage('')
    try {
      const params = new URLSearchParams({ source: 'r2' })
      if (appliedSearch) params.set('q', appliedSearch)
      if (r2Cursor) params.set('cursor', r2Cursor)
      const data = await adminFetch(`/api/admin/database?${params}`)
      setR2Objects(Array.isArray(data.objects) ? data.objects : [])
      setR2NextCursor(data.nextToken || null)
    } catch (error) {
      setR2Objects([])
      setMessage(error instanceof Error ? error.message : 'File R2 non disponibili.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { void loadMetadata() }, [])
  useEffect(() => {
    if (source === 'supabase' && selectedTableName && tables.length) void loadRows()
  }, [source, selectedTableName, page, appliedSearch, tables.length])
  useEffect(() => {
    if (source === 'r2') void loadR2()
  }, [source, appliedSearch, r2Cursor])

  const submitSearch = (event: FormEvent) => {
    event.preventDefault()
    setPage(1)
    setR2Cursor('')
    setR2History([])
    setAppliedSearch(search.trim())
  }

  const openEditor = (row: DataRow) => {
    setSelectedRow(row)
    setDraft(Object.fromEntries(Object.entries(row).map(([key, value]) => [key, editorValue(value)])))
    setMessage('')
  }

  const collectChanges = () => {
    if (!selectedRow || !selectedTable) return {}
    const changes: Record<string, unknown> = {}
    for (const column of selectedTable.columns) {
      if (column.primaryKey || !(column.name in draft)) continue
      const nextValue = parseEditorValue(draft[column.name], column)
      if (JSON.stringify(nextValue) !== JSON.stringify(selectedRow[column.name])) changes[column.name] = nextValue
    }
    return changes
  }

  const askSave = () => {
    try {
      const changes = collectChanges()
      if (!Object.keys(changes).length) {
        setMessage('Non hai modificato nessun campo.')
        return
      }
      setPendingAction({ kind: 'save', changes })
      setConfirmationText('')
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Controlla i valori inseriti.')
    }
  }

  const primaryKeyFor = (row: DataRow) => Object.fromEntries(
    (selectedTable?.primaryKeys || []).map(key => [key, row[key]])
  )

  const confirmAction = async () => {
    if (!pendingAction) return
    setSaving(true)
    setMessage('')
    try {
      if (pendingAction.kind === 'save' && selectedRow && selectedTable) {
        const data = await adminFetch('/api/admin/database', {
          method: 'PATCH',
          body: JSON.stringify({
            table: selectedTable.name,
            primaryKey: primaryKeyFor(selectedRow),
            changes: pendingAction.changes,
            confirmation: 'SALVA',
          }),
        })
        setSelectedRow(data.row)
        setDraft(Object.fromEntries(Object.entries(data.row as DataRow).map(([key, value]) => [key, editorValue(value)])))
        setMessage(`Modifica salvata in ${selectedTable.name}.`)
        await loadRows()
      } else if (pendingAction.kind === 'delete-row' && selectedRow && selectedTable) {
        await adminFetch('/api/admin/database', {
          method: 'DELETE',
          body: JSON.stringify({ table: selectedTable.name, primaryKey: primaryKeyFor(selectedRow), confirmation: selectedTable.name }),
        })
        setSelectedRow(null)
        setMessage(`Riga eliminata da ${selectedTable.name}.`)
        await loadRows()
      } else if (pendingAction.kind === 'delete-r2') {
        await adminFetch('/api/admin/database', {
          method: 'DELETE',
          body: JSON.stringify({ source: 'r2', key: pendingAction.object.key, confirmation: pendingAction.object.key }),
        })
        setMessage(`File eliminato: ${pendingAction.object.key}`)
        await Promise.all([loadR2(), loadMetadata()])
      }
      setPendingAction(null)
      setConfirmationText('')
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Operazione non riuscita.')
    } finally {
      setSaving(false)
    }
  }

  const deleteConfirmationTarget = pendingAction?.kind === 'delete-row'
    ? selectedTable?.name || ''
    : pendingAction?.kind === 'delete-r2' ? pendingAction.object.key : ''
  const canConfirm = pendingAction?.kind === 'save' || confirmationText === deleteConfirmationTarget

  return (
    <div className="mt-6 space-y-4">
      <div className="flex flex-col gap-3 border-b border-white/10 pb-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-xl font-black text-white">Esplora e modifica i dati</h2>
          <p className="mt-1 text-sm text-slate-400">Le modifiche passano dal server e richiedono sempre una conferma separata.</p>
        </div>
        <button type="button" onClick={() => void loadMetadata()} className="inline-flex h-10 items-center justify-center gap-2 rounded-2xl border border-white/10 bg-white/[0.05] px-3 text-xs font-black text-slate-200 transition active:scale-95">
          <RotateCcw size={15} /> Aggiorna schema
        </button>
      </div>

      <div className="grid grid-cols-2 gap-2 rounded-2xl border border-white/10 bg-slate-950/55 p-1">
        <button type="button" onClick={() => setSource('supabase')} className={`flex items-center justify-center gap-2 rounded-xl px-3 py-2.5 text-sm font-black transition ${source === 'supabase' ? 'bg-cyan-300 text-slate-950' : 'text-slate-400'}`}>
          <Database size={17} /> Supabase
        </button>
        <button type="button" onClick={() => setSource('r2')} className={`flex items-center justify-center gap-2 rounded-xl px-3 py-2.5 text-sm font-black transition ${source === 'r2' ? 'bg-cyan-300 text-slate-950' : 'text-slate-400'}`}>
          <HardDrive size={17} /> Cloudflare R2
        </button>
      </div>

      <form onSubmit={submitSearch} className="flex gap-2">
        <label className="relative min-w-0 flex-1">
          <Search size={17} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
          <input value={search} onChange={event => setSearch(event.target.value)} placeholder={source === 'supabase' ? 'Cerca nella sezione selezionata' : 'Cerca per percorso, es. cards/st06'} className="h-11 w-full rounded-2xl border border-slate-700 bg-slate-950/75 pl-10 pr-3 text-base text-white outline-none transition focus:border-cyan-300" />
        </label>
        <button type="submit" className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-cyan-300 text-slate-950 transition active:scale-90" aria-label="Cerca"><Search size={18} /></button>
      </form>

      {message ? <div className="rounded-2xl border border-cyan-200/20 bg-cyan-300/[0.07] px-4 py-3 text-sm font-bold text-cyan-50">{message}</div> : null}

      {source === 'supabase' ? (
        <div className="grid gap-4 lg:grid-cols-[260px_minmax(0,1fr)]">
          <aside className="lg:max-h-[70vh] lg:overflow-y-auto lg:pr-1">
            <label className="block text-[10px] font-black uppercase tracking-[0.18em] text-slate-500">Tabella Supabase</label>
            <select value={selectedTableName} onChange={event => { setSelectedTableName(event.target.value); setPage(1); setAppliedSearch(''); setSearch('') }} className="mt-2 h-11 w-full rounded-2xl border border-slate-700 bg-slate-950 px-3 text-sm font-bold text-white outline-none lg:hidden">
              {tables.map(table => <option key={table.name} value={table.name}>{table.name}</option>)}
            </select>
            <div className="mt-2 hidden space-y-1 lg:block">
              {tables.map(table => (
                <button key={table.name} type="button" onClick={() => { setSelectedTableName(table.name); setPage(1); setAppliedSearch(''); setSearch('') }} className={`flex w-full items-center justify-between rounded-xl px-3 py-2.5 text-left text-xs font-bold transition ${selectedTableName === table.name ? 'bg-cyan-300 text-slate-950' : 'text-slate-400 hover:bg-white/[0.05] hover:text-white'}`}>
                  <span className="truncate">{table.name}</span><ChevronRight size={14} />
                </button>
              ))}
            </div>
          </aside>

          <section className="min-w-0">
            <div className="flex flex-wrap items-center justify-between gap-2 pb-3">
              <div>
                <h3 className="font-black text-white">{selectedTableName}</h3>
                <p className="text-xs text-slate-500">{count.toLocaleString('it-IT')} righe{selectedTable?.virtual ? ' · sola lettura' : ''}</p>
              </div>
              <div className="flex items-center gap-1 text-[10px] font-bold text-slate-500">
                {selectedTable?.primaryKeys.length ? `Chiave: ${selectedTable.primaryKeys.join(' + ')}` : 'Nessuna chiave primaria'}
              </div>
            </div>

            <div className="space-y-2">
              {loading ? <p className="rounded-2xl border border-dashed border-slate-700 p-6 text-center text-sm text-slate-400">Caricamento dati...</p> : rows.length === 0 ? <p className="rounded-2xl border border-dashed border-slate-700 p-6 text-center text-sm text-slate-400">Nessuna riga trovata.</p> : rows.map((row, index) => {
                const rowKey = selectedTable?.primaryKeys.map(key => displayValue(row[key])).join(' · ') || String(index)
                const previewKeys = Object.keys(row).filter(key => !selectedTable?.primaryKeys.includes(key) && !['raw_data', 'subscription', 'pages', 'cards'].includes(key)).slice(0, 4)
                return (
                  <button key={`${rowKey}-${index}`} type="button" onClick={() => openEditor(row)} className="group flex w-full items-center gap-3 rounded-2xl border border-white/8 bg-slate-900/72 px-3 py-3 text-left transition hover:border-cyan-300/25 hover:bg-slate-900 active:scale-[0.99]">
                    <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-cyan-300/10 text-cyan-100"><Database size={17} /></span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-black text-white">{rowTitle(row)}</span>
                      <span className="mt-0.5 block truncate text-[10px] text-slate-500">{rowKey}</span>
                      <span className="mt-1 block truncate text-xs text-slate-400">{previewKeys.map(key => `${key}: ${displayValue(row[key])}`).join(' · ')}</span>
                    </span>
                    <Pencil size={16} className="shrink-0 text-slate-600 group-hover:text-cyan-100" />
                  </button>
                )
              })}
            </div>

            <div className="mt-4 flex items-center justify-center gap-3">
              <button type="button" disabled={page <= 1 || loading} onClick={() => setPage(current => Math.max(1, current - 1))} className="grid h-10 w-10 place-items-center rounded-2xl border border-white/10 bg-white/[0.05] text-slate-200 disabled:opacity-30"><ChevronLeft size={17} /></button>
              <span className="min-w-24 text-center text-xs font-black text-slate-300">{page} / {totalPages}</span>
              <button type="button" disabled={page >= totalPages || loading} onClick={() => setPage(current => current + 1)} className="grid h-10 w-10 place-items-center rounded-2xl border border-white/10 bg-white/[0.05] text-slate-200 disabled:opacity-30"><ChevronRight size={17} /></button>
            </div>
          </section>
        </div>
      ) : (
        <section>
          <div className="flex flex-wrap items-end justify-between gap-3 border-b border-white/10 pb-3">
            <div>
              <h3 className="font-black text-white">{r2Stats.bucket || 'Cloudflare R2'}</h3>
              <p className="mt-1 text-xs text-slate-500">{r2Stats.objects.toLocaleString('it-IT')} file · {formatBytes(r2Stats.bytes)} · {r2Stats.online ? 'Online' : 'Non disponibile'}</p>
            </div>
            <p className="text-[10px] font-bold text-slate-500">La ricerca usa l’inizio del percorso del file.</p>
          </div>
          <div className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {loading ? <p className="col-span-full rounded-2xl border border-dashed border-slate-700 p-6 text-center text-sm text-slate-400">Caricamento file...</p> : r2Objects.length === 0 ? <p className="col-span-full rounded-2xl border border-dashed border-slate-700 p-6 text-center text-sm text-slate-400">Nessun file trovato.</p> : r2Objects.map(object => (
              <article key={object.key} className="overflow-hidden rounded-2xl border border-white/10 bg-slate-900/75">
                <div className="grid aspect-[16/9] place-items-center overflow-hidden bg-slate-950/80">
                  {object.publicUrl && /\.(webp|png|jpe?g|gif)$/i.test(object.key) ? <img src={object.publicUrl} alt="" loading="lazy" className="h-full w-full object-contain" /> : <ImageIcon size={28} className="text-slate-600" />}
                </div>
                <div className="p-3">
                  <p className="break-all text-xs font-black leading-5 text-white">{object.key}</p>
                  <p className="mt-1 text-[10px] text-slate-500">{formatBytes(object.bytes)}{object.updatedAt ? ` · ${new Date(object.updatedAt).toLocaleString('it-IT')}` : ''}</p>
                  <div className="mt-3 flex gap-2">
                    {object.publicUrl ? <a href={object.publicUrl} target="_blank" rel="noreferrer" className="inline-flex h-9 flex-1 items-center justify-center gap-2 rounded-xl border border-white/10 bg-white/[0.05] text-xs font-black text-slate-200"><ExternalLink size={14} /> Apri</a> : null}
                    <button type="button" onClick={() => { setPendingAction({ kind: 'delete-r2', object }); setConfirmationText('') }} className="grid h-9 w-9 place-items-center rounded-xl border border-rose-300/20 bg-rose-400/10 text-rose-100" aria-label={`Elimina ${object.key}`}><Trash2 size={14} /></button>
                  </div>
                </div>
              </article>
            ))}
          </div>
          <div className="mt-4 flex items-center justify-center gap-3">
            <button type="button" disabled={!r2History.length || loading} onClick={() => { const history = [...r2History]; const previous = history.pop() || ''; setR2History(history); setR2Cursor(previous) }} className="inline-flex h-10 items-center gap-2 rounded-2xl border border-white/10 bg-white/[0.05] px-3 text-xs font-black text-slate-200 disabled:opacity-30"><ChevronLeft size={16} /> Indietro</button>
            <button type="button" disabled={!r2NextCursor || loading} onClick={() => { setR2History(current => [...current, r2Cursor]); setR2Cursor(r2NextCursor || '') }} className="inline-flex h-10 items-center gap-2 rounded-2xl border border-white/10 bg-white/[0.05] px-3 text-xs font-black text-slate-200 disabled:opacity-30">Avanti <ChevronRight size={16} /></button>
          </div>
        </section>
      )}

      {selectedRow && selectedTable ? (
        <div className="fixed inset-0 z-[90] flex items-end justify-center bg-black/70 p-2 backdrop-blur-md sm:items-center sm:p-4" onClick={event => { if (event.target === event.currentTarget && !saving) setSelectedRow(null) }}>
          <section className="flex max-h-[92vh] w-full max-w-3xl flex-col overflow-hidden rounded-3xl border border-white/12 bg-[#102e37] shadow-2xl">
            <header className="flex items-center justify-between border-b border-white/10 px-4 py-3 sm:px-5">
              <div className="min-w-0"><h3 className="truncate font-black text-white">{rowTitle(selectedRow)}</h3><p className="truncate text-[10px] text-slate-500">{selectedTable.name}</p></div>
              <button type="button" onClick={() => setSelectedRow(null)} className="grid h-9 w-9 place-items-center rounded-full border border-white/10 bg-white/[0.05] text-slate-200"><X size={17} /></button>
            </header>
            <div className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-5">
              {selectedTable.virtual ? <div className="mb-4 rounded-2xl border border-amber-200/20 bg-amber-300/[0.07] px-3 py-2 text-xs font-bold text-amber-100">I dati di autenticazione sono protetti e disponibili in sola lettura.</div> : null}
              <div className="grid gap-3 sm:grid-cols-2">
                {(selectedTable.columns.length ? selectedTable.columns : Object.keys(selectedRow).map(name => ({ name, type: 'string', format: '', required: false, primaryKey: name === 'id' }))).map(column => {
                  const value = draft[column.name] ?? editorValue(selectedRow[column.name])
                  const readOnly = selectedTable.virtual || column.primaryKey
                  const longField = value.length > 100 || ['jsonb', 'json'].includes(column.format) || column.type === 'object' || column.type === 'array'
                  return (
                    <label key={column.name} className={longField ? 'sm:col-span-2' : ''}>
                      <span className="mb-1.5 flex items-center gap-2 text-[10px] font-black uppercase tracking-[0.14em] text-slate-500"><span>{column.name}</span>{column.primaryKey ? <span className="rounded bg-amber-300/10 px-1.5 py-0.5 text-amber-100">PK</span> : null}<span className="ml-auto normal-case tracking-normal text-slate-600">{column.format || column.type}</span></span>
                      {longField ? <textarea value={value} onChange={event => setDraft(current => ({ ...current, [column.name]: event.target.value }))} readOnly={readOnly} rows={Math.min(12, Math.max(4, value.split('\n').length))} className="w-full resize-y rounded-xl border border-slate-700 bg-slate-950/75 px-3 py-2 font-mono text-xs leading-5 text-white outline-none focus:border-cyan-300 read-only:cursor-not-allowed read-only:text-slate-500" /> : column.type === 'boolean' && !readOnly ? <select value={value} onChange={event => setDraft(current => ({ ...current, [column.name]: event.target.value }))} className="h-10 w-full rounded-xl border border-slate-700 bg-slate-950/75 px-3 text-sm text-white outline-none focus:border-cyan-300"><option value="true">true</option><option value="false">false</option><option value="null">null</option></select> : <input value={value} onChange={event => setDraft(current => ({ ...current, [column.name]: event.target.value }))} readOnly={readOnly} className="h-10 w-full rounded-xl border border-slate-700 bg-slate-950/75 px-3 text-sm text-white outline-none focus:border-cyan-300 read-only:cursor-not-allowed read-only:text-slate-500" />}
                    </label>
                  )
                })}
              </div>
              <p className="mt-3 text-[10px] text-slate-500">Scrivi <span className="font-mono text-slate-300">null</span> per svuotare un campo. Le chiavi primarie non possono essere modificate.</p>
            </div>
            {!selectedTable.virtual ? <footer className="flex items-center justify-between gap-2 border-t border-white/10 p-3 sm:px-5">
              <button type="button" disabled={!selectedTable.canDelete || !selectedTable.primaryKeys.length || saving} onClick={() => { setPendingAction({ kind: 'delete-row' }); setConfirmationText('') }} className="inline-flex h-10 items-center gap-2 rounded-xl border border-rose-300/20 bg-rose-400/10 px-3 text-xs font-black text-rose-100 disabled:opacity-30"><Trash2 size={15} /> Elimina</button>
              <button type="button" disabled={!selectedTable.canUpdate || !selectedTable.primaryKeys.length || saving} onClick={askSave} className="inline-flex h-10 items-center gap-2 rounded-xl bg-cyan-300 px-4 text-xs font-black text-slate-950 disabled:opacity-30"><Save size={15} /> Controlla e salva</button>
            </footer> : null}
          </section>
        </div>
      ) : null}

      {pendingAction ? (
        <div className="fixed inset-0 z-[110] grid place-items-center bg-black/75 p-3 backdrop-blur-md">
          <section className="w-full max-w-md rounded-3xl border border-amber-200/20 bg-slate-950 p-5 shadow-2xl">
            <div className="flex items-start gap-3"><span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-amber-300/10 text-amber-100"><ShieldAlert size={21} /></span><div><h3 className="text-lg font-black text-white">{pendingAction.kind === 'save' ? 'Conferma salvataggio' : 'Conferma eliminazione'}</h3><p className="mt-1 text-sm leading-6 text-slate-400">{pendingAction.kind === 'save' ? `Stai modificando ${Object.keys(pendingAction.changes).length} campi in ${selectedTable?.name}. Controlla prima di confermare.` : 'Questa operazione è definitiva e potrebbe influire su altre parti del sito.'}</p></div></div>
            {pendingAction.kind === 'save' ? <div className="mt-4 max-h-48 space-y-2 overflow-y-auto rounded-2xl border border-white/10 bg-white/[0.035] p-3">{Object.entries(pendingAction.changes).map(([key, value]) => <div key={key} className="text-xs"><span className="font-black text-cyan-100">{key}</span><span className="mt-0.5 block break-all font-mono text-slate-400">{displayValue(value)}</span></div>)}</div> : <label className="mt-4 block"><span className="text-xs font-bold text-slate-400">Scrivi <span className="break-all font-mono text-rose-200">{deleteConfirmationTarget}</span> per confermare</span><input value={confirmationText} onChange={event => setConfirmationText(event.target.value)} className="mt-2 h-11 w-full rounded-xl border border-rose-300/25 bg-slate-900 px-3 font-mono text-sm text-white outline-none focus:border-rose-300" /></label>}
            <div className="mt-5 grid grid-cols-2 gap-2"><button type="button" disabled={saving} onClick={() => { setPendingAction(null); setConfirmationText('') }} className="h-11 rounded-xl border border-white/10 bg-white/[0.05] text-sm font-black text-slate-200">Annulla</button><button type="button" disabled={!canConfirm || saving} onClick={() => void confirmAction()} className={`h-11 rounded-xl text-sm font-black text-slate-950 disabled:opacity-30 ${pendingAction.kind === 'save' ? 'bg-cyan-300' : 'bg-rose-300'}`}>{saving ? 'Attendi...' : pendingAction.kind === 'save' ? 'Conferma e salva' : 'Elimina definitivamente'}</button></div>
          </section>
        </div>
      ) : null}
    </div>
  )
}
