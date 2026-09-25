// Browser storage persistence (StorageManager). Without persist(), the browser may evict IndexedDB
// under storage pressure, so the Data screen shows the status and offers to request it. Every API
// here is optional: older browsers, private windows and test environments may lack some or all of
// it, and any of the calls may reject.

/** The parts of `navigator` this module reads. */
export interface StorageNavigator {
  storage?: Partial<Pick<StorageManager, 'persist' | 'persisted' | 'estimate'>>
}

export interface StorageStatus {
  /** The browser can be asked to make storage persistent. */
  supported: boolean
  /** null when the browser can't say. */
  persisted: boolean | null
  usageBytes: number | null
  quotaBytes: number | null
}

function defaultNavigator(): StorageNavigator | undefined {
  return typeof navigator === 'undefined' ? undefined : navigator
}

export async function getStorageStatus(
  nav: StorageNavigator | undefined = defaultNavigator(),
): Promise<StorageStatus> {
  const storage = nav?.storage
  const [persisted, estimate] = await Promise.all([
    typeof storage?.persisted === 'function'
      ? attempt(() => storage.persisted!())
      : Promise.resolve(null),
    typeof storage?.estimate === 'function'
      ? attempt(() => storage.estimate!())
      : Promise.resolve(null),
  ])
  return {
    supported: typeof storage?.persist === 'function',
    persisted: typeof persisted === 'boolean' ? persisted : null,
    usageBytes: finiteOrNull(estimate?.usage),
    quotaBytes: finiteOrNull(estimate?.quota),
  }
}

/**
 * Ask the browser to keep this site's data. Returns whether storage is now persistent, or null if
 * the browser can't be asked (or the request failed).
 */
export async function requestPersistentStorage(
  nav: StorageNavigator | undefined = defaultNavigator(),
): Promise<boolean | null> {
  const storage = nav?.storage
  if (typeof storage?.persist !== 'function') return null
  const granted = await attempt(() => storage.persist!())
  return typeof granted === 'boolean' ? granted : null
}

async function attempt<T>(fn: () => Promise<T>): Promise<T | null> {
  try {
    return await fn()
  } catch {
    return null
  }
}

function finiteOrNull(x: unknown): number | null {
  return typeof x === 'number' && Number.isFinite(x) ? x : null
}
