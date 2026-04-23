'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { ArrowLeft, Users, UserPlus, Check, X, Eye, Search, Heart } from 'lucide-react'

type ProfileItem = {
  id: string
  username: string | null
  avatar_url: string | null
}

type UserCard = {
  card_id: string
  name: string | null
  image_url: string | null
  rarity: string | null
  quantity: number
}

type FriendRequest = {
  id: string
  requester_id: string
  receiver_id: string
  status: string
  created_at: string
}

export default function FriendsPage() {
  const router = useRouter()
  const [userId, setUserId] = useState<string | null>(null)
  const [username, setUsername] = useState('')
  const [loading, setLoading] = useState(true)
  const [allProfiles, setAllProfiles] = useState<ProfileItem[]>([])
  const [requests, setRequests] = useState<FriendRequest[]>([])
  const [selectedProfile, setSelectedProfile] = useState<ProfileItem | null>(null)
  const [selectedCards, setSelectedCards] = useState<UserCard[]>([])
  const [searchTerm, setSearchTerm] = useState('')
  const [actionMessage, setActionMessage] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    const load = async () => {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session?.user) {
        router.push('/')
        return
      }

      const user = session.user
      setUserId(user.id)

      const [{ data: profileData }, { data: profileListData }, { data: requestData }] = await Promise.all([
        supabase
          .from('profiles')
          .select('username')
          .eq('id', user.id)
          .single(),
        supabase
          .from('profiles')
          .select('id, username, avatar_url')
          .neq('id', user.id),
        supabase
          .from('friend_requests')
          .select('id, requester_id, receiver_id, status, created_at')
          .or(`requester_id.eq.${user.id},receiver_id.eq.${user.id}`)
          .order('created_at', { ascending: false })
      ])

      setUsername(profileData?.username ?? '')
      setRequests(requestData ?? [])

      const profiles = profileListData ?? []
      const resolvedProfiles = await Promise.all(
        profiles.map(async (profile: ProfileItem) => {
          const resolved = await getAvatarPublicUrl(profile.avatar_url)
          return { ...profile, avatar_url: resolved }
        })
      )

      setAllProfiles(resolvedProfiles)
      setLoading(false)
    }

    load()
  }, [router])

  const getAvatarPublicUrl = async (avatarPath: string | null) => {
    if (!avatarPath) return ''
    if (avatarPath.startsWith('http')) return avatarPath

    const { data: publicData } = supabase.storage
      .from('avatars')
      .getPublicUrl(avatarPath)

    return publicData?.publicUrl ?? ''
  }

  const resolvedRequests = useMemo(() => {
    const map = new Map<string, string>()
    requests.forEach((request) => {
      if (request.status === 'accepted') {
        const other = request.requester_id === userId ? request.receiver_id : request.requester_id
        map.set(other, 'friend')
      } else if (request.status === 'pending') {
        const other = request.requester_id === userId ? request.receiver_id : request.requester_id
        map.set(other, request.requester_id === userId ? 'sent' : 'incoming')
      }
    })
    return map
  }, [requests, userId])

  const friendIds = useMemo(() => {
    return requests
      .filter((request) => request.status === 'accepted')
      .map((request) => (request.requester_id === userId ? request.receiver_id : request.requester_id))
  }, [requests, userId])

  const incomingRequests = requests.filter(
    (request) => request.status === 'pending' && request.receiver_id === userId
  )

  const outgoingRequests = requests.filter(
    (request) => request.status === 'pending' && request.requester_id === userId
  )

  const friendProfiles = allProfiles.filter((profile) => friendIds.includes(profile.id))
  const peopleToShow = allProfiles.filter((profile) => {
    if (!searchTerm.trim()) return true
    return profile.username?.toLowerCase().includes(searchTerm.trim().toLowerCase())
  })

  const sendFriendRequest = async (profileId: string) => {
    if (!userId || busy) return
    setBusy(true)
    setActionMessage('Invio richiesta...')

    const existing = requests.find(
      (request) =>
        (request.requester_id === userId && request.receiver_id === profileId) ||
        (request.requester_id === profileId && request.receiver_id === userId)
    )

    if (existing) {
      setActionMessage('Hai già una richiesta in corso con questo giocatore.')
      setBusy(false)
      return
    }

    const { error } = await supabase
      .from('friend_requests')
      .insert([{ requester_id: userId, receiver_id: profileId, status: 'pending' }])

    if (error) {
      setActionMessage('Impossibile inviare la richiesta. Riprova.')
      setBusy(false)
      return
    }

    setActionMessage('Richiesta inviata! Aspetta la risposta.')
    await refreshRequests()
    setBusy(false)
  }

  const refreshRequests = async () => {
    if (!userId) return

    const { data: requestData } = await supabase
      .from('friend_requests')
      .select('id, requester_id, receiver_id, status, created_at')
      .or(`requester_id.eq.${userId},receiver_id.eq.${userId}`)
      .order('created_at', { ascending: false })

    setRequests(requestData ?? [])
  }

  const updateRequest = async (id: string, status: string) => {
    if (!userId || busy) return
    setBusy(true)
    setActionMessage('Aggiornamento in corso...')

    const { error } = await supabase
      .from('friend_requests')
      .update({ status })
      .eq('id', id)

    if (error) {
      setActionMessage('Errore durante l\'operazione. Riprova.')
      setBusy(false)
      return
    }

    setActionMessage(status === 'accepted' ? 'Hai accettato la richiesta!' : 'Richiesta rifiutata.')
    await refreshRequests()
    setBusy(false)
  }

  const openProfile = async (profile: ProfileItem) => {
    setSelectedProfile(profile)
    if (!friendIds.includes(profile.id)) {
      setSelectedCards([])
      return
    }

    const { data: cards } = await supabase
      .from('user_cards')
      .select('card_id, name, image_url, rarity, quantity')
      .eq('user_id', profile.id)

    setSelectedCards(cards ?? [])
  }

  const closeModal = () => {
    setSelectedProfile(null)
    setSelectedCards([])
  }

  const isFriend = selectedProfile ? friendIds.includes(selectedProfile.id) : false
  const selectedRequest = selectedProfile
    ? requests.find(
        (request) =>
          (request.requester_id === userId && request.receiver_id === selectedProfile.id) ||
          (request.requester_id === selectedProfile.id && request.receiver_id === userId)
      )
    : null

  return (
    <div className="min-h-screen bg-[#070A12] text-white">
      <div className="flex items-center gap-3 p-4 border-b border-teal-800/20 bg-slate-900/60 backdrop-blur-md">
        <button
          onClick={() => router.push('/dashboard')}
          className="p-2 rounded-2xl bg-slate-800/70 border border-teal-800/30 hover:scale-105 transition"
        >
          <ArrowLeft />
        </button>
        <div>
          <p className="text-xs uppercase tracking-[0.35em] text-amber-300/80">Area sociale</p>
          <h1 className="text-2xl font-extrabold text-white">Amici</h1>
        </div>
      </div>

      <main className="mx-auto max-w-6xl px-4 py-8 sm:px-6 lg:px-8">
        <div className="overflow-hidden rounded-[2rem] border border-teal-800/30 bg-slate-900/80 shadow-2xl shadow-slate-950/40 p-6 sm:p-8">
          <div className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
            <section className="space-y-5">
              <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
                <div>
                  <p className="text-xs uppercase tracking-[0.3em] text-amber-300/70">Il tuo mondo</p>
                  <h2 className="text-3xl font-extrabold text-white">Connetti con gli altri giocatori</h2>
                </div>
                <div className="rounded-3xl border border-slate-800/70 bg-slate-950/70 px-4 py-3 text-sm text-slate-300">
                  <span className="font-semibold text-amber-200">{username || 'Giocatore'}</span>
                  <span className="ml-2 text-slate-400">Puoi inviare richieste, gestire amicizie e aprire i profili.</span>
                </div>
              </div>

              <div className="rounded-[1.75rem] border border-slate-800/80 bg-slate-950/90 p-5">
                <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <p className="text-xs uppercase tracking-[0.25em] text-slate-500">Ricerca</p>
                    <p className="mt-2 text-sm text-slate-300">Trova altri giocatori e manda loro una richiesta di amicizia.</p>
                  </div>
                  <div className="relative flex-1 min-w-0">
                    <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
                    <input
                      value={searchTerm}
                      onChange={(event) => setSearchTerm(event.target.value)}
                      placeholder="Cerca per username"
                      className="w-full rounded-2xl border border-slate-700 bg-slate-900/90 px-10 py-3 text-sm text-white placeholder:text-slate-500 focus:border-amber-400 focus:outline-none focus:ring-2 focus:ring-amber-400/20"
                    />
                  </div>
                </div>
              </div>

              <div className="grid gap-4 lg:grid-cols-2">
                <div className="rounded-[1.75rem] border border-slate-800/80 bg-slate-950/90 p-5">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-xs uppercase tracking-[0.25em] text-slate-500">Amici</p>
                      <h3 className="mt-2 text-lg font-semibold text-white">La tua squadra</h3>
                    </div>
                    <div className="inline-flex items-center gap-2 rounded-full bg-amber-400/10 px-3 py-1 text-xs uppercase tracking-[0.2em] text-amber-200">
                      <Users size={14} />
                      {friendProfiles.length}
                    </div>
                  </div>

                  {loading ? (
                    <p className="mt-5 text-sm text-slate-400">Caricamento amici...</p>
                  ) : friendProfiles.length === 0 ? (
                    <div className="mt-5 rounded-3xl border border-dashed border-slate-700/70 bg-slate-900/80 p-5 text-sm text-slate-400">
                      Nessun amico ancora. Cerca un giocatore e manda una richiesta!
                    </div>
                  ) : (
                    <div className="mt-5 grid gap-3">
                      {friendProfiles.map((friend) => (
                        <button
                          key={friend.id}
                          onClick={() => openProfile(friend)}
                          className="group flex items-center gap-4 rounded-3xl border border-slate-800/70 bg-slate-900/80 p-4 text-left transition hover:border-amber-400/50"
                        >
                          <div className="flex h-14 w-14 items-center justify-center rounded-3xl bg-slate-800 text-2xl text-amber-300 overflow-hidden">
                            {friend.avatar_url ? (
                              <img src={friend.avatar_url} alt={friend.username || 'Avatar'} className="h-full w-full object-contain" />
                            ) : (
                              <span>{(friend.username || 'U').charAt(0).toUpperCase()}</span>
                            )}
                          </div>
                          <div className="truncate">
                            <p className="font-semibold text-white truncate">{friend.username || 'Giocatore'}</p>
                            <p className="text-xs text-slate-500">Amico in comune</p>
                          </div>
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                <div className="rounded-[1.75rem] border border-slate-800/80 bg-slate-950/90 p-5">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-xs uppercase tracking-[0.25em] text-slate-500">Richieste</p>
                      <h3 className="mt-2 text-lg font-semibold text-white">Da gestire</h3>
                    </div>
                    <div className="inline-flex items-center gap-2 rounded-full bg-emerald-500/10 px-3 py-1 text-xs uppercase tracking-[0.2em] text-emerald-200">
                      {incomingRequests.length} in arrivo
                    </div>
                  </div>

                  {incomingRequests.length === 0 ? (
                    <div className="mt-5 rounded-3xl border border-dashed border-slate-700/70 bg-slate-900/80 p-5 text-sm text-slate-400">
                      Nessuna richiesta in attesa. Continua a esplorare e connetterti.
                    </div>
                  ) : (
                    <div className="mt-5 space-y-3">
                      {incomingRequests.map((request) => {
                        const sender = allProfiles.find((profile) => profile.id === request.requester_id)
                        return (
                          <div key={request.id} className="rounded-3xl border border-slate-800/70 bg-slate-900/80 p-4">
                            <div className="flex items-center justify-between gap-4">
                              <div className="flex items-center gap-3">
                                <div className="flex h-11 w-11 items-center justify-center rounded-3xl bg-slate-800 text-amber-300 overflow-hidden">
                                  {sender?.avatar_url ? (
                                    <img src={sender.avatar_url} alt={sender.username || 'Avatar'} className="h-full w-full object-contain" />
                                  ) : (
                                    <span>{(sender?.username || 'U').charAt(0).toUpperCase()}</span>
                                  )}
                                </div>
                                <div>
                                  <p className="font-semibold text-white">{sender?.username || 'Giocatore'}</p>
                                  <p className="text-xs text-slate-500">Ti ha inviato una richiesta di amicizia.</p>
                                </div>
                              </div>
                              <div className="flex gap-2">
                                <button
                                  onClick={() => updateRequest(request.id, 'accepted')}
                                  disabled={busy}
                                  className="rounded-2xl bg-emerald-500/15 px-3 py-2 text-xs font-semibold text-emerald-200 transition hover:bg-emerald-500/25 disabled:opacity-60"
                                >
                                  <Check size={14} /> Accetta
                                </button>
                                <button
                                  onClick={() => updateRequest(request.id, 'rejected')}
                                  disabled={busy}
                                  className="rounded-2xl bg-red-500/15 px-3 py-2 text-xs font-semibold text-red-300 transition hover:bg-red-500/25 disabled:opacity-60"
                                >
                                  <X size={14} /> Rifiuta
                                </button>
                              </div>
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  )}
                </div>
              </div>
            </section>

            <aside className="space-y-5 rounded-[1.75rem] border border-slate-800/80 bg-slate-950/90 p-5">
              <div className="flex items-center gap-3 text-slate-300">
                <div className="rounded-3xl bg-amber-500/10 p-3 text-amber-200">
                  <UserPlus size={20} />
                </div>
                <div>
                  <p className="text-xs uppercase tracking-[0.25em] text-slate-500">Invia richiesta</p>
                  <p className="mt-1 text-sm text-slate-300">Invia una richiesta a un nuovo amico e scopri i suoi deck.</p>
                </div>
              </div>

              <div className="space-y-4">
                {peopleToShow.slice(0, 6).map((profile) => {
                  const status = resolvedRequests.get(profile.id)
                  return (
                    <div key={profile.id} className="flex items-center justify-between gap-3 rounded-3xl border border-slate-800/70 bg-slate-900/90 p-4">
                      <button
                        onClick={() => openProfile(profile)}
                        className="flex min-w-0 items-center gap-3 text-left"
                      >
                        <div className="flex h-12 w-12 items-center justify-center rounded-3xl bg-slate-800 text-amber-300 overflow-hidden">
                          {profile.avatar_url ? (
                            <img src={profile.avatar_url} alt={profile.username || 'Avatar'} className="h-full w-full object-contain" />
                          ) : (
                            <span>{(profile.username || 'U').charAt(0).toUpperCase()}</span>
                          )}
                        </div>
                        <div className="min-w-0">
                          <p className="font-semibold text-white truncate">{profile.username || 'Giocatore'}</p>
                          <p className="text-[11px] text-slate-500 truncate">
                            {status === 'friend'
                              ? 'Già vostro amico'
                              : status === 'sent'
                              ? 'Richiesta inviata'
                              : status === 'incoming'
                              ? 'Richiesta in arrivo'
                              : 'Disponibile per un saluto'}
                          </p>
                        </div>
                      </button>
                      <button
                        onClick={() => sendFriendRequest(profile.id)}
                        disabled={busy || status === 'friend' || status === 'sent' || status === 'incoming'}
                        className="rounded-2xl bg-amber-400 px-4 py-2 text-xs font-semibold text-slate-950 transition hover:bg-amber-300 disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        {status === 'friend'
                          ? 'Amico'
                          : status === 'sent'
                          ? 'In attesa'
                          : status === 'incoming'
                          ? 'Vedi richiesta'
                          : 'Aggiungi'}
                      </button>
                    </div>
                  )
                })}

                {peopleToShow.length === 0 && (
                  <div className="rounded-3xl border border-dashed border-slate-700/70 bg-slate-900/80 p-4 text-sm text-slate-400">
                    Nessun giocatore trovato. Prova un altro nome.
                  </div>
                )}
              </div>

              <div className="rounded-3xl border border-slate-800/70 bg-slate-900/70 p-4 text-sm text-slate-300">
                <p className="font-semibold text-white">Stato attività</p>
                <p className="mt-2 leading-6">
                  Puoi vedere chi ti ha richiesto l'amicizia e aprire il profilo dei tuoi amici per visualizzare le loro carte.
                </p>
              </div>
              {actionMessage ? (
                <div className="rounded-3xl border border-slate-800/70 bg-emerald-500/10 p-4 text-sm text-emerald-200">
                  {actionMessage}
                </div>
              ) : null}
            </aside>
          </div>
        </div>
      </main>

      {selectedProfile ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm">
          <div className="w-full max-w-4xl overflow-hidden rounded-[2rem] border border-slate-800/80 bg-slate-950/95 shadow-2xl shadow-black/60">
            <div className="flex items-center justify-between border-b border-slate-800/70 bg-slate-900/80 p-5">
              <div>
                <p className="text-xs uppercase tracking-[0.25em] text-slate-500">Profilo giocatore</p>
                <h3 className="text-2xl font-semibold text-white">{selectedProfile.username || 'Giocatore'}</h3>
              </div>
              <button
                onClick={closeModal}
                className="rounded-2xl border border-slate-700/70 px-3 py-2 text-sm text-slate-300 transition hover:bg-slate-900"
              >
                Chiudi
              </button>
            </div>

            <div className="grid gap-6 lg:grid-cols-[360px_1fr] p-6">
              <div className="space-y-5 rounded-[1.75rem] border border-slate-800/80 bg-slate-900/90 p-5">
                <div className="flex flex-col items-center gap-4 text-center">
                  <div className="flex h-32 w-32 items-center justify-center overflow-hidden rounded-full bg-slate-800 text-4xl text-amber-300">
                    {selectedProfile.avatar_url ? (
                      <img src={selectedProfile.avatar_url} alt={selectedProfile.username || 'Avatar'} className="h-full w-full object-contain" />
                    ) : (
                      <span>{(selectedProfile.username || 'U').charAt(0).toUpperCase()}</span>
                    )}
                  </div>
                  <p className="text-sm uppercase tracking-[0.25em] text-slate-500">{isFriend ? 'Amico' : 'Profilo pubblico'}</p>
                  <div className="inline-flex items-center gap-2 rounded-full bg-slate-800/80 px-3 py-2 text-xs uppercase tracking-[0.2em] text-slate-300">
                    <Heart size={14} />
                    {isFriend ? 'Visualizza le carte del tuo amico' : selectedRequest?.status === 'incoming' ? 'Richiesta in arrivo' : 'Invia amicizia per vedere le carte'}
                  </div>
                </div>

                {!isFriend && selectedRequest?.status === 'incoming' ? (
                  <div className="rounded-3xl border border-slate-800/70 bg-slate-900/80 p-4">
                    <p className="text-sm text-slate-200">Questa persona ti ha inviato una richiesta.</p>
                    <div className="mt-4 flex gap-3">
                      <button
                        onClick={() => updateRequest(selectedRequest.id, 'accepted')}
                        disabled={busy}
                        className="rounded-2xl bg-emerald-500/15 px-4 py-2 text-sm font-semibold text-emerald-200 hover:bg-emerald-500/25 disabled:opacity-60"
                      >
                        Accetta
                      </button>
                      <button
                        onClick={() => updateRequest(selectedRequest.id, 'rejected')}
                        disabled={busy}
                        className="rounded-2xl bg-red-500/15 px-4 py-2 text-sm font-semibold text-red-300 hover:bg-red-500/25 disabled:opacity-60"
                      >
                        Rifiuta
                      </button>
                    </div>
                  </div>
                ) : null}

                {!isFriend && (!selectedRequest || selectedRequest.status !== 'incoming') ? (
                  <button
                    onClick={() => selectedProfile?.id && sendFriendRequest(selectedProfile.id)}
                    disabled={busy || resolvedRequests.get(selectedProfile.id) === 'sent' || resolvedRequests.get(selectedProfile.id) === 'friend'}
                    className="w-full rounded-3xl bg-amber-400 px-4 py-3 text-sm font-semibold text-slate-950 transition hover:bg-amber-300 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {resolvedRequests.get(selectedProfile.id) === 'sent'
                      ? 'Richiesta inviata'
                      : 'Invia richiesta d\'amicizia'}
                  </button>
                ) : null}
              </div>

              <div className="rounded-[1.75rem] border border-slate-800/80 bg-slate-950/90 p-5">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-xs uppercase tracking-[0.25em] text-slate-500">Carte</p>
                    <h4 className="mt-2 text-lg font-semibold text-white">Collezione</h4>
                  </div>
                  {isFriend ? (
                    <span className="rounded-full bg-emerald-500/10 px-3 py-1 text-xs uppercase tracking-[0.2em] text-emerald-200">Visibile</span>
                  ) : (
                    <span className="rounded-full bg-amber-400/10 px-3 py-1 text-xs uppercase tracking-[0.2em] text-amber-200">Bloccato</span>
                  )}
                </div>

                {isFriend ? (
                  selectedCards.length === 0 ? (
                    <div className="mt-5 rounded-3xl border border-dashed border-slate-700/70 bg-slate-900/80 p-5 text-sm text-slate-400">
                      Nessuna carta trovata per questo utente.
                    </div>
                  ) : (
                    <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-3">
                      {selectedCards.map((card) => (
                        <div key={card.card_id} className="rounded-3xl border border-slate-800/70 bg-slate-900/80 p-3">
                          <div className="aspect-[3/4] overflow-hidden rounded-2xl bg-slate-800">
                            {card.image_url ? (
                              <img src={card.image_url} alt={card.name || card.card_id} className="h-full w-full object-contain" />
                            ) : (
                              <div className="flex h-full items-center justify-center text-[10px] text-slate-500">NO IMAGE</div>
                            )}
                          </div>
                          <p className="mt-2 text-sm font-semibold text-white line-clamp-2">{card.name || card.card_id}</p>
                          <p className="mt-1 text-xs text-slate-500">{card.rarity || '—'}</p>
                          <p className="mt-1 text-xs text-amber-300">x{card.quantity}</p>
                        </div>
                      ))}
                    </div>
                  )
                ) : (
                  <div className="mt-5 rounded-3xl border border-dashed border-slate-700/70 bg-slate-900/80 p-5 text-sm text-slate-400">
                    Solo gli amici possono vedere le carte complete del profilo.
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}
