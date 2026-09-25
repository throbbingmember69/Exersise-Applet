import { useEffect } from 'react'
import { useRegisterSW } from 'virtual:pwa-register/react'
import { hasSessionInProgress } from '@/services/app'
import styles from './Toast.module.css'
import { useLive, useToast } from './hooks'

/**
 * Registers the service worker. When a new version is ready it offers a reload, but never while a
 * workout is in progress (the offer appears once the session is finished).
 */
export default function UpdatePrompt() {
  const toast = useToast()
  const {
    needRefresh: [needRefresh],
    offlineReady: [offlineReady, setOfflineReady],
    updateServiceWorker,
  } = useRegisterSW()
  const busy = useLive((ctx) => hasSessionInProgress(ctx), []).data ?? true

  useEffect(() => {
    if (!offlineReady) return
    toast.show('Ready to work offline', { tone: 'good' })
    setOfflineReady(false)
  }, [offlineReady, setOfflineReady, toast])

  if (!needRefresh || busy) return null
  return (
    <div className={styles.viewport}>
      <button
        type="button"
        className={styles.toast}
        data-tone="good"
        onClick={() => void updateServiceWorker(true)}
      >
        A new version is ready — tap to reload
      </button>
    </div>
  )
}
