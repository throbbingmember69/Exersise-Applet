// Hooks every screen uses to talk to the service layer.
import { useLiveQuery } from 'dexie-react-hooks'
import { useCallback, useContext, useEffect, useRef, useState } from 'react'
import { localDateOf } from '@/domain/dates'
import type { LocalDate, UnitSystem } from '@/domain/types'
import type { ServiceCtx } from '@/services/context'
import { isServiceError } from '@/services/errors'
import { loadProfile } from '@/services/settings'
import { ServicesContext } from './servicesContext'
import { ToastContext } from './toastContext'

export function useCtx(): ServiceCtx {
  const ctx = useContext(ServicesContext)
  if (!ctx) throw new Error('useCtx must be used inside <ServicesProvider>')
  return ctx
}

export function useToast() {
  return useContext(ToastContext)
}

/**
 * Subscribe to a service query. Re-runs whenever the database tables it read change, and when
 * `deps` change. Queries must return null (never undefined) for "nothing there", because
 * undefined means "still loading".
 */
export function useLive<T>(
  query: (ctx: ServiceCtx) => Promise<T>,
  deps: readonly unknown[],
): { data: T | undefined; loading: boolean } {
  const ctx = useCtx()
  const data = useLiveQuery(() => query(ctx), [ctx, ...deps])
  return { data, loading: data === undefined }
}

/** Today's local date; rolls over at midnight and when the app comes back to the foreground. */
export function useToday(): LocalDate {
  const ctx = useCtx()
  const [today, setToday] = useState(() => localDateOf(ctx.now()))
  useEffect(() => {
    const refresh = () => setToday(localDateOf(ctx.now()))
    const timer = setInterval(refresh, 60_000)
    document.addEventListener('visibilitychange', refresh)
    return () => {
      clearInterval(timer)
      document.removeEventListener('visibilitychange', refresh)
    }
  }, [ctx])
  return today
}

/** The display unit (lb or kg). Stored data is always lb. */
export function useUnits(): UnitSystem {
  return useLive((ctx) => loadProfile(ctx), []).data?.units ?? 'lb'
}

/**
 * Run a service command with pending state; failures become toasts. ServiceError messages are
 * shown as written; anything else gets a generic message (and is logged).
 */
export function useCommand<A extends unknown[], R>(
  command: (ctx: ServiceCtx, ...args: A) => Promise<R>,
  opts: { success?: string } = {},
): { run: (...args: A) => Promise<R | undefined>; pending: boolean; error: string | null } {
  const ctx = useCtx()
  const toast = useToast()
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Latest command without re-creating `run` on every render (callers often pass inline lambdas).
  const commandRef = useRef(command)
  useEffect(() => {
    commandRef.current = command
  })
  const success = opts.success

  const run = useCallback(
    async (...args: A) => {
      setPending(true)
      setError(null)
      try {
        const result = await commandRef.current(ctx, ...args)
        if (success) toast.show(success, { tone: 'good' })
        return result
      } catch (e) {
        const message = isServiceError(e) ? e.message : 'Something went wrong. Please try again.'
        if (!isServiceError(e)) console.error(e)
        setError(message)
        toast.show(message, { tone: 'bad' })
        return undefined
      } finally {
        setPending(false)
      }
    },
    [ctx, toast, success],
  )

  return { run, pending, error }
}
