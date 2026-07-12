self.addEventListener('push', event => {
  let data = {}

  try {
    data = event.data ? event.data.json() : {}
  } catch {
    data = {}
  }

  const title = data.title || 'OnePiece Vault'
  const options = {
    body: data.body || 'Hai una nuova notifica.',
    icon: '/icon-192.png',
    badge: '/icon-192.png',
    data: {
      url: data.url || '/'
    }
  }

  event.waitUntil(self.registration.showNotification(title, options))
})

self.addEventListener('notificationclick', event => {
  event.notification.close()
  const targetUrl = event.notification.data?.url || '/'

  event.waitUntil((async () => {
    const clientsList = await clients.matchAll({ type: 'window', includeUncontrolled: true })
    const existing = clientsList.find(client => client.url.includes(self.location.origin))

    if (existing) {
      await existing.focus()
      existing.postMessage({ type: 'opv:navigate', url: targetUrl })
      return
    }

    await clients.openWindow(targetUrl)
  })())
})
