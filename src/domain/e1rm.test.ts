import { describe, expect, it } from 'vitest'
import {
  compareMetric,
  epley,
  metricKind,
  sessionMetric,
  setStrength,
  type MetricKind,
  type MetricValue,
  type StrengthContext,
} from './e1rm'
import { DEFAULT_SETTINGS, resolveSettings } from '@/domain/settings/registry'

/** Recursively freezes a test input so any mutation throws (proves the functions are pure). */
function deepFreeze<T>(x: T, seen = new WeakSet<object>()): T {
  if (x !== null && typeof x === 'object' && !seen.has(x)) {
    seen.add(x)
    for (const v of Object.values(x)) deepFreeze(v, seen)
    Object.freeze(x)
  }
  return x
}

type SetLike = Parameters<typeof setStrength>[0]

const MACHINE = deepFreeze({ loadType: 'machine', bodyweightLb: null } as const)
const CHIN_UP = deepFreeze({ loadType: 'bodyweight_plus', bodyweightLb: 163 } as const)

const e1rm = (totalLb: number): MetricValue =>
  deepFreeze({ kind: 'e1rm', totalLb, displayLb: totalLb })
const ral = (loadLb: number, reps: number): MetricValue =>
  deepFreeze({ kind: 'repsAtLoad', loadLb, reps })

/** setStrength and sessionMetric on frozen inputs. */
const strength = (set: SetLike, ctx: StrengthContext) =>
  setStrength(deepFreeze(set), deepFreeze(ctx))
const metric = (sets: SetLike[], kind: MetricKind, ctx: StrengthContext, repMin: number) =>
  sessionMetric(deepFreeze(sets), kind, deepFreeze(ctx), repMin)

describe('epley', () => {
  it('is load × (1 + reps/30)', () => {
    expect(epley(220, 8)).toBeCloseTo(278.667, 3)
    expect(epley(315, 8)).toBeCloseTo(399, 9)
    expect(epley(100, 30)).toBe(200)
    expect(epley(100, 0)).toBe(100)
  })
})

describe('setStrength', () => {
  it('uses the logged load for ordinary exercises', () => {
    expect(strength({ loadLb: 220, reps: 10 }, MACHINE)).toEqual({
      totalLb: epley(220, 10),
      displayLb: epley(220, 10),
    })
  })

  it('weighted chin-up: bodyweight + added into the formula, bodyweight subtracted for display', () => {
    // +50 lb × 6 at 163 lb bodyweight: 213 × 1.2 = 255.6 total, 92.6 shown.
    const s = strength({ loadLb: 50, reps: 6 }, CHIN_UP)
    expect(s?.totalLb).toBeCloseTo(255.6, 9)
    expect(s?.displayLb).toBeCloseTo(92.6, 9)
  })

  it('handles bodyweight-only and assisted chin-ups', () => {
    expect(strength({ loadLb: 0, reps: 8 }, CHIN_UP)?.totalLb).toBeCloseTo(epley(163, 8), 9)
    const assisted = strength({ loadLb: -20, reps: 8 }, CHIN_UP)
    expect(assisted?.totalLb).toBeCloseTo(epley(143, 8), 9)
    expect(assisted?.displayLb).toBeCloseTo(epley(143, 8) - 163, 9)
  })

  it('returns null without reps or, for bodyweight-plus, without a bodyweight', () => {
    expect(strength({ loadLb: 220, reps: 0 }, MACHINE)).toBeNull()
    expect(
      strength({ loadLb: 50, reps: 6 }, { loadType: 'bodyweight_plus', bodyweightLb: null }),
    ).toBeNull()
  })
})

describe('metricKind', () => {
  it('switches to reps-at-load strictly above the cutoff (12)', () => {
    expect(metricKind(10, DEFAULT_SETTINGS)).toBe('e1rm')
    expect(metricKind(12, DEFAULT_SETTINGS)).toBe('e1rm')
    expect(metricKind(13, DEFAULT_SETTINGS)).toBe('repsAtLoad')
    expect(metricKind(20, DEFAULT_SETTINGS)).toBe('repsAtLoad')
  })

  it('uses the edited cutoff', () => {
    expect(metricKind(15, resolveSettings({ e1rmRepCutoff: 15 }))).toBe('e1rm')
  })
})

describe('sessionMetric', () => {
  it('e1rm: the best set by total e1RM', () => {
    const sets = [
      { loadLb: 230, reps: 8 }, // 291.3
      { loadLb: 220, reps: 10 }, // 293.3
      { loadLb: 240, reps: 5 }, // 280
      { loadLb: 250, reps: 0 },
    ]
    expect(metric(sets, 'e1rm', MACHINE, 6)).toEqual(e1rm(epley(220, 10)))
  })

  it('e1rm for chin-ups carries total and display values', () => {
    const m = metric([{ loadLb: 50, reps: 6 }], 'e1rm', CHIN_UP, 6)
    expect(m).toMatchObject({ kind: 'e1rm' })
    if (m?.kind !== 'e1rm') throw new Error('expected e1rm')
    expect(m.totalLb).toBeCloseTo(255.6, 9)
    expect(m.displayLb).toBeCloseTo(92.6, 9)
  })

  it('repsAtLoad: the heaviest set with reps ≥ repMin, ties broken by reps', () => {
    const sets = [
      { loadLb: 40, reps: 20 },
      { loadLb: 42.5, reps: 12 },
      { loadLb: 42.5, reps: 14 },
      { loadLb: 45, reps: 9 }, // below repMin 10: doesn't qualify
    ]
    expect(metric(sets, 'repsAtLoad', MACHINE, 10)).toEqual(ral(42.5, 14))
  })

  it('returns null when no set qualifies', () => {
    expect(metric([], 'e1rm', MACHINE, 6)).toBeNull()
    expect(metric([{ loadLb: 100, reps: 0 }], 'e1rm', MACHINE, 6)).toBeNull()
    expect(metric([{ loadLb: 100, reps: 9 }], 'repsAtLoad', MACHINE, 10)).toBeNull()
    expect(metric([{ loadLb: 100, reps: 0 }], 'repsAtLoad', MACHINE, 0)).toBeNull()
    const noBw = { loadType: 'bodyweight_plus', bodyweightLb: null } as const
    expect(metric([{ loadLb: 50, reps: 6 }], 'e1rm', noBw, 6)).toBeNull()
  })
})

describe('compareMetric', () => {
  it('orders e1RMs numerically, equal within the load tolerance', () => {
    expect(compareMetric(e1rm(300), e1rm(290))).toBe(1)
    expect(compareMetric(e1rm(290), e1rm(300))).toBe(-1)
    // 200 × 10 and 250 × 2 are both 266.67 but may differ in the last bit.
    expect(compareMetric(e1rm(epley(200, 10)), e1rm(epley(250, 2)))).toBe(0)
  })

  it('orders reps-at-load by load, then reps', () => {
    expect(compareMetric(ral(45, 10), ral(42.5, 15))).toBe(1) // any heavier qualifying load
    expect(compareMetric(ral(42.5, 15), ral(42.5, 14))).toBe(1) // more reps at the same load
    expect(compareMetric(ral(42.5, 14), ral(42.5 + 1e-9, 14))).toBe(0)
    expect(compareMetric(ral(40, 20), ral(42.5, 10))).toBe(-1)
  })

  it('refuses to compare different kinds', () => {
    expect(() => compareMetric(e1rm(100), ral(100, 10))).toThrow(RangeError)
  })
})
