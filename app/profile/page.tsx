'use client'

import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useRouter } from 'next/navigation'
import { ArrowLeft, Camera, UploadCloud, ShieldCheck } from 'lucide-react'

export default function Profile() {
  const router = useRouter()

  const [email, setEmail] = useState('')
  const [username, setUsername] = useState('')
  const [canEdit, setCanEdit] = useState(false)
  const [loading, setLoading] = useState(true)
  const [userId, setUserId] = useState<string | null>(null)
  const [avatarUrl, setAvatarUrl] = useState('')
  const [avatarFile, setAvatarFile] = useState<File | null>(null)
  const [uploadStatus, setUploadStatus] = useState('')
  const [savingAvatar, setSavingAvatar] = useState(false)
  const [savingUsername, setSavingUsername] = useState(false)

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

      const { data } = await supabase
        .from('profiles')
        .select('username, username_locked, avatar_url')
        .eq('id', user.id)
        .single()

      const rawAvatarUrl = data?.avatar_url ?? ''
      const resolvedAvatarUrl = await getAvatarPublicUrl(rawAvatarUrl)

      setUsername(data?.username ?? '')
      setAvatarUrl(resolvedAvatarUrl)
      setCanEdit(!data?.username_locked)
      setLoading(false)
    }

    load()
  }, [])

  const getAvatarPublicUrl = async (avatarPath: string | null) => {
    if (!avatarPath) return ''
    // If it's already a full URL, return it
    if (avatarPath.startsWith('http')) return avatarPath

    // If it's a relative path, get the public URL
    const { data: publicData } = supabase.storage
      .from('avatars')
      .getPublicUrl(avatarPath)

    return publicData?.publicUrl ?? ''
  }

  const resizeImageIfNeeded = async (file: File) => {
    const maxFileSize = 2 * 1024 * 1024 // 2MB
    const maxDimension = 800 // Reduced from 1200 for better compression

    if (file.size <= maxFileSize) return file

    try {
      const imageBitmap = await createImageBitmap(file)
      let width = imageBitmap.width
      let height = imageBitmap.height
      const ratio = Math.min(maxDimension / width, maxDimension / height, 1)
      width = Math.round(width * ratio)
      height = Math.round(height * ratio)

      const canvas = document.createElement('canvas')
      canvas.width = width
      canvas.height = height
      const ctx = canvas.getContext('2d')
      if (!ctx) return file
      ctx.drawImage(imageBitmap, 0, 0, width, height)

      // Try different quality levels to get under size limit
      let quality = 0.8
      let blob: Blob | null = null
      let attempts = 0
      const maxAttempts = 5

      while (attempts < maxAttempts) {
        blob = await new Promise<Blob | null>((resolve) =>
          canvas.toBlob((result) => resolve(result), file.type || 'image/jpeg', quality)
        )
        if (blob && blob.size <= maxFileSize) break
        quality -= 0.1
        attempts++
      }

      if (!blob) return file

      return new File([blob], file.name, { type: blob.type || 'image/jpeg' })
    } catch (error) {
      console.error('Avatar resize failed:', error)
      return file
    }
  }

  const saveUsername = async () => {
  if (!userId) return

  if (!username.trim()) {
    alert('Inserisci un username')
    return
  }

  setSavingUsername(true)

  const { error } = await supabase
    .from('profiles')
    .update({
      username: username.trim(),
      username_locked: true
    })
    .eq('id', userId)

  if (error) {
    console.error(error)
    alert('Errore salvataggio')
    setSavingUsername(false)
    return
  }

  setCanEdit(false)
  setSavingUsername(false)
}

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return
    setAvatarFile(file)
    setAvatarUrl(URL.createObjectURL(file))
    setUploadStatus('Anteprima pronta. Premi Salva foto per confermare.')
  }

  const saveAvatar = async () => {
    if (!userId || !avatarFile) return

    setSavingAvatar(true)
    setUploadStatus('Caricamento in corso...')

    try {
      const uploadFile = await resizeImageIfNeeded(avatarFile)
      console.log('File size after resize:', uploadFile.size)

      if (uploadFile.size > 2 * 1024 * 1024) {
        setUploadStatus('Immagine troppo grande anche dopo la compressione. Usa un file più piccolo.')
        setSavingAvatar(false)
        return
      }

      const extension = uploadFile.name.split('.').pop()?.toLowerCase() || 'jpg'
      const filePath = `profile-${userId}-${Date.now()}.${extension}`

      console.log('Uploading to path:', filePath)

      const { error: uploadError, data: uploadData } = await supabase.storage
        .from('avatars')
        .upload(filePath, uploadFile, {
          upsert: true,
          contentType: uploadFile.type || 'image/jpeg'
        })

      if (uploadError) {
        console.error('Upload error:', uploadError)
        setUploadStatus(`Caricamento fallito: ${uploadError.message}`)
        setSavingAvatar(false)
        return
      }

      console.log('Upload successful:', uploadData)

      const { data: publicData } = supabase.storage
        .from('avatars')
        .getPublicUrl(filePath)

      const publicUrl = publicData?.publicUrl
      if (!publicUrl) {
        console.error('No public URL generated')
        setUploadStatus('Impossibile ottenere l\'URL pubblico.')
        setSavingAvatar(false)
        return
      }

      console.log('Public URL:', publicUrl)

      const { error: updateError } = await supabase
        .from('profiles')
        .update({ avatar_url: publicUrl })
        .eq('id', userId)

      if (updateError) {
        console.error('Profile update error:', updateError)
        setUploadStatus('Errore durante il salvataggio del profilo.')
        setSavingAvatar(false)
        return
      }

      setAvatarUrl(publicUrl)
      setAvatarFile(null)
      setUploadStatus('Foto profilo aggiornata con successo!')
      setSavingAvatar(false)
    } catch (error) {
      console.error('Unexpected error during upload:', error)
      setUploadStatus('Errore imprevisto durante il caricamento.')
      setSavingAvatar(false)
    }
  }

  const logout = async () => {
    await supabase.auth.signOut()
    router.push('/')
  }

  const avatarInitials = username
    .split(' ')
    .map((word) => word.charAt(0).toUpperCase())
    .slice(0, 2)
    .join('') || 'OP'

  return (
    <div className="min-h-screen text-white onepiece-wave-bg onepiece-clouds">
      <div className="flex items-center gap-3 p-4 border-b border-teal-800/20 bg-slate-900/60 backdrop-blur-md">
        <button
          onClick={() => router.push('/dashboard')}
          className="p-2 rounded-2xl bg-slate-800/70 border border-teal-800/30 hover:scale-105 transition"
        >
          <ArrowLeft />
        </button>
        <div>
          <p className="text-xs uppercase tracking-[0.35em] text-amber-300/80">Area personale</p>
          <h1 className="text-2xl font-extrabold text-white">Profilo</h1>
        </div>
      </div>

      <main className="mx-auto max-w-6xl px-4 py-8 sm:px-6 lg:px-8">
        <div className="relative overflow-hidden rounded-[2rem] border border-teal-800/30 bg-slate-900/80 shadow-2xl shadow-slate-950/40 px-6 pb-8 pt-32 sm:px-10 sm:pt-36">
          <div className="absolute inset-x-0 top-0 h-40 bg-gradient-to-b from-amber-400/15 to-transparent" />
          <div className="absolute inset-x-0 top-0 flex justify-center">
            <div className="relative mt-6">
              <div className="h-40 w-40 rounded-full bg-gradient-to-br from-amber-400/30 via-fuchsia-500/20 to-sky-400/20 p-1 shadow-[0_25px_60px_-30px_rgba(250,204,21,0.8)]">
                <div className="h-full w-full overflow-hidden rounded-full border border-slate-700 bg-slate-950">
                  {avatarUrl ? (
                    <img
                      src={avatarUrl}
                      alt="Foto profilo"
                      className="h-full w-full object-cover object-center"
                    />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center bg-slate-900 text-3xl font-black text-amber-300">
                      {avatarInitials}
                    </div>
                  )}
                </div>
              </div>
              <label className="absolute -bottom-3 left-1/2 flex -translate-x-1/2 items-center gap-2 rounded-full border border-amber-300/30 bg-slate-950/80 px-4 py-2 text-xs font-semibold uppercase tracking-[0.18em] text-amber-200 shadow-lg shadow-black/40 backdrop-blur-sm transition hover:bg-slate-900/95 cursor-pointer">
                <Camera size={14} />
                Scegli immagine
                <input
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={handleFileChange}
                />
              </label>
            </div>
          </div>

          <div className="mt-16 text-center">
            <p className="text-sm uppercase tracking-[0.3em] text-amber-300/70">Benvenuto</p>
            <h2 className="mt-3 text-3xl font-extrabold text-white sm:text-4xl">{username || 'Utente'}.</h2>
            <p className="mx-auto mt-3 max-w-2xl text-sm leading-6 text-slate-300 sm:text-base">
              Qui puoi gestire il tuo account, modificare il nome e aggiornare la foto profilo. Tutto centralizzato in un design pulito.
            </p>
          </div>

          <div className="mt-10 grid gap-6 lg:grid-cols-[1.5fr_1fr]">
            <section className="rounded-[1.75rem] border border-slate-800/80 bg-slate-950/90 p-6 shadow-inner shadow-black/10">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-xs uppercase tracking-[0.3em] text-slate-500">Informazioni</p>
                  <h3 className="mt-2 text-xl font-semibold text-white">Dettagli account</h3>
                </div>
                <div className="rounded-2xl bg-amber-400/10 px-3 py-2 text-xs font-semibold text-amber-200">Live</div>
              </div>

              <div className="mt-6 space-y-5">
                <div className="rounded-3xl border border-slate-800/70 bg-slate-900/70 p-4">
                  <p className="text-xs uppercase tracking-[0.25em] text-slate-500">Email</p>
                  <p className="mt-2 text-sm text-slate-100 break-all">{email}</p>
                </div>

                <div className="rounded-3xl border border-slate-800/70 bg-slate-900/70 p-4">
                  <div className="flex items-center justify-between gap-4">
                    <div>
                      <p className="text-xs uppercase tracking-[0.25em] text-slate-500">Username</p>
                     {canEdit ? (
  <input
    type="text"
    value={username}
    onChange={(e) => setUsername(e.target.value)}
    placeholder="Inserisci username"
    className="mt-2 w-full rounded-xl bg-slate-800 px-3 py-2 text-sm text-white outline-none"
  />
) : (
  <p className="mt-2 text-sm text-slate-100">{username}</p>
)}
                    </div>
                    {canEdit ? (
                      <button
                        onClick={saveUsername}
                        className="inline-flex items-center gap-2 rounded-2xl bg-amber-400 px-4 py-2 text-sm font-semibold text-slate-950 transition hover:bg-amber-300"
                        disabled={savingUsername}
                      >
                        {savingUsername ? 'Salvataggio...' : 'Blocca nome'}
                      </button>
                    ) : (
                      <span className="rounded-full bg-emerald-500/15 px-3 py-2 text-xs uppercase tracking-[0.2em] text-emerald-200">
                        Nome bloccato
                      </span>
                    )}
                  </div>
                </div>
              </div>

              <div className="mt-7 rounded-3xl border border-slate-800/70 bg-slate-900/70 p-5">
                <p className="text-xs uppercase tracking-[0.25em] text-slate-500">Foto profilo</p>
                <p className="mt-2 text-sm leading-6 text-slate-300">
                  Seleziona una nuova immagine e premi Salva foto per aggiornare il profilo
                </p>

                <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center">
                  <button
                    onClick={saveAvatar}
                    disabled={!avatarFile || savingAvatar}
                    className="inline-flex items-center justify-center gap-2 rounded-2xl bg-amber-400 px-5 py-3 text-sm font-semibold text-slate-950 transition hover:bg-amber-300 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    <UploadCloud size={16} />
                    {savingAvatar ? 'Attendi...' : 'Salva foto'}
                  </button>
                  <span className="text-sm text-slate-400">{uploadStatus || 'Nessun aggiornamento in corso.'}</span>
                </div>
              </div>
            </section>

            <aside className="space-y-6 rounded-[1.75rem] border border-slate-800/80 bg-slate-950/90 p-6">
              <div className="rounded-3xl border border-slate-800/70 bg-slate-900/70 p-4">
                <p className="text-xs uppercase tracking-[0.25em] text-slate-500">Consigli</p>
                <ul className="mt-4 space-y-3 text-sm text-slate-300">
                  <li className="flex items-start gap-3">
                    <span className="mt-1 inline-flex h-6 w-6 items-center justify-center rounded-full bg-amber-500/20 text-amber-300"><ShieldCheck size={14} /></span>
                    Usa una foto chiara e ben ritagliata: l'immagine sarà al centro del profilo.
                  </li>
                  <li>Il file può essere in formato PNG o JPG.</li>
                </ul>
              </div>

              <div className="rounded-3xl border border-slate-800/70 bg-slate-900/70 p-4">
                <p className="text-xs uppercase tracking-[0.25em] text-slate-500">Azioni rapide</p>
                <button
                  onClick={logout}
                  className="mt-4 w-full rounded-2xl border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm font-semibold text-red-200 transition hover:bg-red-500/20"
                >
                  Disconnettiti
                </button>
              </div>
            </aside>
          </div>
        </div>
      </main>
    </div>
  )
}
