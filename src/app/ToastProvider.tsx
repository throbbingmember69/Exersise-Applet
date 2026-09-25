import { useCallback, useMemo, useRef, useState, type ReactNode } from 'react'
import styles from './Toast.module.css'
import { ToastContext, type ToastApi, type ToastTone } from './toastContext'

interface Toast {
  id: number
  message: string
  tone: ToastTone
}

/** Short status messages above the bottom navigation, announced to screen readers. */
export default function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([])
  const nextId = useRef(0)

  const dismiss = useCallback((id: number) => {
    setToasts((list) => list.filter((t) => t.id !== id))
  }, [])

  const show = useCallback<ToastApi['show']>(
    (message, opts = {}) => {
      const id = ++nextId.current
      setToasts((list) => [...list.slice(-2), { id, message, tone: opts.tone ?? 'neutral' }])
      setTimeout(() => dismiss(id), opts.durationMs ?? 4000)
    },
    [dismiss],
  )

  const api = useMemo(() => ({ show }), [show])

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div className={styles.viewport} role="status" aria-live="polite">
        {toasts.map((t) => (
          <button
            key={t.id}
            type="button"
            className={styles.toast}
            data-tone={t.tone}
            onClick={() => dismiss(t.id)}
          >
            {t.message}
          </button>
        ))}
      </div>
    </ToastContext.Provider>
  )
}
