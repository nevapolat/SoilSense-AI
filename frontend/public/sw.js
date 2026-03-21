// Disable SW runtime caching to avoid stale UI bundles.
// On activate: clear existing SoilSense caches and unregister.
self.addEventListener('install', (event) => {
  console.log('[SoilSense SW] install: skipWaiting')
  event.waitUntil(self.skipWaiting())
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      console.log('[SoilSense SW] activate: clearing soilsense-pwa caches + unregister')
      const keys = await caches.keys()
      await Promise.all(
        keys
          .filter((k) => k.startsWith('soilsense-pwa-'))
          .map((k) => caches.delete(k))
      )
      await self.registration.unregister()
      const clients = await self.clients.matchAll({ type: 'window' })
      for (const client of clients) {
        client.postMessage({ type: 'SW_DISABLED_AND_CACHES_CLEARED' })
      }
    })()
  )
})

