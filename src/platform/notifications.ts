// System notifications for the rest timer while the app is in the background. On Android Chrome
// they must go through the service worker registration (`new Notification()` throws there), so
// without an active service worker this reports false and the in-app alert is all you get.

export type NotificationPermissionState = 'granted' | 'denied' | 'default' | 'unsupported'

export function notificationPermission(): NotificationPermissionState {
  if (typeof Notification === 'undefined') return 'unsupported'
  return Notification.permission
}

/** Ask for permission. Call from a user gesture. */
export async function requestNotificationPermission(): Promise<NotificationPermissionState> {
  if (typeof Notification === 'undefined') return 'unsupported'
  if (Notification.permission !== 'default') return Notification.permission
  try {
    return await Notification.requestPermission()
  } catch {
    return notificationPermission()
  }
}

export interface RestNotification {
  title: string
  body: string
  /** Replaces an earlier notification with the same tag instead of stacking. */
  tag: string
  /** Route to open when the notification is tapped (handled by the service worker). */
  url: string
}

/** Show a notification through the service worker. Returns whether one was shown. */
export async function showNotification(
  n: RestNotification,
  nav: Navigator = navigator,
): Promise<boolean> {
  if (notificationPermission() !== 'granted' || !('serviceWorker' in nav)) return false
  try {
    const reg = await nav.serviceWorker.getRegistration()
    if (!reg) return false
    await reg.showNotification(n.title, {
      body: n.body,
      tag: n.tag,
      // renotify/vibrate are honored by Android Chrome; not in every TS DOM lib version.
      ...({ renotify: true, vibrate: [200, 100, 200] } as NotificationOptions),
      data: { url: n.url },
      icon: 'pwa-192x192.png',
    })
    return true
  } catch {
    return false
  }
}

/** Close notifications with a tag (e.g. when the user comes back before the alert). */
export async function closeNotifications(tag: string, nav: Navigator = navigator): Promise<void> {
  if (!('serviceWorker' in nav)) return
  try {
    const reg = await nav.serviceWorker.getRegistration()
    for (const n of (await reg?.getNotifications({ tag })) ?? []) n.close()
  } catch {
    // Nothing to close.
  }
}
