/// <reference lib="webworker" />
// Service worker: precaches the whole app for offline use and brings the app to the front when a
// rest-timer notification is tapped. New versions wait until the app asks them to take over.
import { cleanupOutdatedCaches, precacheAndRoute } from 'workbox-precaching'

declare const self: ServiceWorkerGlobalScope

cleanupOutdatedCaches()
precacheAndRoute(self.__WB_MANIFEST)

self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') void self.skipWaiting()
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const target = new URL(
    (event.notification.data as { url?: string } | null)?.url ?? '',
    self.registration.scope,
  ).href
  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
      const existing = windows.find((w) => w.url.startsWith(self.registration.scope))
      if (existing) {
        await existing.focus()
        if (existing.url !== target) await existing.navigate(target).catch(() => null)
        return
      }
      await self.clients.openWindow(target)
    })(),
  )
})
