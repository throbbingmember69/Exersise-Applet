// Screen Wake Lock: keeps the phone awake during a workout so the rest timer stays on screen and
// its timers aren't frozen. The browser drops the lock whenever the page is hidden, so it is
// re-acquired when the page becomes visible again.

export interface WakeLockHandle {
  /** Stop keeping the screen awake. */
  release: () => Promise<void>
}

type WakeLockApi = { request: (type: 'screen') => Promise<{ release: () => Promise<void> }> }

export function wakeLockSupported(nav: Navigator = navigator): boolean {
  return (
    'wakeLock' in nav && typeof (nav as { wakeLock?: WakeLockApi }).wakeLock?.request === 'function'
  )
}

/** Keep the screen on until released. Returns null when unsupported or refused. */
export async function keepScreenOn(
  nav: Navigator = navigator,
  doc: Document = document,
): Promise<WakeLockHandle | null> {
  if (!wakeLockSupported(nav)) return null
  const api = (nav as unknown as { wakeLock: WakeLockApi }).wakeLock
  let sentinel: { release: () => Promise<void> } | null = null
  let released = false

  const acquire = async () => {
    try {
      sentinel = await api.request('screen')
      return true
    } catch {
      sentinel = null
      return false
    }
  }
  const onVisible = () => {
    if (!released && doc.visibilityState === 'visible') void acquire()
  }

  if (!(await acquire())) return null
  doc.addEventListener('visibilitychange', onVisible)
  return {
    release: async () => {
      released = true
      doc.removeEventListener('visibilitychange', onVisible)
      const s = sentinel
      sentinel = null
      await s?.release().catch(() => {})
    },
  }
}
