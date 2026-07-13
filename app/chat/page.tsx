'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { ArrowLeft, Ban, Clock3, Inbox, MessageCircle, Send, ShieldCheck, X } from 'lucide-react'
import CardImage from '@/app/components/CardImage'
import Sidebar from '@/app/components/Sidebar'
import Topbar from '@/app/components/Topbar'
import { supabase } from '@/lib/supabase'
import { getPremiumTier, premiumClassName, premiumLabel } from '@/lib/premium'
import { isProfileOnline } from '@/lib/onlineStatus'

type ProfileItem = {
  id: string
  username: string | null
  avatar_url: string | null
  is_premium?: boolean | null
  premium_until?: string | null
  is_vip?: boolean | null
  last_seen_at?: string | null
}

type ChatMessage = {
  id: string
  post_id: string | null
  sender_id: string
  receiver_id: string
  body: string
  read_at: string | null
  created_at: string
}

type ChatBlock = {
  blocker_id: string
  blocked_id: string
}

type BoardPostSummary = {
  id: string
  card_id: string | null
  user_id: string
  title: string
  message: string | null
  card_name: string | null
  card_code: string | null
  card_image_url: string | null
  created_at: string
}

const cutoffIso = () => new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
const badgeLabel = (value: number) => value > 9 ? '9+' : String(value)
const legacyPostKey = 'legacy'

const timeLabel = (value: string) => {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return date.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' })
}

export default function ChatPage() {
  const router = useRouter()
  const messagesEndRef = useRef<HTMLDivElement | null>(null)
  const [userId, setUserId] = useState('')
  const [currentUsername, setCurrentUsername] = useState('Giocatore')
  const [friends, setFriends] = useState<ProfileItem[]>([])
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [selectedFriendId, setSelectedFriendId] = useState('')
  const [activePostId, setActivePostId] = useState('')
  const [activePost, setActivePost] = useState<BoardPostSummary | null>(null)
  const [selectedPostCard, setSelectedPostCard] = useState<BoardPostSummary | null>(null)
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

  const loadContacts = async (contactIds: string[]) => {
    const uniqueIds = [...new Set(contactIds)].filter(Boolean)

    if (uniqueIds.length === 0) {
      setFriends([])
      return []
    }

    const { data: profileData, error } = await supabase
      .from('profiles')
        .select('id, username, avatar_url, is_premium, premium_until, is_vip, last_seen_at')
      .in('id', uniqueIds)

    if (error) {
      const { data: fallback } = await supabase
        .from('profiles')
        .select('id, username, avatar_url')
        .in('id', uniqueIds)

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
    const query = supabase
      .from('chat_messages')
      .select('id, post_id, sender_id, receiver_id, body, read_at, created_at')
      .or(`sender_id.eq.${uid},receiver_id.eq.${uid}`)
      .gte('created_at', cutoffIso())
      .order('created_at', { ascending: true })
      .limit(300)

    let { data, error } = await query

    if (error && error.message.toLowerCase().includes('post_id')) {
      const fallback = await supabase
        .from('chat_messages')
        .select('id, sender_id, receiver_id, body, read_at, created_at')
        .or(`sender_id.eq.${uid},receiver_id.eq.${uid}`)
        .gte('created_at', cutoffIso())
        .order('created_at', { ascending: true })
        .limit(300)

      data = (fallback.data || []).map(message => ({ ...message, post_id: null }))
      error = fallback.error
    }

    if (error) {
      setChatReady(false)
      setMessages([])
      return []
    }

    setChatReady(true)
    const loadedMessages = (data || []) as ChatMessage[]
    setMessages(loadedMessages)
    return loadedMessages
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

  const loadPostSummary = async (postId: string) => {
    if (!postId) {
      setActivePost(null)
      return null
    }

    const { data, error } = await supabase
      .from('board_posts')
      .select('id, card_id, user_id, title, message, card_name, card_code, card_image_url, created_at')
      .eq('id', postId)
      .maybeSingle()

    if (error || !data) {
      setActivePost(null)
      return null
    }

    const post = data as BoardPostSummary
    setActivePost(post)
    return post
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
      const { data: ownProfile } = await supabase
        .from('profiles')
        .select('username')
        .eq('id', uid)
        .single()
      setCurrentUsername(
        String(ownProfile?.username || session.user.email?.split('@')[0] || 'Giocatore').trim()
      )
      void fetch('/api/chat/cleanup', { method: 'POST' }).catch(() => undefined)

      const params = typeof window === 'undefined'
        ? new URLSearchParams()
        : new URLSearchParams(window.location.search)
      const initialFriendId = params.get('user') || ''
      const initialPostId = params.get('post') || ''
      setActivePostId(initialPostId)

      await loadBlocks(uid)
      const loadedMessages = await loadMessages(uid)
      const contactIds = loadedMessages.map(message =>
        message.sender_id === uid ? message.receiver_id : message.sender_id
      )
      if (initialFriendId) contactIds.push(initialFriendId)
      const loadedContacts = await loadContacts(contactIds)
      const safeInitial = loadedContacts.some(friend => friend.id === initialFriendId)
        ? initialFriendId
        : ''
      const lastInitialMessage = safeInitial
        ? [...loadedMessages].reverse().find(message =>
          (message.sender_id === safeInitial || message.receiver_id === safeInitial) && message.post_id
        )
        : null
      const resolvedPostId = initialPostId || lastInitialMessage?.post_id || ''
      if (resolvedPostId) {
        setActivePostId(resolvedPostId)
        await loadPostSummary(resolvedPostId)
      } else {
        setActivePostId('')
        setActivePost(null)
      }
      setSelectedFriendId(safeInitial)
      if (safeInitial) await markConversationRead(safeInitial, uid)
      setLoading(false)
    }

    load()
  }, [router])

  useEffect(() => {
    if (!userId || !chatReady) return

    const timer = window.setInterval(() => {
      void (async () => {
        const loadedMessages = await loadMessages(userId)
        const contactIds = loadedMessages.map(message =>
          message.sender_id === userId ? message.receiver_id : message.sender_id
        )
        if (selectedFriendId) contactIds.push(selectedFriendId)
        await loadContacts(contactIds)
      })()
    }, 8000)

    return () => window.clearInterval(timer)
  }, [userId, chatReady, selectedFriendId])

  useEffect(() => {
    if (selectedFriendId) void markConversationRead(selectedFriendId)
  }, [selectedFriendId, messages.length, chatReady])

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [selectedFriendId, messages.length])

  const openConversation = async (friendId: string, postId?: string | null) => {
    setSelectedFriendId(friendId)
    const resolvedPostId = postId || ''
    setActivePostId(resolvedPostId)
    if (resolvedPostId) {
      await loadPostSummary(resolvedPostId)
    } else {
      setActivePost(null)
    }
    await markConversationRead(friendId)
  }

  const friendMap = useMemo(() => new Map(friends.map(friend => [friend.id, friend])), [friends])
  const selectedFriend = selectedFriendId ? friendMap.get(selectedFriendId) || null : null
  const blockedByMe = Boolean(selectedFriendId && blocks.some(block => block.blocker_id === userId && block.blocked_id === selectedFriendId))
  const blockedMe = Boolean(selectedFriendId && blocks.some(block => block.blocker_id === selectedFriendId && block.blocked_id === userId))

  const conversations = useMemo(() => {
    const grouped = new Map<string, { friend: ProfileItem; postId: string; messages: ChatMessage[] }>()

    messages.forEach(message => {
      const friendId = message.sender_id === userId ? message.receiver_id : message.sender_id
      const friend = friendMap.get(friendId)
      if (!friend) return
      const postId = message.post_id || legacyPostKey
      const key = `${friendId}:${postId}`
      const current = grouped.get(key)
      if (current) {
        current.messages.push(message)
      } else {
        grouped.set(key, { friend, postId, messages: [message] })
      }
    })

    return [...grouped.values()]
      .map(item => {
        const last = item.messages[item.messages.length - 1] || null
        const unread = item.messages.filter(message =>
          message.sender_id === item.friend.id && message.receiver_id === userId && !message.read_at
        ).length
        return { friend: item.friend, postId: item.postId === legacyPostKey ? '' : item.postId, last, unread }
      })
      .filter(item => item.last)
      .sort((a, b) => new Date(b.last!.created_at).getTime() - new Date(a.last!.created_at).getTime())
  }, [friendMap, messages, userId])

  const activeMessages = messages.filter(message =>
    selectedFriendId &&
    (message.sender_id === selectedFriendId || message.receiver_id === selectedFriendId) &&
    (activePostId ? message.post_id === activePostId : !message.post_id)
  )

  const getFreshAccessToken = async () => {
    const { data: sessionData } = await supabase.auth.getSession()
    if (!sessionData.session?.access_token) return ''

    const { data: refreshData, error } = await supabase.auth.refreshSession()
    if (!error && refreshData.session?.access_token) {
      return refreshData.session.access_token
    }

    return sessionData.session.access_token
  }

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

    if (!activePostId) {
      setStatus('Per scrivere devi aprire la chat dal pulsante Contatta di un annuncio.')
      setSending(false)
      return
    }

    const accessToken = await getFreshAccessToken()
    const res = await fetch('/api/chat/send', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: accessToken ? `Bearer ${accessToken}` : ''
      },
      body: JSON.stringify({
        receiverId: selectedFriendId,
        postId: activePostId,
        body: cleanText
      })
    })
    const data = await res.json().catch(() => null)

    if (!res.ok || !data?.ok) {
      setStatus(data?.error || 'Non sono riuscito a inviare il messaggio.')
      setSending(false)
      return
    }

    setText('')
    void sendPushNotification(selectedFriendId, cleanText)
    await loadMessages(userId)
    setSending(false)
  }

  const sendPushNotification = async (receiverId: string, body: string) => {
    try {
      const accessToken = await getFreshAccessToken()
      if (!accessToken) return

      const res = await fetch('/api/push/send', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`
        },
        body: JSON.stringify({
          receiverId,
          title: `Nuovo messaggio da ${currentUsername}`,
          body,
          url: `/chat?user=${userId}${activePostId ? `&post=${activePostId}` : ''}`
        })
      })
      const data = await res.json().catch(() => null)
      if (!res.ok) {
        console.warn('Push send failed:', data?.error || res.status)
      }
    } catch {
    }
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

          <div className="mt-3 min-h-0 flex-1 space-y-2 overflow-y-auto pr-1">
            {conversations.length > 0 ? (
              conversations.map(({ friend, postId, last, unread }) => {
                const tier = getPremiumTier(friend, { id: friend.id })
                const label = premiumLabel(tier)
                const isActiveConversation = selectedFriendId === friend.id && (activePostId || '') === postId
                return (
                  <button
                    key={`${friend.id}:${postId || legacyPostKey}`}
                    onClick={() => void openConversation(friend.id, postId)}
                    className={`flex w-full items-center gap-3 rounded-2xl border p-2 text-left transition active:scale-[0.99] ${
                      isActiveConversation
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
                      <span className="mt-0.5 flex min-w-0 items-center gap-1 text-xs">
                        <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${isProfileOnline(friend) ? 'bg-emerald-300 shadow-[0_0_10px_rgba(110,231,183,0.75)]' : 'bg-slate-600'}`} />
                        <span className={`shrink-0 font-semibold ${isProfileOnline(friend) ? 'text-emerald-300' : 'text-slate-500'}`}>
                          {isProfileOnline(friend) ? 'Ora online' : 'Offline'}
                        </span>
                        <span className="truncate text-slate-400">- {last?.body}</span>
                      </span>
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
                Nessuna chat aperta. Per iniziare, premi Contatta su un annuncio in bacheca.
              </div>
            )}
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
                        {isProfileOnline(selectedFriend) ? (
                          <>
                            <span className="h-1.5 w-1.5 rounded-full bg-emerald-300 shadow-[0_0_10px_rgba(110,231,183,0.75)]" />
                            <span className="font-bold text-emerald-300">Ora online</span>
                          </>
                        ) : (
                          <>
                            <ShieldCheck size={13} />
                            Chat temporanea - 24H
                          </>
                        )}
                      </span>
                      {activePost ? (
                        <span className="mt-1 block max-w-[56vw] truncate rounded-full border border-cyan-300/20 bg-cyan-300/10 px-2 py-1 text-[10px] font-bold text-cyan-50 sm:max-w-[420px]">
                          Annuncio: {activePost.card_name || activePost.title}{activePost.card_code ? ` - ${activePost.card_code}` : ''}
                        </span>
                      ) : null}
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
                {activePost ? (
                  <div className="rounded-3xl border border-cyan-300/20 bg-cyan-300/[0.08] p-3">
                    <p className="text-[10px] font-black uppercase tracking-[0.22em] text-cyan-100/80">Annuncio collegato</p>
                    <div className="mt-2 flex gap-3">
                      {activePost.card_image_url ? (
                        <button
                          type="button"
                          onClick={() => setSelectedPostCard(activePost)}
                          className="h-20 w-14 shrink-0 overflow-hidden rounded-xl border border-cyan-300/20 bg-slate-950/55 transition hover:border-cyan-200 active:scale-95"
                          aria-label="Apri carta annuncio"
                        >
                          <CardImage
                            src={activePost.card_image_url}
                            cardId={activePost.card_id || activePost.card_code}
                            alt={activePost.card_name || activePost.title}
                            className="h-full w-full"
                            imgClassName="h-full w-full object-cover"
                            loading="eager"
                            fetchPriority="high"
                          />
                        </button>
                      ) : null}
                      <div className="min-w-0">
                        <p className="truncate text-sm font-black text-white">{activePost.card_name || activePost.title}</p>
                        <p className="mt-0.5 text-[10px] uppercase tracking-[0.16em] text-slate-400">{activePost.card_code || 'Annuncio'}</p>
                        {activePost.message ? <p className="mt-1 line-clamp-2 text-xs leading-5 text-slate-300">{activePost.message}</p> : null}
                      </div>
                    </div>
                  </div>
                ) : selectedFriendId ? (
                  <div className="rounded-3xl border border-amber-300/25 bg-amber-300/10 p-3 text-sm text-amber-100">
                    Per rispondere devi aprire la chat dal bottone Contatta dell'annuncio.
                  </div>
                ) : null}
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
                {!activePostId ? (
                  <p className="mb-2 rounded-2xl border border-amber-300/25 bg-amber-300/10 px-3 py-2 text-sm text-amber-100">
                    Apri un annuncio dalla bacheca e premi Contatta per scrivere.
                  </p>
                ) : null}
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
                    disabled={!activePostId || blockedByMe || blockedMe}
                    className="min-h-12 flex-1 resize-none rounded-2xl border border-slate-700 bg-slate-900/90 px-3 py-3 text-sm text-white outline-none focus:border-cyan-300"
                  />
                  <button
                    onClick={sendMessage}
                    disabled={sending || !text.trim() || !activePostId || blockedByMe || blockedMe}
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
                <p className="mt-2 max-w-sm text-sm leading-6 text-slate-400">Puoi scrivere agli amici e ai contatti Premium. Le conversazioni restano leggere e temporanee.</p>
              </div>
            </div>
          )}
        </section>
      </main>
      {selectedPostCard ? (
        <div
          className="fixed inset-0 z-[90] grid place-items-center bg-slate-950/82 px-4 py-8 backdrop-blur-md"
          onClick={() => setSelectedPostCard(null)}
        >
          <div
            className="relative w-full max-w-sm rounded-[1.6rem] border border-white/12 bg-slate-900 p-4 shadow-2xl shadow-black/40"
            onClick={event => event.stopPropagation()}
          >
            <button
              type="button"
              onClick={() => setSelectedPostCard(null)}
              className="absolute right-3 top-3 z-10 grid h-9 w-9 place-items-center rounded-full border border-white/10 bg-slate-950/80 text-white transition hover:bg-slate-800 active:scale-95"
              aria-label="Chiudi carta"
            >
              <X size={17} />
            </button>
            <CardImage
              src={selectedPostCard.card_image_url}
              cardId={selectedPostCard.card_id || selectedPostCard.card_code}
              alt={selectedPostCard.card_name || selectedPostCard.title}
              className="mx-auto aspect-[5/7] w-full max-w-[260px] overflow-hidden rounded-2xl bg-slate-950/70"
              imgClassName="h-full w-full object-contain"
              loading="eager"
              fetchPriority="high"
            />
            <div className="mt-4 text-center">
              <p className="text-lg font-black text-white">{selectedPostCard.card_name || selectedPostCard.title}</p>
              <p className="mt-1 text-xs font-black uppercase tracking-[0.16em] text-cyan-100/78">{selectedPostCard.card_code || 'Annuncio'}</p>
              {selectedPostCard.message ? (
                <p className="mt-3 rounded-2xl border border-white/10 bg-white/[0.04] p-3 text-left text-sm leading-6 text-slate-200">
                  {selectedPostCard.message}
                </p>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}
