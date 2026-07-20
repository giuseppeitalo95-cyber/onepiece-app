'use client'

import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useRouter } from 'next/navigation'
import { Camera, UploadCloud } from 'lucide-react'
import Sidebar from '@/app/components/Sidebar'
import Topbar from '@/app/components/Topbar'
import PushNotificationPrompt from '@/app/components/PushNotificationPrompt'
import BinderGallery from '@/app/components/BinderGallery'
import { normalizeBinder, type BinderRecord } from '@/lib/binders'
import { getPremiumTier, premiumClassName, premiumLabel, type PremiumProfile, type PremiumTier } from '@/lib/premium'

type ProfileData = PremiumProfile & {
  username?: string | null
  avatar_url?: string | null
}

const getAvatarPublicUrl = (avatarPath: string | null) => {
  if (!avatarPath) return ''
  if (avatarPath.startsWith('http')) return avatarPath
  return supabase.storage.from('avatars').getPublicUrl(avatarPath).data?.publicUrl ?? ''
}

export default function Profile() {
  const router = useRouter()

  const [email, setEmail] = useState('')
  const [username, setUsername] = useState('')
  const [canEdit, setCanEdit] = useState(false)
  const [firstAccess, setFirstAccess] = useState(false)
  const [userId, setUserId] = useState<string | null>(null)
  const [avatarUrl, setAvatarUrl] = useState('')
  const [avatarFile, setAvatarFile] = useState<File | null>(null)
  const [uploadStatus, setUploadStatus] = useState('')
  const [savingAvatar, setSavingAvatar] = useState(false)
  const [savingUsername, setSavingUsername] = useState(false)
  const [premiumTier, setPremiumTier] = useState<PremiumTier>('free')
  const [nicknameCredits, setNicknameCredits] = useState(0)
  const [nextNicknameChange, setNextNicknameChange] = useState<string | null>(null)
  const [profileBinders, setProfileBinders] = useState<BinderRecord[]>([])

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

      const { data, error } = await supabase
        .from('profiles')
        .select('username, avatar_url, is_premium, premium_until, is_vip, vip_note')
        .eq('id', user.id)
        .single()
      let profileData = data as ProfileData | null

      if (error) {
        const fallback = await supabase
          .from('profiles')
          .select('username, avatar_url')
          .eq('id', user.id)
          .single()
        profileData = fallback.data as ProfileData | null
      }

      const { data: binderData } = await supabase
        .from('binders')
        .select('*')
        .eq('user_id', user.id)
        .order('updated_at', { ascending: false })

      const rawAvatarUrl = profileData?.avatar_url ?? ''
      const resolvedAvatarUrl = getAvatarPublicUrl(rawAvatarUrl)
      const isFirstAccess = !profileData?.username
      const nicknameResponse = await fetch('/api/profile/nickname', {
        headers: { Authorization: `Bearer ${session.access_token}` },
      }).catch(() => null)
      const nicknameStatus = await nicknameResponse?.json().catch(() => null)
      const nicknameCanBeChanged = isFirstAccess || Boolean(nicknameStatus?.canChange)

      const tier = getPremiumTier(profileData as PremiumProfile, user)

      setUsername(profileData?.username ?? '')
      setAvatarUrl(resolvedAvatarUrl)
      setCanEdit(nicknameCanBeChanged)
      setNicknameCredits(Number(nicknameStatus?.credits || 0))
      setNextNicknameChange(nicknameStatus?.nextChangeAt || null)
      setFirstAccess(isFirstAccess)
      setPremiumTier(tier)
      setProfileBinders((binderData || []).map(normalizeBinder))

    }

    load()
  }, [router])

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
    const { data: { session } } = await supabase.auth.getSession()
    const response = await fetch('/api/profile/nickname', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
      },
      body: JSON.stringify({ nickname: username }),
    })
    const result = await response.json().catch(() => null)

    if (!response.ok || !result?.ok) {
      alert(result?.error || 'Errore salvataggio')
      setSavingUsername(false)
      return
    }

    setCanEdit(false)
    setNicknameCredits(Math.max(0, nicknameCredits - 1))
    setNextNicknameChange(new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString())
    setFirstAccess(false)
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
    const { data: { session } } = await supabase.auth.getSession()
    try {
      const registration = await navigator.serviceWorker?.getRegistration('/opv-sw.js')
      const subscription = await registration?.pushManager.getSubscription()
      if (session?.access_token && subscription?.endpoint) {
        await fetch('/api/push/subscribe', {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
          body: JSON.stringify({ endpoint: subscription.endpoint }),
        })
      }
      await subscription?.unsubscribe()
      window.localStorage.removeItem('opv_push_registered')
      window.localStorage.removeItem('opv_push_vapid_key')
    } catch {
      // La disconnessione dell'account deve comunque proseguire.
    }
    await supabase.auth.signOut({ scope: 'global' })
    router.replace('/')
  }

  const avatarInitials = username
    .split(' ')
    .map((word) => word.charAt(0).toUpperCase())
    .slice(0, 2)
    .join('') || 'OP'

  return (
    <div className={`min-h-screen pb-32 text-white onepiece-wave-bg onepiece-clouds sm:pb-36 ${firstAccess ? 'pt-4' : 'pt-14'}`}>
      {!firstAccess && <Sidebar activePage="profilo" />}
      {!firstAccess && <Topbar />}
      {firstAccess ? (
        <div className="mx-3 mt-0 rounded-[1.5rem] border border-white/10 bg-slate-900/72 p-4 backdrop-blur-xl">
          <h1 className="text-2xl font-extrabold text-white">Configura il profilo</h1>
        </div>
      ) : null}

      <main className="mx-auto max-w-6xl px-3 py-4 sm:px-6 sm:py-7 lg:px-8">
        <div className="relative overflow-hidden rounded-[1.75rem] border border-white/10 bg-slate-900/74 px-4 pb-5 pt-28 shadow-2xl shadow-slate-950/30 backdrop-blur-xl sm:rounded-[2rem] sm:px-7 sm:pb-7 sm:pt-32">
          <div className="absolute inset-x-0 top-0 h-36 bg-[radial-gradient(circle_at_50%_0%,rgba(110,231,249,0.22),transparent_58%),linear-gradient(180deg,rgba(251,113,133,0.08),transparent)]" />
          <div className="absolute inset-x-0 top-0 flex justify-center">
            <div className="relative mt-6">
              <div className="h-28 w-28 rounded-full bg-gradient-to-br from-cyan-300/35 via-rose-300/20 to-sky-400/20 p-1 shadow-[0_22px_56px_-32px_rgba(110,231,249,0.9)] sm:h-32 sm:w-32">
                <div className="h-full w-full overflow-hidden rounded-full border border-slate-700 bg-slate-950">
                  {avatarUrl ? (
                    <img
                      src={avatarUrl}
                      alt="Foto profilo"
                      className="h-full w-full object-cover object-center"
                    />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center bg-slate-900 text-3xl font-black text-cyan-200">
                      {avatarInitials}
                    </div>
                  )}
                </div>
              </div>
              <label className="absolute -bottom-3 left-1/2 flex -translate-x-1/2 cursor-pointer items-center gap-2 rounded-full border border-cyan-300/30 bg-slate-950/80 px-4 py-2 text-xs font-semibold uppercase tracking-[0.18em] text-cyan-100 shadow-lg shadow-black/40 backdrop-blur-sm transition hover:bg-slate-900/95">
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

          <div className="mt-10 text-center sm:mt-12">
            <div className="flex flex-wrap items-center justify-center gap-2">
              <h2 className={`text-3xl font-black text-white sm:text-4xl ${premiumClassName(premiumTier)}`}>{username || 'Utente'}</h2>
              {premiumTier !== 'free' ? (
                <span className="rounded-full border border-white/15 bg-white/[0.08] px-3 py-1 text-[10px] font-black uppercase text-cyan-100">
                  {premiumLabel(premiumTier)}
                </span>
              ) : null}
            </div>
            {firstAccess || canEdit ? (
              <p className="mx-auto mt-3 max-w-xl text-sm leading-6 text-slate-300">
                {firstAccess
                  ? 'Scegli il nickname che userai nell’app.'
                  : nicknameCredits > 0
                    ? `Hai ${nicknameCredits} modifica extra disponibile.`
                    : 'Il nickname può essere modificato una volta ogni 30 giorni.'}
              </p>
            ) : null}
          </div>

          <section className="mt-6 rounded-[1.5rem] border border-cyan-200/18 bg-white/[0.055] p-4 shadow-inner shadow-white/5 sm:p-5">
            {!firstAccess && (
              <div>
                <PushNotificationPrompt mode="profile" />
              </div>
            )}
            {!firstAccess && (
              <div className="mt-4 grid gap-2 sm:grid-cols-[1fr_auto] sm:items-center">
                <div className="rounded-2xl border border-white/10 bg-slate-950/40 px-3 py-2 text-xs font-bold text-slate-300">
                  Accesso attivo su questo account
                </div>
                <button
                  onClick={logout}
                  className="rounded-2xl border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm font-semibold text-red-200 transition hover:bg-red-500/20"
                >
                  Disconnetti Account
                </button>
              </div>
            )}
          </section>

          {!firstAccess ? (
            <div className="mt-6">
              <BinderGallery binders={profileBinders} title="I miei raccoglitori" emptyText="Non hai ancora creato raccoglitori." />
            </div>
          ) : null}

          <div className="mt-6 grid gap-4 lg:grid-cols-[1.45fr_0.85fr]">
            <section className="rounded-[1.5rem] border border-white/10 bg-slate-950/72 p-4 shadow-inner shadow-black/10 sm:p-5">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <h3 className="text-xl font-semibold text-white">Account</h3>
                </div>
              </div>

              <div className="mt-6 space-y-5">
                <div className="rounded-3xl border border-white/10 bg-white/[0.045] p-4">
                  <p className="text-xs uppercase tracking-[0.25em] text-slate-500">Email</p>
                  <p className="mt-2 text-sm text-slate-100 break-all">{email}</p>
                </div>

                <div className="rounded-3xl border border-white/10 bg-white/[0.045] p-4">
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
                        {savingUsername ? 'Salvataggio...' : 'Conferma nickname'}
                      </button>
                    ) : (
                      <span className="max-w-[220px] rounded-2xl bg-slate-800/80 px-3 py-2 text-right text-xs font-semibold text-slate-300">
                        {nextNicknameChange
                          ? `Modificabile dal ${new Date(nextNicknameChange).toLocaleDateString('it-IT')}`
                          : 'Modifica mensile non disponibile'}
                      </span>
                    )}
                  </div>
                </div>
              </div>

              <div className="mt-4 rounded-3xl border border-white/10 bg-white/[0.045] p-4">
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

            <aside className="hidden lg:block" />
          </div>

        </div>
      </main>
    </div>
  )
}
