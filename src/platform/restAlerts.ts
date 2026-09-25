// Fires the rest-timer alerts at the timer's minimum and maximum rest. Timers are single-shot
// setTimeouts computed from timestamps (Chrome throttles chained timers in hidden pages far more),
// and callers re-schedule from the same RestTimer after a reload or when the page becomes visible,
// so the countdown is always right even if an alert was late.
//
// Visible page: vibrate + beep + onAlert callback (the logger shows a banner).
// Hidden page: a service-worker notification (tap returns to the logger).
import { alertTimes, type RestTimer } from '@/domain/restTimer'
import type { EpochMs } from '@/domain/types'
import { beep, vibrate } from './feedback'
import { closeNotifications, showNotification } from './notifications'

export const REST_NOTIFICATION_TAG = 'rest-timer'

export type RestAlertKind = 'min' | 'max'

export interface RestAlertDeps {
  now: () => EpochMs
  isVisible: () => boolean
  setTimer: (fn: () => void, ms: number) => unknown
  clearTimer: (handle: unknown) => void
  vibrate: (pattern: number[]) => void
  beep: () => void
  notify: (kind: RestAlertKind) => Promise<boolean>
}

export function browserRestAlertDeps(loggerUrl: string): RestAlertDeps {
  return {
    now: () => Date.now(),
    isVisible: () => document.visibilityState === 'visible',
    setTimer: (fn, ms) => setTimeout(fn, ms),
    clearTimer: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
    vibrate: (p) => void vibrate(p),
    beep,
    notify: (kind) =>
      showNotification({
        title: kind === 'min' ? 'Rest done' : 'Rest over — next set',
        body: kind === 'min' ? 'Minimum rest reached.' : 'Maximum rest reached.',
        tag: REST_NOTIFICATION_TAG,
        url: loggerUrl,
      }),
  }
}

/**
 * Schedule the alerts still ahead of `now`. Returns a cancel function. Alerts whose time has
 * already passed are not fired again (the countdown UI shows how long ago rest ended).
 */
export function scheduleRestAlerts(
  timer: RestTimer,
  deps: RestAlertDeps,
  onAlert: (kind: RestAlertKind) => void = () => {},
): () => void {
  const times = alertTimes(timer)
  const kinds: RestAlertKind[] = times.length > 1 ? ['min', 'max'] : ['min']
  const handles: unknown[] = []
  const now = deps.now()
  times.forEach((at, i) => {
    const delay = at - now
    if (delay < 0) return
    const kind = kinds[i] ?? 'max'
    handles.push(
      deps.setTimer(() => {
        if (deps.isVisible()) {
          deps.vibrate(kind === 'min' ? [200, 100, 200] : [400, 150, 400])
          deps.beep()
          onAlert(kind)
        } else {
          void deps.notify(kind)
        }
      }, delay),
    )
  })
  return () => {
    for (const h of handles) deps.clearTimer(h)
  }
}

/** Remove a stale "rest done" notification once the user is back in the app. */
export function clearRestNotification(): Promise<void> {
  return closeNotifications(REST_NOTIFICATION_TAG)
}
