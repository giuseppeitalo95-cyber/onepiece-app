'use client'

import { useCallback, useEffect, useState } from 'react'
import { Bell } from 'lucide-react'
import { supabase } from '@/lib/supabase'

type PushNotificationPromptProps = {
  mode?: 'compact' | 'profile'
  hideWhenGranted?: boolean
  silent?: boolean
}

const PUSH_KEY_STORAGE = 'opv_push_vapid_key'

const urlBase64ToUint8Array = (base64String: string) => {
  const padding = '='.repeat((4 - base64String.length % 4) % 4)
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/')
  const rawData = window.atob(base64)
  return Uint8Array.from(rawData, character => character.charCodeAt(0))
}

const sameApplicationServerKey = (subscription: PushSubscription, expected: Uint8Array) => {
  const current = subscription.options.applicationServerKey
  if (!current) return false
  const currentBytes = new Uint8Array(current)
  return currentBytes.length === expected.length && currentBytes.every((value, index) => value === expected[index])
}

export default function PushNotificationPrompt({
  mode = 'compact',
  hideWhenGranted = false,
  silent = false,
}: PushNotificationPromptProps) {
  const [permission, setPermission] = useState<NotificationPermission | 'unsupported'>(() =>
    typeof window !== 'undefined' && 'Notification' in window ? Notification.permission : 'unsupported'
  )
  const [registered, setRegistered] = useState(() =>
    typeof window !== 'undefined'
      && Notification.permission === 'granted'
      && window.localStorage.getItem('opv_push_registered') === '1'
  )
  const [installRequired, setInstallRequired] = useState(false)
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const vapidPublicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY || ''

  const syncSubscription = useCallback(async (askPermission: boolean, showFeedback: boolean) => {
    if (!vapidPublicKey || !('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) {
      setPermission('unsupported')
      return false
    }

    const ios = /iPad|iPhone|iPod/.test(navigator.userAgent)
      || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
    const standalone = window.matchMedia('(display-mode: standalone)').matches
      || Boolean((navigator as Navigator & { standalone?: boolean }).standalone)
    if (ios && !standalone) {
      setInstallRequired(true)
      if (showFeedback) setMessage('Su iPhone installa prima OPV dalla schermata Condividi > Aggiungi alla schermata Home.')
      return false
    }

    setInstallRequired(false)
    const nextPermission = askPermission ? await Notification.requestPermission() : Notification.permission
    setPermission(nextPermission)
    if (nextPermission !== 'granted') return false

    const registration = await navigator.serviceWorker.register('/opv-sw.js', { updateViaCache: 'none' })
    await registration.update().catch(() => undefined)
    const expectedKey = urlBase64ToUint8Array(vapidPublicKey)
    let subscription = await registration.pushManager.getSubscription()
    const storedKey = window.localStorage.getItem(PUSH_KEY_STORAGE)

    if (subscription && (storedKey !== vapidPublicKey || !sameApplicationServerKey(subscription, expectedKey))) {
      await subscription.unsubscribe().catch(() => false)
      subscription = null
    }

    if (!subscription) {
      subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: expectedKey,
      })
    }

    const postSubscription = async (accessToken: string) => fetch('/api/push/subscribe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
      body: JSON.stringify({ subscription }),
    })

    let { data: sessionData } = await supabase.auth.getSession()
    if (!sessionData.session?.access_token) return false
    let response = await postSubscription(sessionData.session.access_token)

    if (response.status === 401) {
      const refreshed = await supabase.auth.refreshSession()
      if (refreshed.data.session?.access_token) {
        sessionData = refreshed.data
        response = await postSubscription(refreshed.data.session.access_token)
      }
    }

    const result = await response.json().catch(() => null)
    if (!response.ok || !result?.ok) {
      setRegistered(false)
      if (showFeedback) setMessage(result?.error || 'Non sono riuscito a collegare questo dispositivo.')
      return false
    }

    window.localStorage.setItem(PUSH_KEY_STORAGE, vapidPublicKey)
    window.localStorage.setItem('opv_push_registered', '1')
    setRegistered(true)
    if (showFeedback) setMessage('Notifiche attivate su questo dispositivo.')
    return true
  }, [vapidPublicKey])

  useEffect(() => {
    const supported = typeof window !== 'undefined'
      && 'serviceWorker' in navigator
      && 'PushManager' in window
      && 'Notification' in window
      && Boolean(vapidPublicKey)

    if (!supported) {
      return
    }

    const initialSync = window.setTimeout(() => {
      if (Notification.permission === 'granted') {
        void syncSubscription(false, false).catch(() => setRegistered(false))
      }
    }, 0)

    const resync = () => {
      if (document.visibilityState === 'visible' && Notification.permission === 'granted') {
        void syncSubscription(false, false).catch(() => setRegistered(false))
      }
    }
    document.addEventListener('visibilitychange', resync)
    return () => {
      window.clearTimeout(initialSync)
      document.removeEventListener('visibilitychange', resync)
    }
  }, [syncSubscription, vapidPublicKey])

  const enablePushNotifications = async () => {
    if (busy) return
    setBusy(true)
    setMessage('')
    try {
      await syncSubscription(true, true)
    } catch {
      setRegistered(false)
      setMessage('Non sono riuscito ad attivare le notifiche. Riprova tra poco.')
    } finally {
      setBusy(false)
    }
  }

  if (permission === 'unsupported') return null
  if (silent) return null
  // The compact collection prompt must not flash on every navigation while
  // the existing subscription is being checked and repaired in background.
  if (hideWhenGranted && permission === 'granted') return null

  const isDenied = permission === 'denied'
  const isActive = permission === 'granted' && registered

  return (
    <div className={`rounded-2xl border px-3 py-2 ${isActive ? 'border-emerald-300/25 bg-emerald-300/10' : 'border-cyan-300/20 bg-cyan-300/[0.08]'} ${mode === 'profile' ? 'sm:px-4 sm:py-3' : ''}`}>
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <Bell size={16} className={isActive ? 'text-emerald-200' : 'text-cyan-100'} />
          <div className="min-w-0">
            <p className="text-xs font-black text-white">
              {isActive ? 'Notifiche attive' : 'Vuoi attivare le notifiche per l’app?'}
            </p>
            {(mode === 'profile' || message || installRequired) ? (
              <p className="mt-1 text-[11px] leading-5 text-slate-400">
                {message || (isActive
                  ? 'La sottoscrizione di questo dispositivo viene verificata automaticamente.'
                  : isDenied
                    ? 'Le notifiche sono bloccate: riattivale nelle impostazioni del browser o del dispositivo.'
                    : installRequired
                      ? 'Su iPhone le notifiche funzionano dall’app installata nella schermata Home.'
                      : 'Ricevi avvisi per messaggi e novità importanti.')}
              </p>
            ) : null}
          </div>
        </div>
        <button
          type="button"
          onClick={enablePushNotifications}
          disabled={busy || isDenied}
          className={`shrink-0 rounded-xl px-3 py-2 text-xs font-black transition active:scale-95 disabled:opacity-50 ${isActive ? 'border border-emerald-300/25 bg-emerald-300/12 text-emerald-100' : 'bg-cyan-300 text-slate-950'}`}
        >
          {busy ? 'Attivo...' : isActive ? 'Verifica' : 'Attiva'}
        </button>
      </div>
    </div>
  )
}
