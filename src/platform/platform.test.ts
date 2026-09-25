import { afterEach, describe, expect, it, vi } from 'vitest'
import { startRest } from '@/domain/restTimer'
import { vibrate } from './feedback'
import { download, readFileText, saveOrShare } from './files'
import { scheduleRestAlerts, type RestAlertDeps } from './restAlerts'
import { keepScreenOn, wakeLockSupported } from './wakeLock'

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

function fakeDeps(visible: boolean): RestAlertDeps & { log: string[] } {
  const log: string[] = []
  return {
    log,
    now: () => Date.now(),
    isVisible: () => visible,
    setTimer: (fn, ms) => setTimeout(fn, ms),
    clearTimer: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
    vibrate: (p) => void log.push(`vibrate:${p.join(',')}`),
    beep: () => void log.push('beep'),
    notify: async (kind) => {
      log.push(`notify:${kind}`)
      return true
    },
  }
}

describe('scheduleRestAlerts', () => {
  it('alerts at the minimum and maximum rest while visible', () => {
    vi.useFakeTimers({ now: 1_000_000 })
    const deps = fakeDeps(true)
    const seen: string[] = []
    scheduleRestAlerts(startRest(Date.now(), { restMinSec: 120, restMaxSec: 180 }), deps, (k) =>
      seen.push(k),
    )
    vi.advanceTimersByTime(119_999)
    expect(seen).toEqual([])
    vi.advanceTimersByTime(1)
    expect(seen).toEqual(['min'])
    vi.advanceTimersByTime(60_000)
    expect(seen).toEqual(['min', 'max'])
    expect(deps.log.filter((l) => l === 'beep')).toHaveLength(2)
  })

  it('uses a notification when the page is hidden', () => {
    vi.useFakeTimers({ now: 0 })
    const deps = fakeDeps(false)
    scheduleRestAlerts(startRest(0, { restMinSec: 90, restMaxSec: 90 }), deps)
    vi.advanceTimersByTime(90_000)
    expect(deps.log).toEqual(['notify:min'])
  })

  it('skips alerts already in the past (after a reload)', () => {
    // Reloaded 150 s into a 2:00–3:00 rest: the 2:00 alert is gone, the 3:00 one still fires.
    vi.useFakeTimers({ now: 150_000 })
    const seen: string[] = []
    scheduleRestAlerts(startRest(0, { restMinSec: 120, restMaxSec: 180 }), fakeDeps(true), (k) =>
      seen.push(k),
    )
    vi.advanceTimersByTime(29_999)
    expect(seen).toEqual([])
    vi.advanceTimersByTime(1)
    expect(seen).toEqual(['max'])
  })

  it('can be cancelled', () => {
    vi.useFakeTimers({ now: 0 })
    const seen: string[] = []
    const cancel = scheduleRestAlerts(
      startRest(0, { restMinSec: 120, restMaxSec: 180 }),
      fakeDeps(true),
      (k) => seen.push(k),
    )
    cancel()
    vi.advanceTimersByTime(300_000)
    expect(seen).toEqual([])
  })
})

describe('feedback', () => {
  it('vibrates when supported and tolerates absence', () => {
    const calls: unknown[] = []
    expect(
      vibrate(200, { vibrate: (p: unknown) => (calls.push(p), true) } as unknown as Navigator),
    ).toBe(true)
    expect(calls).toEqual([200])
    expect(vibrate(200, {} as Navigator)).toBe(false)
  })
})

describe('wake lock', () => {
  it('acquires, re-acquires on visibility and releases', async () => {
    const requests: string[] = []
    let released = 0
    const nav = {
      wakeLock: {
        request: async (t: string) => {
          requests.push(t)
          return { release: async () => void released++ }
        },
      },
    } as unknown as Navigator
    expect(wakeLockSupported(nav)).toBe(true)
    const handle = await keepScreenOn(nav, document)
    expect(handle).not.toBeNull()
    document.dispatchEvent(new Event('visibilitychange'))
    await Promise.resolve()
    expect(requests.length).toBeGreaterThanOrEqual(1)
    await handle!.release()
    expect(released).toBe(1)
  })

  it('returns null when unsupported or refused', async () => {
    expect(await keepScreenOn({} as Navigator, document)).toBeNull()
    const refusing = {
      wakeLock: { request: async () => Promise.reject(new Error('NotAllowedError')) },
    } as unknown as Navigator
    expect(await keepScreenOn(refusing, document)).toBeNull()
  })
})

describe('files', () => {
  const file = { fileName: 'exersise-sets-2026-09-24.csv', mimeType: 'text/csv', text: 'a,b\r\n' }

  it('shares through the share sheet when files can be shared', async () => {
    const shared: unknown[] = []
    const nav = {
      canShare: () => true,
      share: async (d: unknown) => void shared.push(d),
    } as unknown as Navigator
    expect(await saveOrShare(file, {}, nav)).toBe('shared')
    expect(shared).toHaveLength(1)
  })

  it('reports a cancelled share and falls back to download on other errors', async () => {
    const cancel = {
      canShare: () => true,
      share: async () => Promise.reject(new DOMException('no', 'AbortError')),
    } as unknown as Navigator
    expect(await saveOrShare(file, {}, cancel)).toBe('cancelled')
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:x')
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
    const broken = {
      canShare: () => true,
      share: async () => Promise.reject(new Error('boom')),
    } as unknown as Navigator
    expect(await saveOrShare(file, {}, broken)).toBe('downloaded')
    expect(await saveOrShare(file, { preferShare: false }, {} as Navigator)).toBe('downloaded')
  })

  it('downloads through a temporary link', () => {
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:y')
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
    const clicks: string[] = []
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
      this: HTMLAnchorElement,
    ) {
      clicks.push(this.download)
    })
    expect(download(new Blob(['x']), 'backup.json')).toBe('downloaded')
    expect(clicks).toEqual(['backup.json'])
    expect(document.querySelector('a[download]')).toBeNull()
  })

  it('reads a chosen file as text', async () => {
    expect(await readFileText(new Blob(['{"format":"x"}']))).toBe('{"format":"x"}')
  })
})
