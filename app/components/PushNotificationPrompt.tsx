'use client'

import { useEffect, useState } from 'react'
import { Bell } from 'lucide-react'
import { supabase } from '@/lib/supabase'

type PushNotificationPromptProps = {
  mode?: 'compact' | 'profile'
  hideWhenGranted?: boolean
}

export default function PushNotificationPrompt({
  mode = 'compact',
  hideWhenGranted = false
}: PushNotificationPromptProps) {
  const [permission, setPermission] = useState<NotificationPermission | 'unsupported'>('unsupported')
  const [registered, setRegistered] = useState(false)
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const vapidPublicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY || ''

  useEffect(() => {
    const supported =
      typeof window !== 'undefined' &&
      'serviceWorker' in navigator &&
      'PushManager' in window &&
      'Notification' in window &&
      Boolean(vapidPublicKey)

    setPermission(supported ? Notification.permission : 'unsupported')
    setRegistered(typeof window !== 'undefined' && window.localStorage.getItem('opv_push_registered') === '1')
  }, [vapidPublicKey])

  const urlBase64ToUint8Array = (base64String: string) => {
    const padding = '='.repeat((4 - base64String.length % 4) % 4)
    const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/')
    const rawData = window.atob(base64)
    const outputArray = new Uint8Array(rawData.length)
    for (let i = 0; i < rawData.length; i += 1) {
      outputArray[i] = rawData.charCodeAt(i)
    }
    return outputArray
  }

  const getFreshAccessToken = async () => {
    const { data: sessionData } = await supabase.auth.getSession()
    if (!sessionData.session?.access_token) return ''

    const { data: refreshData, error } = await supabase.auth.refreshSession()
    if (!error && refreshData.session?.access_token) {
      return refreshData.session.access_token
    }

    return sessionData.session.access_token
  }

  const enablePushNotifications = async () => {
    if (busy || !vapidPublicKey) return
    setMessage('')
    if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) {
      setPermission('unsupported')
      return
    }

    setBusy(true)
    try {
      const nextPermission = await Notification.requestPermission()
      setPermission(nextPermission)
      if (nextPermission !== 'granted') return

      const registration = await navigator.serviceWorker.register('/opv-sw.js')
      const existingSubscription = await registration.pushManager.getSubscription()
      const subscription = existingSubscription || await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(vapidPublicKey)
      })

      const accessToken = await getFreshAccessToken()
      if (!accessToken) {
        setMessage('Accedi di nuovo e riprova.')
        return
      }

      const res = await fetch('/api/push/subscribe', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`
        },
        body: JSON.stringify({ subscription })
      })
      const data = await res.json().catch(() => null)
      if (!res.ok || !data?.ok) {
        setRegistered(false)
        window.localStorage.removeItem('opv_push_registered')
        setMessage(data?.error === 'Invalid session'
          ? 'Sessione scaduta: disconnettiti e accedi di nuovo, poi premi Riattiva.'
          : data?.error || 'Non sono riuscito ad attivare le notifiche.')
        return
      }

      setRegistered(true)
      window.localStorage.setItem('opv_push_registered', '1')
      setMessage('Notifiche attivate su questo dispositivo.')
    } catch {
      setMessage('Non sono riuscito ad attivare le notifiche. Riprova tra poco.')
    } finally {
      setBusy(false)
    }
  }

  if (permission === 'unsupported') return null
  if (hideWhenGranted && permission === 'granted' && registered) return null

  const isGranted = permission === 'granted'
  const isDenied = permission === 'denied'
  const isActive = isGranted && registered

  return (
    <div className={`rounded-2xl border px-3 py-2 ${
      isActive
        ? 'border-emerald-300/25 bg-emerald-300/10'
        : 'border-cyan-300/20 bg-cyan-300/[0.08]'
    } ${mode === 'profile' ? 'sm:px-4 sm:py-3' : ''}`}>
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <Bell size={16} className={isActive ? 'text-emerald-200' : 'text-cyan-100'} />
          <div className="min-w-0">
            <p className="text-xs font-black text-white">
              {isActive ? 'Notifiche attive' : 'Vuoi attivare le notifiche per l\'app?'}
            </p>
            {mode === 'profile' ? (
              <p className="mt-1 text-[11px] leading-5 text-slate-400">
                {message || (isActive
                  ? 'Puoi premere di nuovo per registrare questo dispositivo.'
                  : isDenied
                  ? 'Le notifiche sono bloccate dal browser: riattivale dalle impostazioni del dispositivo.'
                  : isGranted
                  ? 'Permesso concesso: premi Riattiva per collegare questo dispositivo.'
                  : 'Ricevi avvisi per messaggi e novita importanti.')}
              </p>
            ) : null}
            {mode !== 'profile' && message ? (
              <p className="mt-1 text-[11px] leading-5 text-slate-400">{message}</p>
            ) : null}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <button
            type="button"
            onClick={enablePushNotifications}
            disabled={busy || isDenied}
            className={`rounded-xl px-3 py-2 text-xs font-black transition active:scale-95 disabled:opacity-50 ${
              isActive
                ? 'border border-emerald-300/25 bg-emerald-300/12 text-emerald-100'
                : 'bg-cyan-300 text-slate-950'
            }`}
          >
            {busy ? 'Attivo...' : isActive || isGranted ? 'Riattiva' : 'Attiva'}
          </button>
        </div>
      </div>
    </div>
  )
}
