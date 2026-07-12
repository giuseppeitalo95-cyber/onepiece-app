'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { ArrowLeft, Ban, Clock3, Inbox, MessageCircle, Search, Send, ShieldCheck, UserPlus } from 'lucide-react'
import Sidebar from '@/app/components/Sidebar'
import Topbar from '@/app/components/Topbar'
import { supabase } from '@/lib/supabase'
import { getPremiumTier, premiumClassName, premiumLabel } from '@/lib/premium'

type ProfileItem = {
  id: string
  username: string | null
  avatar_url: string | null
  is_premium?: boolean | null
  premium_until?: string | null
  is_vip?: boolean | null
}

type ChatMessage = {
  id: string
  sender_id: string
  receiver_id: string
  body: string
  read_at: string | null
  created_at: string
}

type FriendRequest = {
  requester_id: string
  receiver_id: string
  status: string
}

type ChatBlock = {
  blocker_id: string
  blocked_id: string
}

const cutoffIso = () => new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
const badgeLabel = (value: number) => value > 9 ? '9+' : String(value)

const timeLabel = (value: string) => {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return date.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' })
}

export default function ChatPage() {
  const router = useRouter()
  const messagesEndRef = useRef<HTMLDivElement | null>(null)
  const [userId, setUserId] = useState('')
  const [friends, setFriends] = useState<ProfileItem[]>([])
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [selectedFriendId, setSelectedFriendId] = useState('')
  const [query, setQuery] = useState('')
  const [text, setText] = useState('')
  const [loading, setLoading] = useState(true)
  const [sending, setSending] = useState(false)
  const [chatReady, setChatReady] = useState(true)
  const [blocksReady, setBlocksReady] = useState(true)
  const [blocks, setBlocks] = useState<ChatBlock[]>([])
  const [status, setStatus] = useState('')

  const getAvatarPublicUrl = (avatarPath: string | null) => {
    if (!avatarPath) return ''
    if (avatarPath.startsWith('http')) return avatarPath
    const { data } = supabase.storage.from('avatars').getPublicUrl(avatarPath)
    return data?.publicUrl ?? ''
  }

  const loadFriends = async (uid: string) => {
    const { data: requests } = await supabase
      .from('friend_requests')
      .select('requester_id, receiver_id, status')
      .or(`requester_id.eq.${uid},receiver_id.eq.${uid}`)
      .eq('status', 'accepted')

    const friendIds = ((requests || []) as FriendRequest[])
      .map(request => request.requester_id === uid ? request.receiver_id : request.requester_id)
      .filter(Boolean)

    if (friendIds.length === 0) {
      setFriends([])
      return []
    }

    const { data: profileData, error } = await supabase
      .from('profiles')
      .select('id, username, avatar_url, is_premium, premium_until, is_vip')
      .in('id', friendIds)

    if (error) {
      const { data: fallback } = await supabase
        .from('profiles')
        .select('id, username, avatar_url')
        .in('id', friendIds)

      const fallbackFriends = ((fallback || []) as ProfileItem[]).map(profile => ({
        ...profile,
        avatar_url: getAvatarPublicUrl(profile.avatar_url)
      }))
      setFriends(fallbackFriends)
      return fallbackFriends
    }

    const resolvedFriends = ((profileData || []) as ProfileItem[]).map(profile => ({
      ...profile,
      avatar_url: getAvatarPublicUrl(profile.avatar_url)
    }))
    setFriends(resolvedFriends)
    return resolvedFriends
  }

  const loadMessages = async (uid: string) => {
    const { data, error } = await supabase
      .from('chat_messages')
      .select('id, sender_id, receiver_id, body, read_at, created_at')
      .or(`sender_id.eq.${uid},receiver_id.eq.${uid}`)
      .gte('created_at', cutoffIso())
      .order('created_at', { ascending: true })
      .limit(300)

    if (error) {
      setChatReady(false)
      setMessages([])
      return
    }

    setChatReady(true)
    setMessages((data || []) as ChatMessage[])
  }

  const loadBlocks = async (uid: string) => {
    const { data, error } = await supabase
      .from('chat_blocks')
      .select('blocker_id, blocked_id')
      .or(`blocker_id.eq.${uid},blocked_id.eq.${uid}`)

    if (error) {
      setBlocksReady(false)
      setBlocks([])
      return []
    }

    setBlocksReady(true)
    setBlocks((data || []) as ChatBlock[])
    return (data || []) as ChatBlock[]
  }

  const markConversationRead = async (friendId: string, uid = userId) => {
    if (!uid || !friendId || !chatReady) return

    await supabase
      .from('chat_messages')
      .update({ read_at: new Date().toISOString() })
      .eq('sender_id', friendId)
      .eq('receiver_id', uid)
      .is('read_at', null)
      .gte('created_at', cutoffIso())

    setMessages(current => current.map(message =>
      message.sender_id === friendId && message.receiver_id === uid && !message.read_at
        ? { ...message, read_at: new Date().toISOString() }
        : message
    ))
    window.dispatchEvent(new CustomEvent('opv:chat-unread-changed'))
  }

  useEffect(() => {
    const load = async () => {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session?.user) {
        router.push('/')
        return
      }

      const uid = session.user.id
      setUserId(uid)
      void fetch('/api/chat/cleanup', { method: 'POST' }).catch(() => undefined)

      const loadedFriends = await loadFriends(uid)
      await loadBlocks(uid)
      await loadMessages(uid)

      const initialFriendId = typeof window === 'undefined'
        ? ''
        : new URLSearchParams(window.location.search).get('user') || ''
      const safeInitial = loadedFriends.some(friend => friend.id === initialFriendId)
        ? initialFriendId
        : loadedFriends[0]?.id || ''
      setSelectedFriendId(safeInitial)
      if (safeInitial) await markConversationRead(safeInitial, uid)
      setLoading(false)
    }

    load()
  }, [router])

  useEffect(() => {
    if (!userId || !chatReady) return

    const timer = window.setInterval(() => {
      void loadMessages(userId)
    }, 8000)

    return () => window.clearInterval(timer)
  }, [userId, chatReady])

  useEffect(() => {
    if (selectedFriendId) void markConversationRead(selectedFriendId)
  }, [selectedFriendId, messages.length, chatReady])

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [selectedFriendId, messages.length])

  const friendMap = useMemo(() => new Map(friends.map(friend => [friend.id, friend])), [friends])
  const selectedFriend = selectedFriendId ? friendMap.get(selectedFriendId) || null : null
  const blockedByMe = Boolean(selectedFriendId && blocks.some(block => block.blocker_id === userId && block.blocked_id === selectedFriendId))
  const blockedMe = Boolean(selectedFriendId && blocks.some(block => block.blocker_id === selectedFriendId && block.blocked_id === userId))
  const filteredFriends = friends.filter(friend =>
    (friend.username || 'Giocatore').toLowerCase().includes(query.trim().toLowerCase())
  )

  const conversations = useMemo(() => {
    return friends
      .map(friend => {
        const friendMessages = messages.filter(message =>
          message.sender_id === friend.id || message.receiver_id === friend.id
        )
        const last = friendMessages[friendMessages.length - 1] || null
        const unread = friendMessages.filter(message =>
          message.sender_id === friend.id && message.receiver_id === userId && !message.read_at
        ).length
        return { friend, last, unread }
      })
      .filter(item => item.last)
      .sort((a, b) => new Date(b.last!.created_at).getTime() - new Date(a.last!.created_at).getTime())
  }, [friends, messages, userId])

  const activeMessages = messages.filter(message =>
    selectedFriendId && (message.sender_id === selectedFriendId || message.receiver_id === selectedFriendId)
  )

  const sendMessage = async () => {
    const cleanText = text.trim()
    if (!userId || !selectedFriendId || !cleanText || sending) return
    if (blockedByMe || blockedMe) {
      setStatus(blockedByMe
        ? 'Hai bloccato questo utente. Sbloccalo per scrivere.'
        : 'Questo utente non puo ricevere i tuoi messaggi.')
      return
    }

    setSending(true)
    setStatus('')

    const { error } = await supabase
      .from('chat_messages')
      .insert({
        sender_id: userId,
        receiver_id: selectedFriendId,
        body: cleanText.slice(0, 800)
      })

    if (error) {
      setStatus(error.code === '42P01'
        ? 'La chat e pronta nel sito, ma devi prima eseguire chat.sql su Supabase.'
        : 'Non sono riuscito a inviare il messaggio.')
      setSending(false)
      return
    }

    setText('')
    await loadMessages(userId)
    setSending(false)
  }

  const toggleBlock = async () => {
    if (!userId || !selectedFriendId || !blocksReady) return

    setStatus('')
    if (blockedByMe) {
      const { error } = await supabase
        .from('chat_blocks')
        .delete()
        .eq('blocker_id', userId)
        .eq('blocked_id', selectedFriendId)

      if (error) {
        setStatus('Non sono riuscito a sbloccare questo utente.')
        return
      }
      await loadBlocks(userId)
      setStatus('Utente sbloccato.')
      return
    }

    const confirmed = window.confirm('Vuoi bloccare questo utente? Non potra piu scriverti finche resta bloccato.')
    if (!confirmed) return

    const { error } = await supabase
      .from('chat_blocks')
      .insert({ blocker_id: userId, blocked_id: selectedFriendId })

    if (error) {
      setStatus(error.code === '42P01'
        ? 'Per usare il blocco devi rieseguire chat.sql su Supabase.'
        : 'Non sono riuscito a bloccare questo utente.')
      return
    }

    await loadBlocks(userId)
    setStatus('Utente bloccato. Non potra piu scriverti.')
  }

  return (
    <div className="h-dvh overflow-hidden pt-14 text-white onepiece-wave-bg onepiece-clouds">
      <Topbar />
      <Sidebar activePage="chat" />

      <main className="mx-auto grid h-[calc(100dvh-4.4rem-env(safe-area-inset-bottom))] max-w-7xl gap-3 overflow-hidden px-3 pb-20 pt-3 sm:px-6 sm:pb-24 lg:grid-cols-[340px_1fr] lg:gap-4 lg:px-8">
        <aside className={`${selectedFriendId ? 'hidden lg:flex' : 'flex'} min-h-0 flex-col overflow-hidden rounded-[1.65rem] border border-white/10 bg-slate-900/76 p-3 shadow-2xl shadow-black/20 backdrop-blur-xl sm:p-4`}>
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-[10px] font-black uppercase tracking-[0.24em] text-cyan-200">Scambi</p>
              <h1 className="mt-1 text-2xl font-black text-white">Chat</h1>
            </div>
            <div className="grid h-11 w-11 place-items-center rounded-2xl bg-cyan-300/12 text-cyan-100">
              <MessageCircle size={21} />
            </div>
          </div>

          <div className="mt-3 rounded-2xl border border-cyan-300/20 bg-cyan-300/[0.08] p-3 text-sm leading-6 text-cyan-50">
            <div className="flex items-center gap-2 font-black">
              <Clock3 size={16} />
              Messaggi temporanei
            </div>
            <p className="mt-1 text-xs text-cyan-50/78">I messaggi restano solo 24H, pensati per accordarsi sugli scambi senza riempire il database.</p>
          </div>

          {!chatReady ? (
            <div className="mt-3 rounded-2xl border border-amber-300/25 bg-amber-300/10 p-3 text-sm text-amber-100">
              Chat pronta nel codice. Esegui `chat.sql` su Supabase per attivare la tabella.
            </div>
          ) : null}
          {!blocksReady ? (
            <div className="mt-3 rounded-2xl border border-amber-300/25 bg-amber-300/10 p-3 text-sm text-amber-100">
              Il blocco utenti richiede l'ultima versione di `chat.sql` su Supabase.
            </div>
          ) : null}

          <label className="relative mt-3 block">
            <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" size={16} />
            <input
              value={query}
              onChange={event => setQuery(event.target.value)}
              placeholder="Nuova chat con un amico"
              className="w-full rounded-2xl border border-slate-700 bg-slate-950/70 py-3 pl-10 pr-3 text-sm text-white outline-none focus:border-cyan-300"
            />
          </label>

          <div className="mt-3 min-h-0 flex-1 space-y-2 overflow-y-auto pr-1">
            {conversations.length > 0 ? (
              conversations.map(({ friend, last, unread }) => {
                const tier = getPremiumTier(friend, { id: friend.id })
                const label = premiumLabel(tier)
                return (
                  <button
                    key={friend.id}
                    onClick={() => setSelectedFriendId(friend.id)}
                    className={`flex w-full items-center gap-3 rounded-2xl border p-2 text-left transition active:scale-[0.99] ${
                      selectedFriendId === friend.id
                        ? 'border-cyan-200/45 bg-cyan-300/14'
                        : 'border-slate-700 bg-slate-950/62 hover:border-cyan-300/30'
                    }`}
                  >
                    <div className="grid h-11 w-11 shrink-0 place-items-center overflow-hidden rounded-full border border-cyan-300/20 bg-slate-800 text-sm font-black text-cyan-100">
                      {friend.avatar_url ? <img src={friend.avatar_url} alt={friend.username || 'Avatar'} className="h-full w-full object-cover" /> : (friend.username || 'U').charAt(0).toUpperCase()}
                    </div>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-2">
                        <span className={`truncate text-sm font-black text-white ${premiumClassName(tier)}`}>{friend.username || 'Giocatore'}</span>
                        {label ? <span className="rounded-full bg-white/[0.08] px-1.5 py-0.5 text-[8px] font-black uppercase text-cyan-100">{label}</span> : null}
                      </span>
                      <span className="mt-0.5 block truncate text-xs text-slate-400">{last?.body}</span>
                    </span>
                    {unread > 0 ? (
                      <span className="grid h-5 min-w-5 place-items-center rounded-full bg-rose-400 px-1 text-[10px] font-black text-white">
                        {badgeLabel(unread)}
                      </span>
                    ) : null}
                  </button>
                )
              })
            ) : (
              <div className="rounded-2xl border border-dashed border-slate-700 bg-slate-950/50 p-3 text-sm text-slate-400">
                Nessuna chat aperta.
              </div>
            )}
          </div>

          <div className="mt-4">
            <div className="mb-2 flex items-center gap-2 text-[10px] font-black uppercase tracking-[0.22em] text-slate-400">
              <UserPlus size={13} />
              Nuova chat
            </div>
            <div className="max-h-[26dvh] space-y-2 overflow-y-auto pr-1 lg:max-h-52">
              {loading ? (
                <p className="rounded-2xl border border-slate-700 bg-slate-950/50 p-3 text-sm text-slate-400">Carico amici...</p>
              ) : filteredFriends.length === 0 ? (
                <p className="rounded-2xl border border-slate-700 bg-slate-950/50 p-3 text-sm text-slate-400">Nessun amico trovato.</p>
              ) : filteredFriends.map(friend => {
                const tier = getPremiumTier(friend, { id: friend.id })
                return (
                  <button
                    key={friend.id}
                    onClick={() => setSelectedFriendId(friend.id)}
                    className="flex w-full items-center gap-3 rounded-2xl border border-slate-700 bg-slate-950/54 p-2 text-left transition hover:border-cyan-300/35"
                  >
                    <div className="grid h-9 w-9 shrink-0 place-items-center overflow-hidden rounded-full bg-slate-800 text-xs font-black text-cyan-100">
                      {friend.avatar_url ? <img src={friend.avatar_url} alt={friend.username || 'Avatar'} className="h-full w-full object-cover" /> : (friend.username || 'U').charAt(0).toUpperCase()}
                    </div>
                    <span className={`truncate text-sm font-bold text-white ${premiumClassName(tier)}`}>{friend.username || 'Giocatore'}</span>
                  </button>
                )
              })}
            </div>
          </div>
        </aside>

        <section className={`${selectedFriendId ? 'flex' : 'hidden lg:flex'} min-h-0 flex-col overflow-hidden rounded-[1.65rem] border border-white/10 bg-slate-900/76 shadow-2xl shadow-black/20 backdrop-blur-xl`}>
          {selectedFriend ? (
            <>
              <header className="flex items-center justify-between gap-3 border-b border-white/10 bg-slate-950/55 p-3 sm:p-4">
                <div className="flex min-w-0 items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setSelectedFriendId('')}
                    className="grid h-10 w-10 shrink-0 place-items-center rounded-2xl border border-white/10 bg-white/[0.06] text-slate-200 lg:hidden"
                    aria-label="Torna alle chat"
                  >
                    <ArrowLeft size={18} />
                  </button>
                  <button
                    onClick={() => router.push(`/friends?profile=${selectedFriend.id}`)}
                    className="flex min-w-0 items-center gap-3 text-left"
                  >
                    <div className="grid h-10 w-10 shrink-0 place-items-center overflow-hidden rounded-full border border-cyan-300/25 bg-slate-800 text-sm font-black text-cyan-100 sm:h-11 sm:w-11">
                      {selectedFriend.avatar_url ? <img src={selectedFriend.avatar_url} alt={selectedFriend.username || 'Avatar'} className="h-full w-full object-cover" /> : (selectedFriend.username || 'U').charAt(0).toUpperCase()}
                    </div>
                    <span className="min-w-0">
                      <span className={`block truncate text-sm font-black text-white sm:text-base ${premiumClassName(getPremiumTier(selectedFriend, { id: selectedFriend.id }))}`}>
                        {selectedFriend.username || 'Giocatore'}
                      </span>
                      <span className="mt-0.5 flex items-center gap-1 text-[11px] text-cyan-100/76 sm:text-xs">
                        <ShieldCheck size={13} />
                        Solo amici - 24H
                      </span>
                    </span>
                  </button>
                </div>
                <button
                  type="button"
                  onClick={toggleBlock}
                  disabled={!blocksReady}
                  className={`inline-flex shrink-0 items-center gap-1 rounded-2xl border px-2 py-2 text-[9px] font-black uppercase tracking-[0.08em] transition active:scale-95 disabled:opacity-50 sm:gap-1.5 sm:px-3 sm:text-[10px] sm:tracking-[0.12em] ${
                    blockedByMe
                      ? 'border-emerald-300/30 bg-emerald-300/12 text-emerald-100'
                      : 'border-rose-300/25 bg-rose-400/10 text-rose-100 hover:bg-rose-400/18'
                  }`}
                >
                  <Ban size={14} />
                  {blockedByMe ? 'Sblocca' : 'Blocca'}
                </button>
              </header>

              <div className="flex-1 space-y-2 overflow-y-auto p-3 sm:p-4">
                {activeMessages.length === 0 ? (
                  <div className="grid min-h-[38dvh] place-items-center rounded-3xl border border-dashed border-slate-700 bg-slate-950/42 p-5 text-center">
                    <div>
                      <Inbox className="mx-auto text-cyan-100" size={30} />
                      <p className="mt-3 text-lg font-black text-white">Nessun messaggio</p>
                      <p className="mt-1 text-sm text-slate-400">Scrivi per iniziare una chat temporanea.</p>
                    </div>
                  </div>
                ) : activeMessages.map(message => {
                  const mine = message.sender_id === userId
                  return (
                    <div key={message.id} className={`flex ${mine ? 'justify-end' : 'justify-start'}`}>
                      <div className={`max-w-[82%] rounded-3xl px-4 py-2 shadow-lg ${
                        mine
                          ? 'bg-cyan-300 text-slate-950 shadow-cyan-950/20'
                          : 'border border-slate-700 bg-slate-950/72 text-slate-100 shadow-black/10'
                      }`}>
                        <p className="whitespace-pre-wrap break-words text-sm leading-6">{message.body}</p>
                        <p className={`mt-1 text-[10px] font-bold ${mine ? 'text-slate-700' : 'text-slate-500'}`}>
                          {timeLabel(message.created_at)}
                        </p>
                      </div>
                    </div>
                  )
                })}
                <div ref={messagesEndRef} />
              </div>

              <div className="border-t border-white/10 bg-slate-950/52 p-3">
                {status ? <p className="mb-2 rounded-2xl border border-amber-300/25 bg-amber-300/10 px-3 py-2 text-sm text-amber-100">{status}</p> : null}
                {(blockedByMe || blockedMe) ? (
                  <p className="mb-2 rounded-2xl border border-rose-300/25 bg-rose-400/10 px-3 py-2 text-sm text-rose-100">
                    {blockedByMe ? 'Hai bloccato questo utente.' : 'Non puoi scrivere in questa chat.'}
                  </p>
                ) : null}
                <div className="flex gap-2">
                  <textarea
                    value={text}
                    onChange={event => setText(event.target.value)}
                    onKeyDown={event => {
                      if (event.key === 'Enter' && !event.shiftKey) {
                        event.preventDefault()
                        void sendMessage()
                      }
                    }}
                    rows={1}
                    maxLength={800}
                    placeholder="Scrivi un messaggio..."
                    disabled={blockedByMe || blockedMe}
                    className="min-h-12 flex-1 resize-none rounded-2xl border border-slate-700 bg-slate-900/90 px-3 py-3 text-sm text-white outline-none focus:border-cyan-300"
                  />
                  <button
                    onClick={sendMessage}
                    disabled={sending || !text.trim() || blockedByMe || blockedMe}
                    className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-cyan-300 text-slate-950 transition hover:bg-cyan-200 disabled:cursor-not-allowed disabled:opacity-50"
                    aria-label="Invia messaggio"
                  >
                    <Send size={18} />
                  </button>
                </div>
                <p className="mt-2 text-[10px] font-bold uppercase tracking-[0.16em] text-slate-500">Scadenza automatica dopo 24H</p>
              </div>
            </>
          ) : (
            <div className="grid flex-1 place-items-center p-6 text-center">
              <div>
                <MessageCircle className="mx-auto text-cyan-100" size={36} />
                <h2 className="mt-3 text-2xl font-black text-white">Seleziona una chat</h2>
                <p className="mt-2 max-w-sm text-sm leading-6 text-slate-400">Puoi scrivere solo agli amici. Le conversazioni restano leggere e temporanee.</p>
              </div>
            </div>
          )}
        </section>
      </main>
    </div>
  )
}
