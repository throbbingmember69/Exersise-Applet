import { describe, expect, it, vi } from 'vitest'
import { getStorageStatus, requestPersistentStorage, type StorageNavigator } from './storage'

/** A StorageManager stand-in whose methods need `this`, like the real one. */
class FakeStorage {
  calls = 0
  constructor(
    private persistedNow: boolean,
    private readonly grant: boolean,
    private readonly est: StorageEstimate,
  ) {}
  async persisted(): Promise<boolean> {
    return this.persistedNow
  }
  async persist(): Promise<boolean> {
    this.calls++
    this.persistedNow = this.grant
    return this.grant
  }
  async estimate(): Promise<StorageEstimate> {
    return this.est
  }
}

const EMPTY = { supported: false, persisted: null, usageBytes: null, quotaBytes: null }

describe('getStorageStatus', () => {
  it('reports persistence and usage from the StorageManager', async () => {
    const storage = new FakeStorage(false, true, { usage: 1_234_567, quota: 2_000_000_000 })
    expect(await getStorageStatus({ storage })).toEqual({
      supported: true,
      persisted: false,
      usageBytes: 1_234_567,
      quotaBytes: 2_000_000_000,
    })
  })

  it('tolerates a browser without the Storage API', async () => {
    expect(await getStorageStatus(undefined)).toEqual(EMPTY)
    expect(await getStorageStatus({})).toEqual(EMPTY)
    expect(await getStorageStatus({ storage: {} })).toEqual(EMPTY)
  })

  it('tolerates a partial API and missing estimate fields', async () => {
    const nav: StorageNavigator = { storage: { estimate: async () => ({ usage: 42 }) } }
    expect(await getStorageStatus(nav)).toEqual({
      supported: false,
      persisted: null,
      usageBytes: 42,
      quotaBytes: null,
    })
  })

  it('reports unknowns when the calls fail', async () => {
    const nav: StorageNavigator = {
      storage: {
        persist: vi.fn(async () => true),
        persisted: () => Promise.reject(new Error('SecurityError')),
        estimate: () => Promise.reject(new Error('SecurityError')),
      },
    }
    expect(await getStorageStatus(nav)).toEqual({
      supported: true,
      persisted: null,
      usageBytes: null,
      quotaBytes: null,
    })
    expect(nav.storage!.persist).not.toHaveBeenCalled()
  })

  it('works with the environment default', async () => {
    const status = await getStorageStatus()
    expect(typeof status.supported).toBe('boolean')
  })
})

describe('requestPersistentStorage', () => {
  it('asks the browser and reports whether it agreed', async () => {
    const granted = new FakeStorage(false, true, {})
    expect(await requestPersistentStorage({ storage: granted })).toBe(true)
    expect(granted.calls).toBe(1)
    expect((await getStorageStatus({ storage: granted })).persisted).toBe(true)

    const denied = new FakeStorage(false, false, {})
    expect(await requestPersistentStorage({ storage: denied })).toBe(false)
  })

  it('returns null when it cannot ask', async () => {
    expect(await requestPersistentStorage(undefined)).toBeNull()
    expect(await requestPersistentStorage({ storage: {} })).toBeNull()
    const failing: StorageNavigator = {
      storage: { persist: () => Promise.reject(new Error('NotAllowedError')) },
    }
    expect(await requestPersistentStorage(failing)).toBeNull()
  })
})
