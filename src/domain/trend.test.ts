import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { addDays, parseLocalDate } from '@/domain/dates'
import { DEFAULT_SETTINGS } from '@/domain/settings/registry'
import type { BodyEntry } from '@/domain/types'
import {
  bodyweightOn,
  buildTrend,
  dailyWeights,
  emaTrend,
  seedFallbackWeightLb,
  sevenDayAvg,
  trendOn,
  weeklyRatePct,
  weighInDates,
  type DailyWeight,
} from './trend'

const d = parseLocalDate

function entry(date: string, weightLb: number | null, extra: Partial<BodyEntry> = {}): BodyEntry {
  return {
    date: d(date),
    weightLb,
    bodyFatPct: null,
    muscleMassLb: null,
    skeletalMusclePct: null,
    subcutFatPct: null,
    visceralRating: null,
    source: 'user',
    note: '',
    createdAt: 0,
    updatedAt: 0,
    voidedAt: null,
    ...extra,
  }
}

function deepFreeze<T>(x: T): T {
  if (x && typeof x === 'object') {
    Object.values(x).forEach(deepFreeze)
    Object.freeze(x)
  }
  return x
}

/** Consecutive daily weights starting on `from`. */
function days(from: string, weights: number[]): DailyWeight[] {
  return weights.map((weightLb, i) => ({
    date: addDays(d(from), i),
    weightLb,
    interpolated: false,
  }))
}

describe('dailyWeights', () => {
  it('uses only non-voided user weigh-ins with a weight', () => {
    const out = dailyWeights([
      entry('2026-09-24', 163, { source: 'seed' }),
      entry('2026-10-01', 170),
      entry('2026-10-02', 999, { voidedAt: 5 }),
      entry('2026-10-03', null, { bodyFatPct: 15 }),
    ])
    expect(out).toEqual([{ date: '2026-10-01', weightLb: 170, interpolated: false }])
  })

  it('keeps one reading per date, the latest update winning', () => {
    const out = dailyWeights([
      entry('2026-10-01', 171, { updatedAt: 20 }),
      entry('2026-10-01', 170, { updatedAt: 10 }),
    ])
    expect(out).toEqual([{ date: '2026-10-01', weightLb: 171, interpolated: false }])
  })

  it('interpolates interior gaps linearly, flags them and never extrapolates', () => {
    const out = dailyWeights([entry('2026-10-04', 173), entry('2026-10-01', 170)])
    expect(out).toEqual([
      { date: '2026-10-01', weightLb: 170, interpolated: false },
      { date: '2026-10-02', weightLb: 171, interpolated: true },
      { date: '2026-10-03', weightLb: 172, interpolated: true },
      { date: '2026-10-04', weightLb: 173, interpolated: false },
    ])
  })

  it('fills gaps across DST changes and the year end without skipping or repeating a date', () => {
    const dst = dailyWeights([entry('2026-03-07', 180), entry('2026-03-10', 183)])
    expect(dst.map((p) => p.date)).toEqual(['2026-03-07', '2026-03-08', '2026-03-09', '2026-03-10'])
    const fall = dailyWeights([entry('2026-10-31', 180), entry('2026-11-02', 181)])
    expect(fall.map((p) => [p.date, p.weightLb])).toEqual([
      ['2026-10-31', 180],
      ['2026-11-01', 180.5],
      ['2026-11-02', 181],
    ])
    const newYear = dailyWeights([entry('2026-12-30', 190), entry('2027-01-02', 187)])
    expect(newYear.map((p) => [p.date, p.weightLb])).toEqual([
      ['2026-12-30', 190],
      ['2026-12-31', 189],
      ['2027-01-01', 188],
      ['2027-01-02', 187],
    ])
  })

  it('is empty without real weigh-ins', () => {
    expect(dailyWeights([entry('2026-09-24', 163, { source: 'seed' })])).toEqual([])
    expect(weighInDates([entry('2026-09-24', 163, { source: 'seed' })])).toEqual([])
  })

  it('lists real weigh-in dates in order', () => {
    expect(weighInDates([entry('2026-10-04', 173), entry('2026-10-01', 170)])).toEqual([
      '2026-10-01',
      '2026-10-04',
    ])
  })
})

describe('emaTrend', () => {
  it('starts at T0 = W0 and applies T_t = T_{t−1} + α(W_t − T_{t−1})', () => {
    const t = emaTrend(days('2026-10-01', [170, 171, 172, 173]), 0.1)
    expect(t.map((p) => p.trendLb)).toEqual([
      170,
      expect.closeTo(170.1, 10),
      expect.closeTo(170.29, 10),
      expect.closeTo(170.561, 10),
    ])
  })

  it('treats interpolated gap days as ordinary calendar days', () => {
    const t = buildTrend([entry('2026-10-01', 170), entry('2026-10-04', 173)], DEFAULT_SETTINGS)
    expect(t).toHaveLength(4)
    expect(t[1]).toMatchObject({ date: '2026-10-02', interpolated: true })
    expect(t[3]?.trendLb).toBeCloseTo(170.561, 10)
  })

  it('rejects missing days and an alpha outside (0, 1]', () => {
    const gap = [...days('2026-10-01', [170]), ...days('2026-10-03', [171])]
    expect(() => emaTrend(gap, 0.1)).toThrow(RangeError)
    expect(() => emaTrend(days('2026-10-01', [170]), 0)).toThrow(RangeError)
    expect(() => emaTrend(days('2026-10-01', [170]), 1.5)).toThrow(RangeError)
    expect(emaTrend([], 0.1)).toEqual([])
  })

  it('does not mutate its (frozen) input', () => {
    const input = deepFreeze(days('2026-10-01', [170, 172]))
    expect(emaTrend(input, 0.5).map((p) => p.trendLb)).toEqual([170, 171])
  })

  it('stays within the running min and max of the weights, and is flat for flat input', () => {
    fc.assert(
      fc.property(
        fc.array(fc.double({ min: 100, max: 300, noNaN: true }), { minLength: 1, maxLength: 60 }),
        fc.double({ min: 0.02, max: 0.5, noNaN: true }),
        (weights, alpha) => {
          const t = emaTrend(days('2026-10-01', weights), alpha)
          let lo = Infinity
          let hi = -Infinity
          t.forEach((p, i) => {
            lo = Math.min(lo, weights[i]!)
            hi = Math.max(hi, weights[i]!)
            expect(p.trendLb).toBeGreaterThanOrEqual(lo - 1e-9)
            expect(p.trendLb).toBeLessThanOrEqual(hi + 1e-9)
          })
          const flat = emaTrend(
            days(
              '2026-10-01',
              weights.map(() => 180),
            ),
            alpha,
          )
          expect(flat.every((p) => p.trendLb === 180)).toBe(true)
        },
      ),
    )
  })
})

describe('trendOn', () => {
  const trend = emaTrend(days('2026-10-01', [170, 171, 172, 173]), 0.1)

  it('is null before T0 and for an empty trend', () => {
    expect(trendOn(trend, d('2026-09-30'))).toBeNull()
    expect(trendOn([], d('2026-10-01'))).toBeNull()
  })

  it('returns the trend on covered dates', () => {
    expect(trendOn(trend, d('2026-10-01'))).toEqual({ trendLb: 170, stale: false })
    expect(trendOn(trend, d('2026-10-03'))?.trendLb).toBeCloseTo(170.29, 10)
  })

  it('carries the last value forward as stale after the last reading', () => {
    const v = trendOn(trend, d('2026-10-20'))
    expect(v?.stale).toBe(true)
    expect(v?.trendLb).toBeCloseTo(170.561, 10)
  })
})

describe('weeklyRatePct', () => {
  // 200 lb for a week, then 210: T7 = 200 + 0.1 × 10 = 201.
  const gain = emaTrend(days('2026-10-01', [200, 200, 200, 200, 200, 200, 200, 210]), 0.1)

  it('is (T_d − T_{d−7}) / T_{d−7} × 100', () => {
    expect(weeklyRatePct(gain, d('2026-10-08'))).toBeCloseTo(0.5, 10)
  })

  it('is negative for a loss (cut sign convention)', () => {
    const loss = emaTrend(days('2026-10-01', [200, 200, 200, 200, 200, 200, 200, 190]), 0.1)
    expect(weeklyRatePct(loss, d('2026-10-08'))).toBeCloseTo(-0.5, 10)
  })

  it('is null until both T_d and T_{d−7} exist, and after the last reading', () => {
    expect(weeklyRatePct(gain, d('2026-10-07'))).toBeNull()
    expect(weeklyRatePct(gain, d('2026-10-09'))).toBeNull()
    expect(weeklyRatePct(gain, d('2026-09-30'))).toBeNull()
    expect(weeklyRatePct([], d('2026-10-08'))).toBeNull()
  })

  it('spans a DST change as exactly seven calendar days', () => {
    const t = emaTrend(days('2026-03-02', [200, 200, 200, 200, 200, 200, 200, 210]), 0.1)
    expect(t[7]?.date).toBe('2026-03-09')
    expect(weeklyRatePct(t, d('2026-03-09'))).toBeCloseTo(0.5, 10)
  })
})

describe('sevenDayAvg', () => {
  const on = d('2026-10-10')
  const entries = [
    entry('2026-10-03', 999), // day −7: outside the window
    entry('2026-10-04', 180), // day −6
    entry('2026-10-07', 181),
    entry('2026-10-08', 500, { voidedAt: 1 }),
    entry('2026-10-09', 163, { source: 'seed' }),
    entry('2026-10-10', 182),
  ]

  it('averages real readings in [date − 6, date]', () => {
    expect(sevenDayAvg(entries, on, DEFAULT_SETTINGS.sevenDayAvgMinReadings)).toBe(181)
  })

  it('is null below the minimum number of readings', () => {
    expect(sevenDayAvg(entries, on, 4)).toBeNull()
    expect(sevenDayAvg([entry('2026-10-10', 182)], on, 0)).toBe(182)
    expect(sevenDayAvg([], on, 0)).toBeNull()
  })

  it('counts only real readings, not interpolated days', () => {
    const sparse = [entry('2026-10-01', 180), entry('2026-10-10', 190)]
    expect(sevenDayAvg(sparse, on, 1)).toBe(190)
    expect(sevenDayAvg(sparse, on, 2)).toBeNull()
  })
})

describe('seed fallback bodyweight', () => {
  const seed = entry('2026-09-24', 163, { source: 'seed' })

  it('uses the seed baseline until the first real weigh-in', () => {
    const entries = [seed, entry('2026-09-26', 165)]
    const trend = buildTrend(entries, DEFAULT_SETTINGS)
    expect(bodyweightOn(trend, entries, d('2026-09-25'))).toEqual({
      weightLb: 163,
      source: 'seed',
      stale: false,
    })
    expect(bodyweightOn(trend, entries, d('2026-09-26'))).toEqual({
      weightLb: 165,
      source: 'trend',
      stale: false,
    })
    expect(bodyweightOn(trend, entries, d('2026-10-05'))).toEqual({
      weightLb: 165,
      source: 'trend',
      stale: true,
    })
  })

  it('never lets the seed enter the trend', () => {
    const trend = buildTrend([seed, entry('2026-09-26', 165)], DEFAULT_SETTINGS)
    expect(trend.map((p) => p.date)).toEqual(['2026-09-26'])
  })

  it('picks the latest non-voided seed, or null without one', () => {
    expect(
      seedFallbackWeightLb([
        seed,
        entry('2026-09-25', 164, { source: 'seed' }),
        entry('2026-09-26', 170, { source: 'seed', voidedAt: 1 }),
      ]),
    ).toBe(164)
    expect(seedFallbackWeightLb([entry('2026-09-26', 165)])).toBeNull()
    expect(bodyweightOn([], [], d('2026-09-26'))).toBeNull()
  })
})
