self.addEventListener('install', () => {
  self.skipWaiting()
})

self.addEventListener('activate', event => {
  event.waitUntil(self.clients.claim())
})

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
    tag: data.tag || undefined,
    renotify: Boolean(data.tag),
    data: {
      url: data.url || '/'
    }
  }

  const notify = self.registration.showNotification(title, options)
  const updateOpenClients = clients
    .matchAll({ type: 'window', includeUncontrolled: true })
    .then(openClients => Promise.all(openClients.map(client => client.postMessage({
      type: 'opv:push',
      title,
      body: options.body,
      url: options.data.url
    }))))

  event.waitUntil(Promise.all([notify, updateOpenClients]))
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
