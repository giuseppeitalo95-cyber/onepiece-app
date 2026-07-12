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

  const enablePushNotifications = async () => {
    if (busy || !vapidPublicKey) return
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

      const { data: { session } } = await supabase.auth.getSession()
      if (!session?.access_token) return

      await fetch('/api/push/subscribe', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`
        },
        body: JSON.stringify({ subscription })
      })
    } finally {
      setBusy(false)
    }
  }

  if (permission === 'unsupported') return null
  if (hideWhenGranted && permission === 'granted') return null

  const isGranted = permission === 'granted'
  const isDenied = permission === 'denied'

  return (
    <div className={`rounded-2xl border px-3 py-2 ${
      isGranted
        ? 'border-emerald-300/25 bg-emerald-300/10'
        : 'border-cyan-300/20 bg-cyan-300/[0.08]'
    } ${mode === 'profile' ? 'sm:px-4 sm:py-3' : ''}`}>
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <Bell size={16} className={isGranted ? 'text-emerald-200' : 'text-cyan-100'} />
          <div className="min-w-0">
            <p className="text-xs font-black text-white">
              {isGranted ? 'Notifiche attive' : 'Vuoi attivare le notifiche per l\'app?'}
            </p>
            {mode === 'profile' ? (
              <p className="mt-1 text-[11px] leading-5 text-slate-400">
                {isGranted
                  ? 'Puoi premere di nuovo per registrare questo dispositivo.'
                  : isDenied
                  ? 'Le notifiche sono bloccate dal browser: riattivale dalle impostazioni del dispositivo.'
                  : 'Ricevi avvisi per messaggi e novita importanti.'}
              </p>
            ) : null}
          </div>
        </div>
        <button
          type="button"
          onClick={enablePushNotifications}
          disabled={busy || isDenied}
          className={`shrink-0 rounded-xl px-3 py-2 text-xs font-black transition active:scale-95 disabled:opacity-50 ${
            isGranted
              ? 'border border-emerald-300/25 bg-emerald-300/12 text-emerald-100'
              : 'bg-cyan-300 text-slate-950'
          }`}
        >
          {busy ? 'Attivo...' : isGranted ? 'Riattiva' : 'Attiva'}
        </button>
      </div>
    </div>
  )
}
