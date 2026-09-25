import { describe, expect, it } from 'vitest'
import { DEFAULT_SETTINGS } from '@/domain/settings/registry'
import {
  alertTimes as alertTimesRaw,
  extendRest as extendRestRaw,
  restView as restViewRaw,
  startRest as startRestRaw,
  type RestTimer,
} from './restTimer'

/** Recursively freezes a test input so any mutation throws (proves the functions are pure). */
function deepFreeze<T>(x: T, seen = new WeakSet<object>()): T {
  if (x !== null && typeof x === 'object' && !seen.has(x)) {
    seen.add(x)
    for (const v of Object.values(x)) deepFreeze(v, seen)
    Object.freeze(x)
  }
  return x
}

// The rest-timer functions, called on frozen inputs.
const startRest: typeof startRestRaw = (now, regime) => startRestRaw(now, deepFreeze(regime))
const extendRest: typeof extendRestRaw = (t, s) => extendRestRaw(deepFreeze(t), deepFreeze(s))
const restView: typeof restViewRaw = (t, now) => restViewRaw(deepFreeze(t), now)
const alertTimes: typeof alertTimesRaw = (t) => alertTimesRaw(deepFreeze(t))

const T0 = Date.UTC(2026, 8, 28, 17)
const SEC = 1000
// Smith machine squat: rest 2–3 min.
const SQUAT_REST = startRest(T0, { restMinSec: 120, restMaxSec: 180 })

describe('startRest / extendRest', () => {
  it('starts at the given time with no extension', () => {
    expect(SQUAT_REST).toEqual({ startedAt: T0, restMinSec: 120, restMaxSec: 180, extendedSec: 0 })
  })

  it('adds the configured extension (30 s) each time', () => {
    const once = extendRest(SQUAT_REST, DEFAULT_SETTINGS)
    expect(once.extendedSec).toBe(30)
    expect(extendRest(once, DEFAULT_SETTINGS).extendedSec).toBe(60)
    expect(SQUAT_REST.extendedSec).toBe(0)
  })
})

describe('restView', () => {
  it('counts down to the minimum, then the maximum', () => {
    expect(restView(SQUAT_REST, T0)).toEqual({
      stage: 'rest',
      msToMin: 120 * SEC,
      msToMax: 180 * SEC,
      elapsedMs: 0,
    })
    expect(restView(SQUAT_REST, T0 + 90 * SEC)).toEqual({
      stage: 'rest',
      msToMin: 30 * SEC,
      msToMax: 90 * SEC,
      elapsedMs: 90 * SEC,
    })
    expect(restView(SQUAT_REST, T0 + 120 * SEC)).toMatchObject({
      stage: 'min',
      msToMin: 0,
      msToMax: 60 * SEC,
    })
    expect(restView(SQUAT_REST, T0 + 180 * SEC)).toMatchObject({
      stage: 'max',
      msToMin: 0,
      msToMax: 0,
    })
  })

  it('catches up after the page was hidden', () => {
    expect(restView(SQUAT_REST, T0 + 220 * SEC)).toEqual({
      stage: 'max',
      msToMin: 0,
      msToMax: 0,
      elapsedMs: 220 * SEC,
    })
  })

  it('shifts both marks by the extension', () => {
    const t = extendRest(SQUAT_REST, DEFAULT_SETTINGS)
    expect(restView(t, T0 + 120 * SEC)).toMatchObject({ stage: 'rest', msToMin: 30 * SEC })
    expect(restView(t, T0 + 150 * SEC).stage).toBe('min')
    expect(restView(t, T0 + 210 * SEC).stage).toBe('max')
  })

  it('reaches "max" directly when the rest is a single value', () => {
    const t = startRest(T0, { restMinSec: 90, restMaxSec: 90 })
    expect(restView(t, T0 + 89 * SEC).stage).toBe('rest')
    expect(restView(t, T0 + 90 * SEC).stage).toBe('max')
  })

  it('never reports negative elapsed time if the clock moved backwards', () => {
    expect(restView(SQUAT_REST, T0 - 5 * SEC)).toMatchObject({ stage: 'rest', elapsedMs: 0 })
  })
})

describe('alertTimes', () => {
  it('alerts at the minimum and again at the maximum (2:00 and 3:00)', () => {
    expect(alertTimes(SQUAT_REST)).toEqual([T0 + 120 * SEC, T0 + 180 * SEC])
  })

  it('alerts once when the rest is a single value, or the maximum is below the minimum', () => {
    expect(alertTimes(startRest(T0, { restMinSec: 90, restMaxSec: 90 }))).toEqual([T0 + 90 * SEC])
    const odd: RestTimer = { startedAt: T0, restMinSec: 120, restMaxSec: 60, extendedSec: 0 }
    expect(alertTimes(odd)).toEqual([T0 + 120 * SEC])
  })

  it('shifts both alerts by +30 s extensions', () => {
    const t = extendRest(SQUAT_REST, DEFAULT_SETTINGS)
    expect(alertTimes(t)).toEqual([T0 + 150 * SEC, T0 + 210 * SEC])
  })
})
